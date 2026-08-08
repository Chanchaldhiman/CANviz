"""
canviz/routers/obd.py
----------------------
REST endpoints for OBD-II (Mode 01 live data, v1).

GET  /obd/status  - mode, supported PIDs, watched PIDs, live values
POST /obd/mode    - {"mode": "on"} | {"mode": "off"}
POST /obd/scan    - run PID support auto-scan, returns supported PID list
POST /obd/watch   - {"pids": [12, 13, ...]} set which PIDs the poll loop reads
POST /obd/reset   - clear all state and turn the decoder off
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from canviz.bus import bus_manager
from canviz.obd_store import obd_store

router = APIRouter(prefix="/obd", tags=["obd"])


class ModeRequest(BaseModel):
    mode: str  # "on" | "off"


class WatchRequest(BaseModel):
    pids: list[int]


@router.get("/status")
async def get_status():
    return obd_store.full_status()


@router.post("/mode")
async def set_mode(req: ModeRequest):
    if req.mode == "on" and not bus_manager.connected:
        raise HTTPException(status_code=400, detail="Connect to a bus before enabling OBD-II.")
    try:
        obd_store.set_mode(req.mode)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"ok": True, "mode": obd_store.mode}


@router.post("/scan")
async def scan():
    if not bus_manager.connected:
        raise HTTPException(status_code=400, detail="Connect to a bus before scanning.")
    if obd_store.mode != "on":
        raise HTTPException(status_code=400, detail="Enable the OBD-II decoder before scanning.")
    supported = await obd_store.scan_supported()
    return {
        "ok": True,
        "supported_pids": sorted(supported),
        "addressing": obd_store.addressing.name if obd_store.addressing else None,
    }


@router.post("/watch")
async def watch(req: WatchRequest):
    obd_store.set_watched(req.pids)
    return {"ok": True, "watched_pids": obd_store.watched_pids}


@router.post("/reset")
async def reset():
    obd_store.reset()
    return {"ok": True}
