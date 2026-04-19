"""
canviz/routers/log.py
---------------------
Session logging endpoints.

POST /log/start  — begin recording frames to .asc and .csv
POST /log/stop   — stop recording; returns download paths
GET  /log/download/{filename} — serve the recorded file

Frames are written asynchronously via aiofiles so the event loop
is never blocked by disk I/O.
"""

from __future__ import annotations

import asyncio
import csv
import io
import logging
import time
from pathlib import Path
from typing import Optional

import aiofiles
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from canviz.bus import bus_manager

log = logging.getLogger("canviz.log")
router = APIRouter(prefix="/log", tags=["logging"])

# Where logs are written — will be created if it doesn't exist
LOG_DIR = Path("logs")

_session: Optional["LogSession"] = None


class LogSession:
    def __init__(self, base: str) -> None:
        LOG_DIR.mkdir(exist_ok=True)
        self.base    = base
        self.asc_path = LOG_DIR / f"{base}.asc"
        self.csv_path = LOG_DIR / f"{base}.csv"
        self._queue: asyncio.Queue = asyncio.Queue()
        self._task: Optional[asyncio.Task] = None
        self._start_time = time.monotonic()
        self._count = 0

    async def start(self) -> None:
        self._task = asyncio.get_event_loop().create_task(
            self._writer_loop(), name="log-writer"
        )
        bus_manager.add_frame_callback(self._on_frame)
        log.info("Logging started → %s / %s", self.asc_path, self.csv_path)

    async def stop(self) -> dict:
        bus_manager.remove_frame_callback(self._on_frame)
        await self._queue.put(None)  # sentinel
        if self._task:
            await self._task
        log.info("Logging stopped. %d frames written.", self._count)
        return {
            "frames":   self._count,
            "asc_file": str(self.asc_path),
            "csv_file": str(self.csv_path),
        }

    def _on_frame(self, msg) -> None:
        try:
            self._queue.put_nowait(msg)
        except asyncio.QueueFull:
            pass

    async def _writer_loop(self) -> None:
        async with aiofiles.open(self.asc_path, "w") as asc_f, \
                   aiofiles.open(self.csv_path, "w") as csv_f:

            # ASC header
            await asc_f.write(f"date {time.strftime('%a %b %d %H:%M:%S %Y')}\n")
            await asc_f.write("base hex  timestamps absolute\n")
            await asc_f.write("no internal events logged\n")

            # CSV header
            await csv_f.write("timestamp,id,dlc,data,is_extended_id\n")

            while True:
                msg = await self._queue.get()
                if msg is None:
                    break

                ts   = round(msg.timestamp, 6)
                id_s = f"{msg.arbitration_id:X}"
                data = " ".join(f"{b:02x}" for b in msg.data)
                ext  = "1" if msg.is_extended_id else "0"

                # ASC line:  timestamp  channel  id  dir  dlc  data
                await asc_f.write(
                    f"   {ts:.6f} 1  {id_s}  Rx   d {msg.dlc}  {data}\n"
                )
                # CSV line
                await csv_f.write(
                    f"{ts},{id_s},{msg.dlc},{data.replace(' ', '')},{ext}\n"
                )
                self._count += 1


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/start")
async def log_start():
    global _session
    if _session is not None:
        raise HTTPException(status_code=400, detail="Already logging. Call /log/stop first.")
    if not bus_manager.connected:
        raise HTTPException(status_code=400, detail="Not connected. Call /connect first.")

    base = time.strftime("canviz_%Y%m%d_%H%M%S")
    _session = LogSession(base)
    await _session.start()
    return {"ok": True, "base": base}


@router.post("/stop")
async def log_stop():
    global _session
    if _session is None:
        raise HTTPException(status_code=400, detail="Not currently logging.")
    result = await _session.stop()
    _session = None
    return {"ok": True, **result}


@router.get("/download/{filename}")
async def log_download(filename: str):
    # Sanitise — only allow files inside LOG_DIR
    target = (LOG_DIR / filename).resolve()
    if not str(target).startswith(str(LOG_DIR.resolve())):
        raise HTTPException(status_code=400, detail="Invalid filename.")
    if not target.exists():
        raise HTTPException(status_code=404, detail="File not found.")
    return FileResponse(path=str(target), filename=filename)
