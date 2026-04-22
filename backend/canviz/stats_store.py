"""
Thread-safe bus statistics accumulator.

on_frame() is called from the python-can reader thread (not the asyncio event loop),
so all mutations use threading.Lock. The read side (REST + WebSocket snapshot)
runs on the asyncio thread and only calls snapshot(), which acquires the same lock.
"""
from __future__ import annotations

import threading
import time


class StatsStore:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._bitrate: int = 500_000
        self._connect_time: float | None = None
        self._reset()

    def _reset(self) -> None:
        self._frames_rx: int = 0
        self._frames_tx: int = 0
        self._error_frames: int = 0
        self._bus_off_events: int = 0
        self._bytes_rx: int = 0
        self._bytes_tx: int = 0
        self._window_rx: int = 0
        self._window_start: float = time.monotonic()
        self._last_fps: float = 0.0
        self._last_bus_load: float = 0.0

    # ── connection lifecycle ───────────────────────────────────────────────

    def on_connect(self, bitrate: int) -> None:
        with self._lock:
            self._bitrate = bitrate
            self._connect_time = time.monotonic()
            self._reset()

    def on_disconnect(self) -> None:
        with self._lock:
            self._connect_time = None

    # ── called from python-can reader thread ───────────────────────────────

    def on_frame(self, *, is_error: bool, dlc: int) -> None:
        with self._lock:
            if is_error:
                self._error_frames += 1
            else:
                self._frames_rx += 1
                self._bytes_rx += dlc
                self._window_rx += 1

    def on_tx(self, dlc: int) -> None:
        with self._lock:
            self._frames_tx += 1
            self._bytes_tx += dlc

    # ── read side (asyncio thread) - called ~once per second ──────────────

    def snapshot(self) -> dict:
        now = time.monotonic()
        with self._lock:
            elapsed = now - self._window_start
            if elapsed >= 0.5:
                fps = self._window_rx / elapsed
                # CAN 2.0 standard frame overhead ≈ 44 bits + 8 bits/byte payload.
                # 111 bits is the typical worst-case for an 8-byte standard frame.
                # This is a frame-rate-based estimate - not bit-level hardware measurement.
                avg_frame_bits = 111
                bus_load = (fps * avg_frame_bits / max(self._bitrate, 1)) * 100.0
                self._last_fps = fps
                self._last_bus_load = min(bus_load, 100.0)
                self._window_rx = 0
                self._window_start = now

            total_rx = self._frames_rx
            total_err = self._error_frames
            uptime = (now - self._connect_time) if self._connect_time else None

            return {
                "type": "stats",
                "frames_rx": total_rx,
                "frames_tx": self._frames_tx,
                "error_frames": total_err,
                "error_pct": round((total_err / max(total_rx + total_err, 1)) * 100, 2),
                "bus_off_events": self._bus_off_events,
                "fps": round(self._last_fps, 1),
                "bus_load_pct": round(self._last_bus_load, 2),
                "bytes_rx": self._bytes_rx,
                "bytes_tx": self._bytes_tx,
                "bitrate": self._bitrate,
                "uptime_s": round(uptime, 1) if uptime is not None else None,
                "connected": self._connect_time is not None,
            }


# Module-level singleton - import `stats` everywhere
stats = StatsStore()