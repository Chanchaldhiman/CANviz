"""
canviz/bus.py
-------------
Manages the python-can Bus lifecycle.

Priority order (matches the design decision log):
  1. gs_usb  — Candlelight firmware, no COM port, plug-and-play on Windows
  2. slcan   — COM port devices (secondary path)
  3. virtual — software bus, used for dev and CI (no hardware needed)
  4. socketcan — Linux SocketCAN (Raspberry Pi, WSL2)

Disconnect/reconnect design
---------------------------
On Windows, gs_usb (libusb/WinUSB) does not reliably release the USB device
handle within a short time after shutdown(). Attempting to reopen within ~5s
consistently raises [Errno 13] Access denied.

Solution: "disconnect" is a SOFT operation — it stops the frame reader loop
but keeps the USB bus object alive. On reconnect with the same settings, the
existing handle is reused immediately (no USB re-enumeration needed).

A full hardware teardown (_hard_shutdown) is only done:
  - When the server process exits (lifespan shutdown)
  - When the user explicitly changes interface/bitrate/channel (settings change)
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Callable, Optional

import can
from can import Message

from canviz.config import settings, InterfaceType

log = logging.getLogger("canviz.bus")


class BusManager:
    def __init__(self) -> None:
        self._bus: Optional[can.BusABC] = None
        self._reader_task: Optional[asyncio.Task] = None
        self._connected: bool = False
        self._error: Optional[str] = None
        self._frame_callbacks: list[Callable[[Message], None]] = []
        self._open_time: float = 0.0
        # Track what the current open bus was configured with
        self._open_interface: Optional[str] = None
        self._open_channel: str = ""
        self._open_bitrate: int = 0
        self._open_index: int = 0
        self._open_serial_baudrate: int = 0  
        # Whether the hardware echoes sent frames back through recv() automatically.
        # gs_usb (Candlelight) and virtual do. slcan and seeedstudio do not.
        # When False, send() manually dispatches the frame through callbacks
        # so sent frames appear in the UI message table.
        self._echoes_sent_frames: bool = False

    @property
    def connected(self) -> bool:
        return self._connected

    @property
    def error(self) -> Optional[str]:
        return self._error

    def add_frame_callback(self, cb: Callable[[Message], None]) -> None:
        if cb not in self._frame_callbacks:
            self._frame_callbacks.append(cb)

    def remove_frame_callback(self, cb: Callable[[Message], None]) -> None:
        self._frame_callbacks = [c for c in self._frame_callbacks if c is not cb]

    async def connect(
        self,
        interface: InterfaceType,
        channel: str = "",
        bitrate: int = 500_000,
        index: int = 0,
    ) -> None:
        if self._connected:
            await self.disconnect()

        self._error = None

        # Reuse existing bus if hardware settings are unchanged.
        # This avoids the gs_usb/libusb handle-release race on Windows.
        settings_match = (
            self._bus is not None
            and self._open_interface == interface
            and self._open_channel == channel
            and self._open_bitrate == bitrate
            and self._open_index == index
        )

        if settings_match:
            log.info(
                "Reconnecting: reusing existing %s bus handle (no USB re-open).", interface
            )
        else:
            # Settings changed — need a new hardware connection.
            # Full teardown of the old bus first.
            if self._bus is not None:
                await self._hard_shutdown()

            try:
               
                self._bus = _open_bus(interface, channel, bitrate, index,)
            except Exception as exc:
                self._error = str(exc)
                log.error("Bus open failed: %s", exc)
                raise

            self._open_interface = interface
            self._open_channel   = channel
            self._open_bitrate   = bitrate
            self._open_index     = index

        # gs_usb (Candlelight) and virtual echo sent frames back through recv()
        # automatically so they appear in the UI via the reader loop.
        # slcan and seeedstudio do not — send() will echo them manually.
        self._echoes_sent_frames = interface in ("gs_usb", "virtual")

        settings.interface = interface
        settings.channel   = channel
        settings.bitrate   = bitrate
        settings.index     = index

        self._open_time  = time.monotonic()
        self._connected  = True
        self._reader_task = asyncio.get_event_loop().create_task(
            self._reader_loop(), name="can-reader"
        )
        log.info(
            "Connected: interface=%s channel=%s bitrate=%d serial_baudrate=%d",
            interface, channel, bitrate,
        )

    async def disconnect(self) -> None:
        """
        Soft disconnect — stops the reader loop, keeps the USB handle open.
        Safe to call multiple times. Fast (no USB teardown).
        """
        self._connected = False

        if self._reader_task:
            self._reader_task.cancel()
            try:
                await self._reader_task
            except asyncio.CancelledError:
                pass
            self._reader_task = None

        # Allow any in-flight recv() executor thread to return (recv timeout=0.1s)
        await asyncio.sleep(0.15)

        log.info("Disconnected.")

    async def _hard_shutdown(self) -> None:
        """
        Full hardware teardown — closes the USB handle.
        Called on server shutdown or when interface settings change.
        Not called on normal UI disconnect/reconnect cycles.
        """
        await self.disconnect()

        if self._bus is not None:
            bus = self._bus
            self._bus = None
            self._open_interface = None
            try:
                loop = asyncio.get_event_loop()
                await loop.run_in_executor(None, bus.shutdown)
                log.info("Bus hardware released.")
            except Exception as exc:
                log.warning("Bus shutdown error: %s", exc)

            # Give OS time to release the USB handle before any potential reopen
            await asyncio.sleep(1.5)

    async def send(self, arbitration_id: int, data: list[int], is_extended_id: bool = False) -> None:
        if not self._connected or self._bus is None:
            raise RuntimeError("Not connected — call /connect first")
        msg = can.Message(
            arbitration_id=arbitration_id,
            data=bytes(data),
            is_extended_id=is_extended_id,
        )
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, self._bus.send, msg)

        # For interfaces that don't echo sent frames back through recv()
        # (seeedstudio, slcan), manually dispatch the sent frame through the
        # same callbacks the reader loop uses so it appears in the UI.
        if not self._echoes_sent_frames:
            msg.timestamp = time.monotonic() - self._open_time
            for cb in list(self._frame_callbacks):
                try:
                    cb(msg)
                except Exception as exc:
                    log.warning("Frame callback error on tx echo: %s", exc)

    async def _reader_loop(self) -> None:
        log.debug("Reader loop started.")
        loop = asyncio.get_event_loop()
        _consecutive_none = 0  # tracks silence for slcan diagnostic

        while self._connected and self._bus is not None:
            try:
                msg: Optional[Message] = await loop.run_in_executor(
                    None, self._bus.recv, 0.1
                )
            except Exception as exc:
                log.warning("recv error: %s", exc)
                await asyncio.sleep(0.1)
                continue

            if msg is None:
                _consecutive_none += 1
                # After 5 s of silence on slcan, emit an actionable hint.
                # Each loop iteration is ~0.1 s (recv timeout), so 50 = ~5 s.
                if (
                    _consecutive_none == 50
                    and self._open_interface == "slcan"
                ):
                    log.warning(
                        "slcan: no frames received in ~5 s. "
                        "Check: (1) CAN bitrate matches the bus (%d bps), "
                        "(2) serial baud rate matches adapter (current: %d). "
                        "Common fix: try Serial Baud Rate = 2000000 in the UI.",
                        self._open_bitrate,
                        self._open_serial_baudrate,
                    )
                continue

            _consecutive_none = 0
            msg.timestamp = time.monotonic() - self._open_time

            for cb in list(self._frame_callbacks):
                try:
                    cb(msg)
                except Exception as exc:
                    log.warning("Frame callback error: %s", exc)

        log.debug("Reader loop exited.")


# ── Internal helpers ─────────────────────────────────────────────────────────

def _find_libusb_backend():
    """
    On Windows, pyusb cannot find libusb automatically.
    Try to locate it from the pip-installed 'libusb' package first,
    then fall back to letting pyusb search system paths.
    Returns a usb backend object or None.
    """
    import usb.backend.libusb1 as libusb1_backend
    try:
        import libusb
        dll_path = libusb.dll._name
        log.debug("Using bundled libusb DLL: %s", dll_path)
        backend = libusb1_backend.get_backend(find_library=lambda x: dll_path)
        if backend:
            return backend
    except Exception as exc:
        log.debug("Bundled libusb not usable (%s), falling back to system search", exc)

    backend = libusb1_backend.get_backend()
    return backend


_libusb_patched: bool = False  # guard against stacking the monkey-patch on reconnect


def _ensure_libusb() -> None:
    """
    Verify pyusb can reach a libusb backend.
    On Windows the 'libusb' pip package bundles the DLL but pyusb won't
    find it automatically — we patch usb.core to use it explicitly.
    Raises ImportError with a clear action if nothing works.
    """
    global _libusb_patched
    if _libusb_patched:
        return

    try:
        import usb.core
        import usb.backend.libusb1 as libusb1_backend  # noqa: F401

        backend = _find_libusb_backend()
        if backend is None:
            raise RuntimeError("no backend found")

        _original_find = usb.core.find

        def _find_with_backend(*args, **kwargs):
            kwargs.setdefault("backend", backend)
            return _original_find(*args, **kwargs)

        usb.core.find = _find_with_backend
        _libusb_patched = True
        log.debug("pyusb backend patched successfully")

    except Exception as exc:
        raise ImportError(
            f"pyusb could not find a libusb backend: {exc}\n\n"
            "Fix (Windows):\n"
            "  1. pip install libusb\n"
            "  2. If that still fails, download libusb-1.0.dll from https://libusb.info\n"
            "     and place it next to python.exe\n"
            "     (e.g. C:\\Users\\<you>\\AppData\\Local\\Programs\\Python\\Python312\\)\n"
        ) from exc


def _open_bus(
    interface: InterfaceType,
    channel: str,
    bitrate: int,
    index: int,
    serial_baudrate: int = 115200,
) -> can.BusABC:
    if interface == "gs_usb":
        _ensure_libusb()
        return can.Bus(interface="gs_usb", channel=index, bitrate=bitrate)

    elif interface == "slcan":
        if not channel:
            raise ValueError("slcan requires a channel (e.g. COM3 or /dev/ttyACM0)")
        log.info(
            "Opening slcan: channel=%s  CAN bitrate=%d bps  serial baud=%d",
            channel, bitrate, serial_baudrate,
        )
        # (open) command is sent *inside* can.Bus().__init__(). The settle
        # time must come AFTER the bus is constructed so the adapter has time
        # to process that command before we start calling recv().
        bus = can.Bus(
            interface="slcan",
            channel=channel,
            bitrate=bitrate,
            ttyBaudrate=serial_baudrate,
        )
        time.sleep(0.25)  # let adapter process O\r before first recv()
        return bus

    elif interface == "socketcan":
        if not channel:
            raise ValueError("socketcan requires a channel (e.g. can0)")
        return can.Bus(interface="socketcan", channel=channel, bitrate=bitrate)

    elif interface == "virtual":
        return can.Bus(interface="virtual", channel="vcan0", receive_own_messages=True)

    elif interface == "pcan":
        ch = channel if channel else "PCAN_USBBUS1"
        return can.Bus(interface="pcan", channel=ch, bitrate=bitrate)

    elif interface == "kvaser":
        return can.Bus(interface="kvaser", channel=index, bitrate=bitrate)

    elif interface == "seeedstudio":
        if not channel:
            raise ValueError("seeedstudio requires a channel (e.g. COM8 or /dev/ttyUSB0)")
        log.info("Opening seeedstudio USB-CAN: channel=%s  CAN bitrate=%d bps", channel, bitrate)
        # Seeed Studio / GY USB-CAN Analyzer — binary 0xAA/0x55 framing protocol.
        # No serial baud rate param — the protocol configures the device via an
        # init frame, not by matching a serial baud rate. python-can handles this
        # internally in the seeedstudio interface.
        return can.Bus(interface="seeedstudio", channel=channel, bitrate=bitrate)

    else:
        raise ValueError(
            f"Unknown interface: {interface!r}. "
            "Choose: gs_usb, slcan, socketcan, virtual, pcan, kvaser, seeedstudio"
        )


def open_bus(
    interface: "InterfaceType",
    channel: str = "",
    bitrate: int = 500_000,
    index: int = 0,
    serial_baudrate: int = 115200,  
) -> "can.BusABC":
    """
    Public wrapper around _open_bus().
    Used by CLI subcommands (monitor, capture) that bypass FastAPI entirely.
    """
    return _open_bus(interface, channel, bitrate, index, serial_baudrate)


# Singleton
bus_manager = BusManager()