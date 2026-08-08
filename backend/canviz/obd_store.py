"""
canviz/obd_store.py
--------------------
OBD-II over raw CAN (ISO 15765-4). Mode 01 (live data) only in v1.

Scope decision for v1
----------------------
Single-frame ISO-TP only. Every Mode 01 request (2 data bytes: mode + PID)
and every Mode 01 response used here (at most 6 payload bytes) fits inside
one classic CAN frame, so this file never needs flow control, block size,
STmin timing, or consecutive-frame sequencing -- the parts of an ISO-TP
stack most likely to have subtle bugs. Mode 03 (DTCs) and Mode 09 (VIN)
can exceed 7 bytes and need multi-frame ISO-TP; that is deliberately left
for the next stage, once this transport is hardware-validated.

Request/response model
-----------------------
One request in flight at a time. The poll loop awaits each response (or a
timeout) before sending the next PID request. This removes the need to
correlate multiple concurrent requests against the shared 0x7E8-0x7EF
response range, which a live-gauge panel does not need anyway.

Addressing
----------
Tries both ISO 15765-4 addressing formats and locks onto whichever one a
vehicle actually answers on:
  - 11-bit (standard): functional request 0x7DF, responses 0x7E8-0x7EF
  - 29-bit (extended): functional request 0x18DB33F1, responses in the
    0x18DAF1xx range (many Honda/Acura ECUs, among others, only speak this)
Detection happens automatically as the first step of every scan: try
11-bit first (or whichever profile last worked, if any), fall back to
29-bit if that gets no response. Whichever one answers is used for the
rest of the session until the next scan.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Callable, Optional

from canviz.bus import bus_manager

log = logging.getLogger("canviz.obd")


@dataclass(frozen=True)
class AddressingProfile:
    name: str
    request_id: int
    is_extended: bool
    response_id_min: int
    response_id_max: int


PROFILE_11BIT = AddressingProfile("11-bit", 0x7DF, False, 0x7E8, 0x7EF)
PROFILE_29BIT = AddressingProfile("29-bit", 0x18DB33F1, True, 0x18DAF100, 0x18DAF1FF)
ADDRESSING_PROFILES = (PROFILE_11BIT, PROFILE_29BIT)

MODE01_POSITIVE_RESPONSE = 0x41    # 0x01 request + 0x40 = positive response
REQUEST_TIMEOUT_S = 1.0            # generous vs. ECU P2 default of 50ms
POLL_GAP_S = 0.05                  # gap between requests inside the poll loop
IDLE_GAP_S = 0.2                   # gap when nothing is watched
STALLED_GAP_S = 2.0                # backed-off retry gap once data_stalled is set
STALL_THRESHOLD = 5                # consecutive failures before backing off

MONITOR_STATUS_PID = 0x01          # MIL status + DTC count -- see decode note below
MONITOR_REFRESH_INTERVAL_S = 3.0   # slower cadence than watched PIDs, this rarely changes


def _pct(a: int) -> float:
    return round(a * 100 / 255, 1)


def _temp(a: int) -> float:
    return float(a - 40)


def _rpm(a: int, b: int) -> float:
    return round(((a * 256) + b) / 4, 1)


def _maf(a: int, b: int) -> float:
    return round(((a * 256) + b) / 100, 2)


def _fuel_trim(a: int) -> float:
    return round((a - 128) * 100 / 128, 1)


def _o2_voltage(a: int) -> float:
    return round(a * 0.005, 3)


def _signed16(raw: int) -> int:
    """Two's-complement interpretation of a 16-bit value (0-65535 -> -32768..32767)."""
    return raw - 65536 if raw >= 32768 else raw


def _u16(a: int, b: int) -> int:
    return (a << 8) | b


def _decode_monitor_status(payload: bytes) -> dict:
    """
    PID 0x01, Monitor Status Since DTCs Cleared. Only byte A (MIL status +
    DTC count) is decoded here. The remaining 3 bytes encode which
    emissions readiness monitors are supported/complete, but the exact
    bit layout is one of the most inconsistently documented parts of
    SAE J1979 (real scan tool vendors have shipped it wrong), and getting
    it backwards would silently show complete monitors as incomplete or
    vice versa. Deliberately not decoded rather than risk that -- MIL
    status and DTC count cover the question people actually open this
    for ("why is my check engine light on, how many codes").
    """
    if len(payload) < 1:
        return {"mil_on": False, "dtc_count": 0}
    a = payload[0]
    return {"mil_on": bool(a & 0x80), "dtc_count": a & 0x7F}


# pid -> name, unit, category (for the frontend's grouped picker), decode fn
#
# This covers every SAE J1979 Mode 01 PID that resolves to a single numeric
# gauge value. Deliberately excluded, these return bitfields, enums, or DTC
# codes and need a different UI than a live number, not implemented here:
#   0x01 Monitor status since DTCs cleared (bitfield)
#   0x02 Freeze DTC (a DTC code, not a number)
#   0x03 Fuel system status (enum)
#   0x12 Commanded secondary air status (enum)
#   0x13 / 0x1D O2 sensors present (bitmask)
#   0x1C OBD standards this vehicle conforms to (enum)
#   0x1E Auxiliary input status (bitfield)
#   0x51 Fuel type (enum)
# PID 0x24 (wideband O2, 4-byte payload) reports both an equivalence ratio
# and a voltage; only the ratio is decoded here to keep the single-value
# display model -- the voltage half of the payload is currently unused.
PID_TABLE: dict[int, dict] = {
    0x04: {"name": "Engine Load",               "unit": "%",     "category": "Engine",       "bytes": 1, "decode": lambda d: _pct(d[0])},
    0x05: {"name": "Coolant Temp",               "unit": "\u00b0C",    "category": "Temperatures", "bytes": 1, "decode": lambda d: _temp(d[0])},
    0x06: {"name": "Fuel Trim S1 Short",         "unit": "%",     "category": "Fuel & Air",   "bytes": 1, "decode": lambda d: _fuel_trim(d[0])},
    0x07: {"name": "Fuel Trim S1 Long",          "unit": "%",     "category": "Fuel & Air",   "bytes": 1, "decode": lambda d: _fuel_trim(d[0])},
    0x08: {"name": "Fuel Trim S2 Short",         "unit": "%",     "category": "Fuel & Air",   "bytes": 1, "decode": lambda d: _fuel_trim(d[0])},
    0x09: {"name": "Fuel Trim S2 Long",          "unit": "%",     "category": "Fuel & Air",   "bytes": 1, "decode": lambda d: _fuel_trim(d[0])},
    0x0A: {"name": "Fuel Pressure",              "unit": "kPa",   "category": "Fuel & Air",   "bytes": 1, "decode": lambda d: float(d[0] * 3)},
    0x0B: {"name": "Intake MAP",                 "unit": "kPa",   "category": "Fuel & Air",   "bytes": 1, "decode": lambda d: float(d[0])},
    0x0C: {"name": "Engine RPM",                 "unit": "rpm",   "category": "Engine",       "bytes": 2, "decode": lambda d: _rpm(d[0], d[1])},
    0x0D: {"name": "Vehicle Speed",              "unit": "km/h",  "category": "Vehicle & Trip", "bytes": 1, "decode": lambda d: float(d[0])},
    0x0E: {"name": "Timing Advance",              "unit": "\u00b0",     "category": "Engine",       "bytes": 1, "decode": lambda d: round(d[0] / 2 - 64, 1)},
    0x0F: {"name": "Intake Air Temp",            "unit": "\u00b0C",    "category": "Temperatures", "bytes": 1, "decode": lambda d: _temp(d[0])},
    0x10: {"name": "MAF Flow Rate",              "unit": "g/s",   "category": "Fuel & Air",   "bytes": 2, "decode": lambda d: _maf(d[0], d[1])},
    0x11: {"name": "Throttle Position",          "unit": "%",     "category": "Fuel & Air",   "bytes": 1, "decode": lambda d: _pct(d[0])},
    0x14: {"name": "O2 Sensor B1S1",             "unit": "V",     "category": "O2 Sensors",   "bytes": 2, "decode": lambda d: _o2_voltage(d[0])},
    0x15: {"name": "O2 Sensor B1S2",             "unit": "V",     "category": "O2 Sensors",   "bytes": 2, "decode": lambda d: _o2_voltage(d[0])},
    0x16: {"name": "O2 Sensor B2S1",             "unit": "V",     "category": "O2 Sensors",   "bytes": 2, "decode": lambda d: _o2_voltage(d[0])},
    0x17: {"name": "O2 Sensor B2S2",             "unit": "V",     "category": "O2 Sensors",   "bytes": 2, "decode": lambda d: _o2_voltage(d[0])},
    0x18: {"name": "O2 Sensor B3S1",             "unit": "V",     "category": "O2 Sensors",   "bytes": 2, "decode": lambda d: _o2_voltage(d[0])},
    0x19: {"name": "O2 Sensor B3S2",             "unit": "V",     "category": "O2 Sensors",   "bytes": 2, "decode": lambda d: _o2_voltage(d[0])},
    0x1A: {"name": "O2 Sensor B4S1",             "unit": "V",     "category": "O2 Sensors",   "bytes": 2, "decode": lambda d: _o2_voltage(d[0])},
    0x1B: {"name": "O2 Sensor B4S2",             "unit": "V",     "category": "O2 Sensors",   "bytes": 2, "decode": lambda d: _o2_voltage(d[0])},
    0x1F: {"name": "Run Time Since Start",       "unit": "s",     "category": "Vehicle & Trip", "bytes": 2, "decode": lambda d: float(_u16(d[0], d[1]))},
    0x21: {"name": "Distance with MIL On",       "unit": "km",    "category": "Vehicle & Trip", "bytes": 2, "decode": lambda d: float(_u16(d[0], d[1]))},
    0x22: {"name": "Fuel Rail Pressure",         "unit": "kPa",   "category": "Fuel & Air",   "bytes": 2, "decode": lambda d: round(_u16(d[0], d[1]) * 0.079, 1)},
    0x23: {"name": "Fuel Rail Gauge Pressure",   "unit": "kPa",   "category": "Fuel & Air",   "bytes": 2, "decode": lambda d: round(_u16(d[0], d[1]) * 10, 1)},
    0x24: {"name": "O2 Sensor B1S1 Lambda",      "unit": "\u03bb",     "category": "O2 Sensors",   "bytes": 4, "decode": lambda d: round(_u16(d[0], d[1]) * 2 / 65535, 3)},
    0x2C: {"name": "Commanded EGR",              "unit": "%",     "category": "Emissions",    "bytes": 1, "decode": lambda d: _pct(d[0])},
    0x2D: {"name": "EGR Error",                  "unit": "%",     "category": "Emissions",    "bytes": 1, "decode": lambda d: _fuel_trim(d[0])},
    0x2E: {"name": "Commanded Evap Purge",       "unit": "%",     "category": "Emissions",    "bytes": 1, "decode": lambda d: _pct(d[0])},
    0x2F: {"name": "Fuel Tank Level",            "unit": "%",     "category": "Fuel & Air",   "bytes": 1, "decode": lambda d: _pct(d[0])},
    0x30: {"name": "Warm-ups Since Cleared",     "unit": "count", "category": "Vehicle & Trip", "bytes": 1, "decode": lambda d: float(d[0])},
    0x31: {"name": "Distance Since Cleared",     "unit": "km",    "category": "Vehicle & Trip", "bytes": 2, "decode": lambda d: float(_u16(d[0], d[1]))},
    0x32: {"name": "Evap Vapor Pressure",        "unit": "Pa",    "category": "Emissions",    "bytes": 2, "decode": lambda d: round(_signed16(_u16(d[0], d[1])) / 4, 2)},
    0x33: {"name": "Barometric Pressure",        "unit": "kPa",   "category": "Fuel & Air",   "bytes": 1, "decode": lambda d: float(d[0])},
    0x3C: {"name": "Catalyst Temp B1S1",         "unit": "\u00b0C",    "category": "Temperatures", "bytes": 2, "decode": lambda d: round(_u16(d[0], d[1]) / 10 - 40, 1)},
    0x3D: {"name": "Catalyst Temp B2S1",         "unit": "\u00b0C",    "category": "Temperatures", "bytes": 2, "decode": lambda d: round(_u16(d[0], d[1]) / 10 - 40, 1)},
    0x3E: {"name": "Catalyst Temp B1S2",         "unit": "\u00b0C",    "category": "Temperatures", "bytes": 2, "decode": lambda d: round(_u16(d[0], d[1]) / 10 - 40, 1)},
    0x3F: {"name": "Catalyst Temp B2S2",         "unit": "\u00b0C",    "category": "Temperatures", "bytes": 2, "decode": lambda d: round(_u16(d[0], d[1]) / 10 - 40, 1)},
    0x42: {"name": "Control Module Voltage",     "unit": "V",     "category": "Engine",       "bytes": 2, "decode": lambda d: round(_u16(d[0], d[1]) / 1000, 3)},
    0x43: {"name": "Absolute Load Value",        "unit": "%",     "category": "Engine",       "bytes": 2, "decode": lambda d: round(_u16(d[0], d[1]) * 100 / 255, 1)},
    0x44: {"name": "Commanded Equiv. Ratio",     "unit": "\u03bb",     "category": "Emissions",    "bytes": 2, "decode": lambda d: round(_u16(d[0], d[1]) * 2 / 65535, 3)},
    0x45: {"name": "Relative Throttle Position", "unit": "%",     "category": "Fuel & Air",   "bytes": 1, "decode": lambda d: _pct(d[0])},
    0x46: {"name": "Ambient Air Temp",           "unit": "\u00b0C",    "category": "Temperatures", "bytes": 1, "decode": lambda d: _temp(d[0])},
    0x47: {"name": "Throttle Position B",        "unit": "%",     "category": "Fuel & Air",   "bytes": 1, "decode": lambda d: _pct(d[0])},
    0x48: {"name": "Throttle Position C",        "unit": "%",     "category": "Fuel & Air",   "bytes": 1, "decode": lambda d: _pct(d[0])},
    0x49: {"name": "Accelerator Pedal D",        "unit": "%",     "category": "Fuel & Air",   "bytes": 1, "decode": lambda d: _pct(d[0])},
    0x4A: {"name": "Accelerator Pedal E",        "unit": "%",     "category": "Fuel & Air",   "bytes": 1, "decode": lambda d: _pct(d[0])},
    0x4B: {"name": "Accelerator Pedal F",        "unit": "%",     "category": "Fuel & Air",   "bytes": 1, "decode": lambda d: _pct(d[0])},
    0x4C: {"name": "Commanded Throttle Actuator", "unit": "%",    "category": "Fuel & Air",   "bytes": 1, "decode": lambda d: _pct(d[0])},
    0x4D: {"name": "Time with MIL On",           "unit": "min",   "category": "Vehicle & Trip", "bytes": 2, "decode": lambda d: float(_u16(d[0], d[1]))},
    0x4E: {"name": "Time Since Codes Cleared",   "unit": "min",   "category": "Vehicle & Trip", "bytes": 2, "decode": lambda d: float(_u16(d[0], d[1]))},
    0x52: {"name": "Ethanol Fuel %",             "unit": "%",     "category": "Fuel & Air",   "bytes": 1, "decode": lambda d: _pct(d[0])},
    0x5A: {"name": "Relative Pedal Position",    "unit": "%",     "category": "Fuel & Air",   "bytes": 1, "decode": lambda d: _pct(d[0])},
    0x5C: {"name": "Engine Oil Temp",            "unit": "\u00b0C",    "category": "Temperatures", "bytes": 1, "decode": lambda d: _temp(d[0])},
    0x5E: {"name": "Engine Fuel Rate",           "unit": "L/h",   "category": "Fuel & Air",   "bytes": 2, "decode": lambda d: round(_u16(d[0], d[1]) * 0.05, 2)},
    0x61: {"name": "Driver Demand Torque",       "unit": "%",     "category": "Engine",       "bytes": 1, "decode": lambda d: float(d[0] - 125)},
    0x62: {"name": "Actual Engine Torque",       "unit": "%",     "category": "Engine",       "bytes": 1, "decode": lambda d: float(d[0] - 125)},
    0x63: {"name": "Engine Reference Torque",    "unit": "Nm",    "category": "Engine",       "bytes": 2, "decode": lambda d: float(_u16(d[0], d[1]))},
}

# PID 0x00/0x20/0x40/0x60 each report support for the next 32 PIDs.
# Order matters: 0x00 MUST be first -- scan_supported() reuses the response
# from addressing detection (which always probes PID 0x00) as this group's
# answer instead of asking a second time.
SUPPORT_QUERY_PIDS = [0x00, 0x20, 0x40, 0x60]


def _decode_support_bitmask(base_pid: int, payload: bytes) -> set[int]:
    """4-byte bitmask, MSB-first, bit N of byte 0 = base_pid+1 supported, etc."""
    supported: set[int] = set()
    bit_index = 0
    for byte in payload[:4]:
        for shift in range(7, -1, -1):
            bit_index += 1
            if byte & (1 << shift):
                supported.add(base_pid + bit_index)
    return supported


@dataclass
class OBDStore:
    mode: str = "off"                          # "off" | "on"
    supported_pids: set[int] = field(default_factory=set)
    watched_pids: list[int] = field(default_factory=list)
    live_values: dict[int, dict] = field(default_factory=dict)
    last_error: Optional[str] = None
    scanning: bool = False
    data_stalled: bool = False
    addressing: Optional[AddressingProfile] = None
    monitor_status: Optional[dict] = None
    monitor_status_supported: bool = False

    def __post_init__(self) -> None:
        self._pending: Optional[asyncio.Future] = None
        self._pending_pid: Optional[int] = None
        self._pending_profile: Optional[AddressingProfile] = None
        self._poll_task: Optional[asyncio.Task] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._last_monitor_fetch: float = 0.0

    # ── Frame callback -- registered with bus_manager. In this codebase it
    # runs on the event loop thread itself (bus.py invokes callbacks after
    # `await run_in_executor(...)`, not inside the executor). We still route
    # through call_soon_threadsafe rather than calling _resolve_pending
    # directly -- it is a correct no-op on the current thread and keeps this
    # file safe if callback dispatch is ever moved onto a worker thread.
    def on_frame(self, msg) -> None:
        if self._pending is None or self._pending.done():
            return
        profile = self._pending_profile
        if profile is None:
            return
        if bool(msg.is_extended_id) != profile.is_extended:
            return  # e.g. ignore an 11-bit stray while probing 29-bit, and vice versa
        if not (profile.response_id_min <= msg.arbitration_id <= profile.response_id_max):
            return
        data = bytes(msg.data)
        if len(data) < 3:
            return
        pci = data[0]
        if (pci >> 4) != 0:
            return  # not a single-frame ISO-TP response -- ignored in v1
        if data[1] != MODE01_POSITIVE_RESPONSE:
            return
        if data[2] != self._pending_pid:
            return  # response to a different PID than the one we're waiting on

        sf_dl = pci & 0x0F  # declared payload length: mode + pid + N data bytes
        payload = data[3:1 + sf_dl] if 1 + sf_dl <= len(data) else data[3:]

        if self._loop is not None:
            self._loop.call_soon_threadsafe(self._resolve_pending, bytes(payload))

    def _resolve_pending(self, payload: bytes) -> None:
        if self._pending is not None and not self._pending.done():
            self._pending.set_result(payload)

    # ── Single request/response cycle, addressing-profile aware ─────────────
    async def _request_raw(self, profile: AddressingProfile, pid: int) -> bytes:
        if self._loop is None:
            self._loop = asyncio.get_event_loop()

        fut: asyncio.Future = self._loop.create_future()
        self._pending = fut
        self._pending_pid = pid
        self._pending_profile = profile

        req_data = [0x02, 0x01, pid, 0x00, 0x00, 0x00, 0x00, 0x00]
        await bus_manager.send(profile.request_id, req_data, is_extended_id=profile.is_extended)

        try:
            return await asyncio.wait_for(fut, timeout=REQUEST_TIMEOUT_S)
        finally:
            self._pending = None
            self._pending_pid = None
            self._pending_profile = None

    async def _request_pid(self, pid: int) -> float:
        profile = self.addressing or PROFILE_11BIT  # scan_supported() always sets this first
        payload = await self._request_raw(profile, pid)
        spec = PID_TABLE.get(pid)
        if spec is None:
            raise ValueError(f"No decoder registered for PID {pid:#04x}")
        return spec["decode"](payload)

    # ── Addressing detection ─────────────────────────────────────────────────
    async def _detect_addressing(self) -> Optional[tuple[AddressingProfile, bytes]]:
        # Try whatever worked last time first, so a rescan on the same
        # vehicle doesn't pay the other profile's timeout on every click.
        ordered = ADDRESSING_PROFILES
        if self.addressing is not None:
            ordered = (self.addressing,) + tuple(p for p in ADDRESSING_PROFILES if p is not self.addressing)

        for profile in ordered:
            try:
                payload = await self._request_raw(profile, 0x00)
                log.info("OBD: detected %s addressing (request %#x).", profile.name, profile.request_id)
                return profile, payload
            except asyncio.TimeoutError:
                log.info("OBD: no response using %s addressing.", profile.name)
                continue
        log.warning("OBD: no response using 11-bit or 29-bit addressing.")
        return None

    # ── PID auto-scan ────────────────────────────────────────────────────────
    async def scan_supported(self) -> set[int]:
        self.scanning = True
        found: set[int] = set()
        try:
            detected = await self._detect_addressing()
            if detected is None:
                self.addressing = None
                self.supported_pids = set()
                return self.supported_pids

            profile, first_payload = detected
            self.addressing = profile
            # SUPPORT_QUERY_PIDS[0] (0x00) is what _detect_addressing() just
            # asked -- reuse that response instead of asking again.
            found |= _decode_support_bitmask(SUPPORT_QUERY_PIDS[0], first_payload)
            for base in SUPPORT_QUERY_PIDS[1:]:
                try:
                    payload = await self._request_raw(profile, base)
                except asyncio.TimeoutError:
                    log.warning("OBD support scan: no response for PID group %#04x", base)
                    continue
                found |= _decode_support_bitmask(base, payload)
        finally:
            self.scanning = False
        # Only keep PIDs we actually know how to decode
        self.supported_pids = found & set(PID_TABLE.keys())
        self.monitor_status_supported = MONITOR_STATUS_PID in found
        if self.monitor_status_supported:
            try:
                payload = await self._request_raw(profile, MONITOR_STATUS_PID)
                self.monitor_status = _decode_monitor_status(payload)
                self._last_monitor_fetch = time.time()
            except asyncio.TimeoutError:
                log.warning("OBD: PID 0x01 reported supported but did not respond during scan.")
        return self.supported_pids

    # ── Live polling loop ────────────────────────────────────────────────────
    # Never auto-disables. On repeated failure it backs off to a slower retry
    # rate and flags data_stalled so the UI can show a clear, non-destructive
    # "not receiving data" state -- and it self-heals the instant a response
    # comes back, no re-enable required from the user.
    async def _poll_loop(self) -> None:
        log.info("OBD poll loop started.")
        consecutive_failures = 0
        while self.mode == "on":
            if self.monitor_status_supported and (time.time() - self._last_monitor_fetch) >= MONITOR_REFRESH_INTERVAL_S:
                try:
                    profile = self.addressing or PROFILE_11BIT
                    payload = await self._request_raw(profile, MONITOR_STATUS_PID)
                    self.monitor_status = _decode_monitor_status(payload)
                except asyncio.TimeoutError:
                    pass  # leave the last-known value showing rather than blanking it
                except Exception as exc:
                    log.warning("OBD monitor status refresh error: %s", exc)
                finally:
                    self._last_monitor_fetch = time.time()

            if not self.watched_pids:
                await asyncio.sleep(IDLE_GAP_S)
                continue
            for pid in list(self.watched_pids):
                if self.mode != "on":
                    break
                spec = PID_TABLE.get(pid)
                if spec is None:
                    continue
                try:
                    value = await self._request_pid(pid)
                    self.live_values[pid] = {
                        "pid": pid, "name": spec["name"], "unit": spec["unit"],
                        "value": value, "ts": time.time(), "stale": False,
                    }
                    if self.data_stalled:
                        log.info("OBD: responses resumed after %d failed requests.", consecutive_failures)
                    self.last_error = None
                    self.data_stalled = False
                    consecutive_failures = 0
                except asyncio.TimeoutError:
                    prev = self.live_values.get(pid, {"pid": pid, "name": spec["name"], "unit": spec["unit"]})
                    prev["stale"] = True
                    prev["ts"] = time.time()
                    self.live_values[pid] = prev
                    consecutive_failures += 1
                except Exception as exc:
                    self.last_error = str(exc)
                    log.warning("OBD poll error on PID %#04x: %s", pid, exc)
                    consecutive_failures += 1

                if consecutive_failures >= STALL_THRESHOLD and not self.data_stalled:
                    self.data_stalled = True
                    self.last_error = (
                        "Not receiving responses from the vehicle. Check the OBD-II "
                        "connector is fully seated and the adapter is connected. "
                        "Still retrying in the background -- values will resume "
                        "automatically as soon as responses come back."
                    )
                    log.warning(
                        "OBD: %d consecutive failed requests -- backing off to a "
                        "slower retry rate, decoder stays enabled.",
                        consecutive_failures,
                    )

                await asyncio.sleep(STALLED_GAP_S if self.data_stalled else POLL_GAP_S)
        log.info("OBD poll loop stopped.")

    # ── Public control surface (called from the router) ─────────────────────
    def set_mode(self, mode: str) -> None:
        if mode not in ("on", "off"):
            raise ValueError(f"Unknown mode: {mode!r}. Choose: on, off")
        if mode == self.mode:
            return
        self.mode = mode
        if mode == "on":
            self._loop = asyncio.get_event_loop()
            if self._poll_task is None or self._poll_task.done():
                self._poll_task = self._loop.create_task(self._poll_loop(), name="obd-poll")
        else:
            if self._poll_task is not None:
                self._poll_task.cancel()
                self._poll_task = None
            self.data_stalled = False

    def set_watched(self, pids: list[int]) -> None:
        # Only watch PIDs we actually have a decoder for -- avoids sending
        # requests for garbage PIDs from a malformed frontend call.
        self.watched_pids = [p for p in pids if p in PID_TABLE]

    def reset(self) -> None:
        self.set_mode("off")
        self.supported_pids = set()
        self.watched_pids = []
        self.live_values = {}
        self.last_error = None
        self.data_stalled = False
        self.addressing = None
        self.monitor_status = None
        self.monitor_status_supported = False
        self._last_monitor_fetch = 0.0

    def full_status(self) -> dict:
        return {
            "mode": self.mode,
            "scanning": self.scanning,
            "data_stalled": self.data_stalled,
            "addressing": self.addressing.name if self.addressing else None,
            "supported_pids": sorted(self.supported_pids),
            "watched_pids": self.watched_pids,
            "live_values": list(self.live_values.values()),
            "last_error": self.last_error,
            "monitor_status": self.monitor_status,
            "monitor_status_supported": self.monitor_status_supported,
            "known_pids": [
                {"pid": pid, "name": spec["name"], "unit": spec["unit"], "category": spec.get("category", "Other")}
                for pid, spec in sorted(PID_TABLE.items())
            ],
        }

    def status_dict(self) -> dict:
        """Small piggyback payload for the 1s WS stats broadcast."""
        return {
            "obd_mode": self.mode,
            "obd_scanning": self.scanning,
            "obd_data_stalled": self.data_stalled,
            "obd_addressing": self.addressing.name if self.addressing else None,
        }


# Singleton
obd_store = OBDStore()
