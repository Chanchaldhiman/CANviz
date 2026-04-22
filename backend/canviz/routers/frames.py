"""
canviz/routers/frames.py
------------------------
WebSocket endpoint for live frame streaming + REST send endpoint.

GET  /ws/frames  — WebSocket, streams every received CAN frame as JSON
POST /send       — transmit a manually crafted frame onto the bus
"""

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

from canviz.bus import bus_manager
from canviz.models import SendFrameRequest
from canviz.ws_broadcaster import broadcaster
from canviz.stats_store import stats

router = APIRouter(tags=["frames"])


@router.websocket("/ws/frames")
async def ws_frames(websocket: WebSocket):
    await broadcaster.register(websocket)
    try:
        # Keep alive — we only need to detect disconnection
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await broadcaster.unregister(websocket)


@router.post("/send")
async def send_frame(req: SendFrameRequest):
    if not bus_manager.connected:
        raise HTTPException(status_code=400, detail="Not connected. Call /connect first.")
    if len(req.data) > 8:
        raise HTTPException(status_code=400, detail="CAN 2.0 data max 8 bytes.")
    try:
        await bus_manager.send(req.id, req.data, req.is_extended_id)
        stats.on_tx(len(req.data))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return {"ok": True, "id": hex(req.id), "data": req.data}
