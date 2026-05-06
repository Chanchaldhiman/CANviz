"""
canviz/routers/canopen.py
-------------------------
REST endpoints for the CANopen decoder.

GET  /canopen/status         -- mode, nodes, SDO log, EMCY log, NMT log
POST /canopen/mode           -- {"mode": "on"} | {"mode": "off"}
POST /canopen/reset          -- clear all node state
POST /canopen/eds            -- upload EDS file (multipart)
DELETE /canopen/eds          -- unload current EDS
POST /canopen/sdo/read       -- initiate an SDO upload (expedited read) from a node
POST /canopen/nmt            -- send an NMT command (with confirmation required by frontend)
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel

from canviz.canopen_store import canopen_store, eds_store

log = logging.getLogger("canviz.canopen.router")

router = APIRouter(prefix="/canopen", tags=["canopen"])


# ── Pydantic models ───────────────────────────────────────────────────────────

class ModeRequest(BaseModel):
    mode: str   # "on" | "off"


class SdoReadRequest(BaseModel):
    node_id: int      # 1-127
    index: int        # object dictionary index (e.g. 0x1008)
    subindex: int = 0


class NmtRequest(BaseModel):
    node_id: int    # 0 = broadcast, 1-127 = specific node
    command: int    # 0x01=Operational, 0x02=Stop, 0x80=Pre-op, 0x81=Reset, 0x82=ResetComm
    confirmed: bool = False   # frontend must send True after user confirms


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/status")
async def get_status():
    """Full CANopen decoder status: nodes, SDO log, EMCY events, NMT commands."""
    return canopen_store.full_status()


@router.post("/mode")
async def set_mode(req: ModeRequest):
    try:
        canopen_store.set_mode(req.mode)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"ok": True, "mode": canopen_store.mode}


@router.post("/reset")
async def reset():
    """Clear all accumulated node state, SDO log, EMCY log."""
    canopen_store.reset()
    return {"ok": True}


# ── EDS endpoints ─────────────────────────────────────────────────────────────

@router.post("/eds")
async def upload_eds(file: UploadFile = File(...)):
    """
    Upload an EDS file. Replaces any previously loaded EDS.
    Accepts .eds files (DCF files work too -- same format).
    """
    content = await file.read()
    result  = eds_store.load(content, file.filename or "unknown.eds")
    if not result["ok"]:
        raise HTTPException(status_code=422, detail=result["message"])
    return result


@router.delete("/eds")
async def clear_eds():
    """Unload the current EDS file."""
    eds_store.clear()
    return {"ok": True}


# ── SDO read (expedited upload) ───────────────────────────────────────────────

@router.post("/sdo/read")
async def sdo_read(req: SdoReadRequest):
    """
    Initiate an expedited SDO upload from a live node.

    Constructs and sends the SDO initiate-upload request frame (COB-ID 0x600 + node_id).
    The response will arrive as a normal CAN frame and be decoded by canopen_store.
    The completed SDO transaction is visible in GET /canopen/status under recent_sdo.

    Requires an active CAN connection.
    """
    from canviz.bus import bus_manager

    if not bus_manager.connected:
        raise HTTPException(status_code=409, detail="Not connected to CAN bus")

    if not (1 <= req.node_id <= 127):
        raise HTTPException(status_code=400, detail="node_id must be 1-127")

    # SDO initiate upload request: command 0x40, index LSB, index MSB, subindex, 0x00*4
    cob_id = 0x600 + req.node_id
    cmd    = 0x40   # initiate upload request
    data   = [
        cmd,
        req.index & 0xFF,
        (req.index >> 8) & 0xFF,
        req.subindex & 0xFF,
        0x00, 0x00, 0x00, 0x00,
    ]

    try:
        await bus_manager.send(
            arbitration_id=cob_id,
            data=data,
            is_extended_id=False,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Send error: {exc}")

    return {
        "ok":      True,
        "message": f"SDO upload request sent to node 0x{req.node_id:02X}, "
                   f"index 0x{req.index:04X}:{req.subindex}",
    }


# ── NMT command ───────────────────────────────────────────────────────────────

_VALID_NMT_COMMANDS = {0x01, 0x02, 0x80, 0x81, 0x82}
_NMT_COMMAND_NAMES  = {
    0x01: "Start Node (Operational)",
    0x02: "Stop Node (Stopped)",
    0x80: "Enter Pre-Operational",
    0x81: "Reset Node (Application)",
    0x82: "Reset Communication",
}


@router.post("/nmt")
async def send_nmt(req: NmtRequest):
    """
    Send an NMT command frame.

    The frontend MUST send confirmed=True -- this prevents accidental NMT
    broadcasts from API calls that omit the field.

    NMT frame format: COB-ID 0x000, data=[cs, node_id]
    """
    if not req.confirmed:
        raise HTTPException(
            status_code=400,
            detail="confirmed must be true -- this prevents accidental NMT commands"
        )

    if req.command not in _VALID_NMT_COMMANDS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid NMT command 0x{req.command:02X}. "
                   f"Valid: {[hex(c) for c in sorted(_VALID_NMT_COMMANDS)]}"
        )

    from canviz.bus import bus_manager

    if not bus_manager.connected:
        raise HTTPException(status_code=409, detail="Not connected to CAN bus")

    try:
        await bus_manager.send(
            arbitration_id=0x000,
            data=[req.command, req.node_id & 0xFF],
            is_extended_id=False,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"NMT send error: {exc}")

    cmd_name = _NMT_COMMAND_NAMES.get(req.command, f"0x{req.command:02X}")
    target   = "all nodes" if req.node_id == 0 else f"node 0x{req.node_id:02X}"
    log.info("NMT sent: %s -> %s", cmd_name, target)

    return {
        "ok":      True,
        "message": f"NMT: {cmd_name} sent to {target}",
    }
