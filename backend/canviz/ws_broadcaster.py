"""
canviz/ws_broadcaster.py
------------------------
Manages all connected WebSocket clients and broadcasts frames to them.

Design:
- BusManager fires a sync callback for every received frame
- The callback puts the frame on an asyncio.Queue
- A broadcaster coroutine drains the queue and fans out to all clients
- This keeps the bus reader thread decoupled from async WebSocket sends

Throttling hook is present but inactive in v1 (threshold=0 disables it).
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Optional

from fastapi import WebSocket
from starlette.websockets import WebSocketState

from canviz.dbc_store import dbc_store

log = logging.getLogger("canviz.ws")

# Throttle: drop frames if queue backlog exceeds this size (0 = disabled in v1)
_THROTTLE_QUEUE_DEPTH = 0


class WSBroadcaster:
    def __init__(self) -> None:
        self._clients: list[WebSocket] = []
        # Queue is created lazily in start() — NOT here.
        # Reason: asyncio.Queue binds to the running event loop at creation time.
        # In tests, pytest-asyncio creates a new loop per test function (STRICT
        # mode). If the Queue were created in __init__ (module import time or
        # first test's loop), every subsequent test would hit:
        #   RuntimeError: <Queue ...> is bound to a different event loop
        self._queue: Optional[asyncio.Queue] = None
        self._broadcaster_task: Optional[asyncio.Task] = None

    # ── Lifecycle ────────────────────────────────────────────────────────────

    def start(self) -> None:
        # Only create the queue if it does not already exist.
        # Re-creating it on every connect() call would orphan the existing
        # _broadcast_loop which is blocked on await self._queue.get() — the
        # await holds a reference to the OLD queue object, so the loop would
        # be stuck forever while new frames go into the unreachable new queue.
        if self._queue is None:
            self._queue = asyncio.Queue(maxsize=10_000)
        if self._broadcaster_task is None or self._broadcaster_task.done():
            self._broadcaster_task = asyncio.get_event_loop().create_task(
                self._broadcast_loop(), name="ws-broadcaster"
            )

    async def stop(self) -> None:
        if self._broadcaster_task:
            self._broadcaster_task.cancel()
            try:
                await self._broadcaster_task
            except (asyncio.CancelledError, RuntimeError):
                pass
            self._broadcaster_task = None
        self._queue = None
        self._clients.clear()

    # ── Client management ─────────────────────────────────────────────────────

    async def register(self, ws: WebSocket) -> None:
        await ws.accept()
        self._clients.append(ws)
        log.info("WS client connected. Total: %d", len(self._clients))

    async def unregister(self, ws: WebSocket) -> None:
        self._clients = [c for c in self._clients if c is not ws]
        log.info("WS client disconnected. Total: %d", len(self._clients))

    def clear_queue(self) -> None:
        """
        Drain stale frames from the queue without replacing the queue object.
        Call this after removing the frame callback on disconnect so that
        reconnect starts with a clean slate and correct fps calculation.
        Replacing the queue object would orphan the broadcast loop (it holds
        a reference to the old Queue in its await), so we drain instead.
        """
        if self._queue is None:
            return
        drained = 0
        while not self._queue.empty():
            try:
                self._queue.get_nowait()
                drained += 1
            except Exception:
                break
        if drained:
            log.debug("Drained %d stale frames from broadcaster queue.", drained)

    # ── Frame ingestion (called from BusManager callback — sync) ─────────────

    def on_frame(self, msg) -> None:
        """
        Sync callback — called from the bus reader thread.
        Converts the python-can Message to a JSON-serialisable dict
        and puts it on the queue for the async broadcaster.
        """
        if self._queue is None:
            return  # broadcaster stopped or not yet started

        # Drop error/status frames reported by Candlelight firmware.
        # These are internal device notifications (error-passive, bus-off, etc.)
        # that python-can surfaces as regular messages — they are never on the
        # physical CAN bus wire and should not appear in the frame table.
        if msg.is_error_frame:
            return

        if _THROTTLE_QUEUE_DEPTH and self._queue.qsize() >= _THROTTLE_QUEUE_DEPTH:
            return  # drop frame

        signals = dbc_store.decode(msg.arbitration_id, bytes(msg.data))

        frame = {
            "id":             hex(msg.arbitration_id),
            "dlc":            msg.dlc,
            "data":           list(msg.data),
            "timestamp":      round(msg.timestamp, 6),
            "is_extended_id": msg.is_extended_id,
            "is_fd":          msg.is_fd,
            "channel":        0,
            "signals":        signals,
        }

        try:
            self._queue.put_nowait(frame)
        except asyncio.QueueFull:
            log.warning("WS queue full — frame dropped")

    # ── Broadcaster coroutine ────────────────────────────────────────────────

    async def _broadcast_loop(self) -> None:
        log.debug("Broadcaster loop started.")
        while True:
            if self._queue is None:
                break
            frame = await self._queue.get()
            if not self._clients:
                continue

            payload = json.dumps(frame)
            dead: list[WebSocket] = []

            for ws in list(self._clients):
                try:
                    if ws.client_state == WebSocketState.CONNECTED:
                        await ws.send_text(payload)
                except Exception:
                    dead.append(ws)

            for ws in dead:
                await self.unregister(ws)


# Singleton
broadcaster = WSBroadcaster()
