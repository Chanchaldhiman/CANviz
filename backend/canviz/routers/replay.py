"""
backend/canviz/routers/replay.py

Replay router — Phase 2 addition.
Accepts an uploaded .asc or .csv log file and replays it through
the virtual bus at a configurable speed multiplier, emitting frames
over the existing WebSocket just like live hardware would.

Assumptions & limitations:
- Only one replay session at a time (single-channel, v1 scope).
- .asc timing is read from the timestamp column; .csv must have a
  'timestamp' column in seconds (float).
- Speed multiplier is applied globally — no per-frame jitter removal.
- Progress is estimated from file position, not frame count, for simplicity.
- Replay uses the virtual bus internally regardless of the configured
  hardware interface — it does NOT transmit onto a real CAN bus.
"""

from __future__ import annotations

import asyncio
import csv
import io
import os
import re
import time
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

router = APIRouter(prefix="/replay", tags=["replay"])

# Temporary upload directory — created at startup if missing
UPLOAD_DIR = Path(os.getenv("canviz_UPLOAD_DIR", "/tmp/canviz_replay"))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class ReplayStartRequest(BaseModel):
    filename: str       # server-side filename returned by /replay/upload
    speed: float = 1.0  # multiplier: 0.5 | 1 | 2 | 5 | 10


class ReplayStatus(BaseModel):
    active: bool
    paused: bool
    speed: float
    progress: float     # 0.0 – 100.0
    filename: Optional[str] = None


# ---------------------------------------------------------------------------
# In-process replay state
# ---------------------------------------------------------------------------

class _ReplaySession:
    def __init__(self) -> None:
        self.active   = False
        self.paused   = False
        self.speed    = 1.0
        self.progress = 0.0
        self.filename: Optional[str] = None
        self._task: Optional[asyncio.Task] = None  # type: ignore[type-arg]
        self._pause_event = asyncio.Event()
        self._pause_event.set()   # not paused initially
        self._stop_flag = False
        # Injected at startup via set_broadcast_fn() — no hardcoded import
        self._broadcast_fn = None

    def reset(self) -> None:
        self.active   = False
        self.paused   = False
        self.progress = 0.0
        self.filename = None
        self._stop_flag = True
        self._pause_event.set()   # unblock if paused


_session = _ReplaySession()


def set_broadcast_fn(fn) -> None:
    """
    Call this once at app startup to inject the WebSocket broadcast function.
    This avoids any hardcoded import from your connection module.

    Example in your main.py / app factory:

        from canviz.routers.replay import set_broadcast_fn
        from canviz.connection import broadcast_frame   # whatever your path is
        set_broadcast_fn(broadcast_frame)

    The function must accept a single dict with keys:
        id, dlc, data, timestamp, is_extended_id, is_fd, decoded_signals
    and be an async coroutine.
    """
    _session._broadcast_fn = fn


# ---------------------------------------------------------------------------
# Frame parsers
# ---------------------------------------------------------------------------

# ASC line example:
#   0.123456 1  123             Rx   d 8 FF 00 3C 00 00 00 00 00
_ASC_RE = re.compile(
    r"^\s*(\d+\.\d+)\s+\d+\s+([0-9A-Fa-f]+)\s+\w+\s+d\s+(\d+)\s+((?:[0-9A-Fa-f]{2}\s*)*)"
)


def _parse_asc(content: str):
    """Yield (timestamp_s, id, dlc, data_bytes) from an ASC log."""
    for line in content.splitlines():
        m = _ASC_RE.match(line)
        if m:
            ts   = float(m.group(1))
            fid  = int(m.group(2), 16)
            dlc  = int(m.group(3))
            data = [int(b, 16) for b in m.group(4).split() if b]
            yield ts, fid, dlc, data[:dlc]


def _parse_csv(content: str):
    """Yield (timestamp_s, id, dlc, data_bytes) from a CANvas CSV log.

    Expected columns: timestamp, id, dlc, data, is_extended_id
    Backend writes:
      - id   as bare hex without 0x prefix (e.g. "100", "1FF")
      - data as concatenated hex pairs without spaces (e.g. "FFDEADBEEF000000")
    """
    reader = csv.DictReader(io.StringIO(content))
    for row in reader:
        try:
            ts  = float(row["timestamp"])
            # ID is always written as hex by the backend — never decimal
            fid = int(row["id"], 16)
            dlc = int(row["dlc"])
            # Data is concatenated hex pairs — split every 2 chars
            raw  = row.get("data", "").strip()
            data = [int(raw[i:i+2], 16) for i in range(0, len(raw), 2) if raw[i:i+2]]
            yield ts, fid, dlc, data[:dlc]
        except (KeyError, ValueError):
            continue


# ---------------------------------------------------------------------------
# Replay worker (runs as asyncio task)
# ---------------------------------------------------------------------------

async def _replay_worker(filepath: Path, speed: float, broadcast_fn) -> None:
    """
    Read log file, replay frames at scaled timing into the WebSocket broadcast.

    broadcast_fn should be the same callable used by the frame reader loop —
    imported from the connection manager at call time to avoid circular imports.
    """
    content = filepath.read_text(errors="replace")

    # Choose parser
    suffix = filepath.suffix.lower()
    if suffix == ".asc":
        frames = list(_parse_asc(content))
    elif suffix == ".csv":
        frames = list(_parse_csv(content))
    else:
        return

    if not frames:
        return

    total = len(frames)
    t0_log  = frames[0][0]          # first frame timestamp in log
    t0_wall = time.monotonic()

    for i, (ts, fid, dlc, data) in enumerate(frames):
        if _session._stop_flag:
            break

        # Wait if paused
        await _session._pause_event.wait()
        if _session._stop_flag:
            break

        # Compute desired wall-clock time for this frame
        log_offset  = ts - t0_log
        wall_target = t0_wall + log_offset / speed
        now         = time.monotonic()
        sleep_for   = wall_target - now

        if sleep_for > 0:
            # Sleep in small chunks so pause/stop can interrupt
            chunk = min(sleep_for, 0.05)
            while sleep_for > 0 and not _session._stop_flag:
                await asyncio.sleep(chunk)
                if _session.paused:
                    # Re-wait on resume; adjust t0_wall to account for pause duration
                    pause_start = time.monotonic()
                    await _session._pause_event.wait()
                    pause_dur = time.monotonic() - pause_start
                    t0_wall += pause_dur
                sleep_for -= chunk
                chunk = min(sleep_for, 0.05)

        if _session._stop_flag:
            break

        # Emit frame as JSON dict — broadcast_fn handles serialisation
        frame_dict = {
            "id":             fid,
            "dlc":            dlc,
            "data":           data,
            "timestamp":      ts,
            "is_extended_id": fid > 0x7FF,
            "is_fd":          False,
            "decoded_signals": [],
        }
        try:
            await broadcast_fn(frame_dict)
        except Exception:
            pass  # Client may have disconnected

        _session.progress = (i + 1) / total * 100.0

    _session.active   = False
    _session.progress = 100.0 if not _session._stop_flag else _session.progress


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/upload")
async def upload_replay_file(file: UploadFile = File(...)):
    """Accept a .asc or .csv file and store it server-side for replay."""
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in {".asc", ".csv"}:
        raise HTTPException(status_code=400, detail="Only .asc and .csv files are supported")

    dest = UPLOAD_DIR / file.filename
    dest.write_bytes(await file.read())

    return {"filename": file.filename, "size": dest.stat().st_size}


@router.post("/start")
async def replay_start(req: ReplayStartRequest):
    """Begin replaying an uploaded log file."""
    if _session.active:
        raise HTTPException(status_code=409, detail="A replay session is already active. Stop it first.")

    filepath = UPLOAD_DIR / req.filename
    if not filepath.exists():
        raise HTTPException(status_code=404, detail=f"File '{req.filename}' not found. Upload it first via /replay/upload.")

    if req.speed <= 0:
        raise HTTPException(status_code=400, detail="speed must be > 0")

    # Reset session
    _session.reset()
    _session._stop_flag = False
    _session.active   = True
    _session.paused   = False
    _session.speed    = req.speed
    _session.filename = req.filename
    _session.progress = 0.0
    _session._pause_event.set()

    # Use the injected broadcast function (set via set_broadcast_fn() at startup)
    broadcast_fn = _session._broadcast_fn
    if broadcast_fn is None:
        # Fallback no-op — works in dev/testing without full backend wired up
        async def broadcast_fn(_frame):  # type: ignore
            pass

    loop = asyncio.get_event_loop()
    _session._task = loop.create_task(_replay_worker(filepath, req.speed, broadcast_fn))

    return {"message": f"Replay started: {req.filename} at {req.speed}×"}


@router.post("/pause")
async def replay_pause():
    if not _session.active:
        raise HTTPException(status_code=409, detail="No active replay session")
    _session.paused = True
    _session._pause_event.clear()
    return {"message": "Replay paused"}


@router.post("/resume")
async def replay_resume():
    if not _session.active:
        raise HTTPException(status_code=409, detail="No active replay session")
    _session.paused = False
    _session._pause_event.set()
    return {"message": "Replay resumed"}


@router.post("/stop")
async def replay_stop():
    _session.reset()
    if _session._task and not _session._task.done():
        _session._task.cancel()
    return {"message": "Replay stopped"}


@router.get("/status", response_model=ReplayStatus)
async def replay_status():
    return ReplayStatus(
        active=_session.active,
        paused=_session.paused,
        speed=_session.speed,
        progress=_session.progress,
        filename=_session.filename,
    )
