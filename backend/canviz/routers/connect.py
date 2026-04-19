"""
canviz/routers/connect.py
-------------------------
REST endpoints for bus lifecycle management.

POST /connect    — open the CAN interface and start streaming
POST /disconnect — stop the interface cleanly
GET  /status     — current connection state
"""

from fastapi import APIRouter, HTTPException

from canviz.bus import bus_manager
from canviz.config import settings
from canviz.models import ConnectRequest, ConnectionStatus
from canviz.ws_broadcaster import broadcaster

router = APIRouter(tags=["connection"])


@router.post("/connect", response_model=ConnectionStatus)
async def connect(req: ConnectRequest):
    # For gs_usb: channel field holds the device index (int, default 0)
    # For slcan/socketcan: channel field holds the port string (e.g. "COM3")
    if req.interface == "gs_usb":
        index   = int(req.channel) if req.channel != "" else req.index
        channel = ""
    else:
        index   = req.index
        channel = str(req.channel)

    try:
        await bus_manager.connect(
            interface=req.interface,
            channel=channel,
            bitrate=req.bitrate,
            index=index,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    bus_manager.add_frame_callback(broadcaster.on_frame)
    broadcaster.start()

    return _status()


@router.post("/disconnect", response_model=ConnectionStatus)
async def disconnect():
    bus_manager.remove_frame_callback(broadcaster.on_frame)
    broadcaster.clear_queue()
    await bus_manager.disconnect()
    return _status()


@router.get("/status", response_model=ConnectionStatus)
async def status():
    return _status()


def _status() -> ConnectionStatus:
    return ConnectionStatus(
        connected=bus_manager.connected,
        interface=settings.interface,
        channel=settings.channel,
        bitrate=settings.bitrate,
        index=settings.index,
        error=bus_manager.error,
    )
