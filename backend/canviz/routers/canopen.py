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


# ── SDO write (expedited download) ────────────────────────────────────────────

class SdoWriteRequest(BaseModel):
    node_id:  int
    index:    int
    subindex: int = 0
    data:     list[int]   # raw bytes (1-4), user provides correct encoding
    confirmed: bool = False


@router.post("/sdo/write")
async def sdo_write(req: SdoWriteRequest):
    """
    Send an expedited SDO download (write) to a live node.

    The frontend MUST send confirmed=True to prevent accidental writes.
    data[] contains the raw byte values (little-endian, 1-4 bytes).
    The node's SDO download response will appear in GET /canopen/status
    under recent_sdo once it arrives and is decoded.

    CMD byte encoding per CiA 301 sec 7.2.4.3.3:
      0x23 = 4 bytes, 0x27 = 3 bytes, 0x2B = 2 bytes, 0x2F = 1 byte
    """
    if not req.confirmed:
        raise HTTPException(
            status_code=400,
            detail="confirmed must be true to prevent accidental SDO writes"
        )
    if not (1 <= req.node_id <= 127):
        raise HTTPException(status_code=400, detail="node_id must be 1-127")
    if not (1 <= len(req.data) <= 4):
        raise HTTPException(status_code=400, detail="data must be 1-4 bytes")

    from canviz.bus import bus_manager
    if not bus_manager.connected:
        raise HTTPException(status_code=409, detail="Not connected to CAN bus")

    size    = len(req.data)
    n       = 4 - size
    cmd     = 0x23 | (n << 2)
    padded  = list(req.data) + [0] * (4 - size)
    frame_data = [
        cmd,
        req.index & 0xFF,
        (req.index >> 8) & 0xFF,
        req.subindex & 0xFF,
    ] + padded[:4]

    try:
        await bus_manager.send(
            arbitration_id=0x600 + req.node_id,
            data=frame_data,
            is_extended_id=False,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Send error: {exc}")

    log.info(
        "SDO write sent to node 0x%02X index 0x%04X:%d data=%s",
        req.node_id, req.index, req.subindex, req.data,
    )
    return {
        "ok":      True,
        "message": f"SDO write sent to node 0x{req.node_id:02X}, "
                   f"index 0x{req.index:04X}:{req.subindex}, "
                   f"data={[hex(b) for b in req.data]}",
    }


# ── Object dictionary search ───────────────────────────────────────────────────

@router.get("/objects")
async def list_objects(q: str = ""):
    """
    Search the built-in CiA 301 + CiA 402 object dictionary.
    Returns up to 50 entries matching the query string (name or hex index).
    q is case-insensitive. Empty q returns the first 50 entries.
    """
    from canviz.canopen_store import _BUILTIN_OBJECTS

    q_lower = q.lower().strip()
    results = []
    for (index, sub), info in sorted(_BUILTIN_OBJECTS.items()):
        name        = info["name"]
        index_hex   = f"{index:04X}"
        index_hex_0x = f"0x{index_hex}"
        match = (
            not q_lower
            or q_lower in name.lower()
            or q_lower in index_hex.lower()
            or q_lower in index_hex_0x.lower()
        )
        if match:
            results.append({
                "index":    index_hex_0x,
                "subindex": sub,
                "name":     name,
                "unit":     info.get("unit", ""),
            })
        if len(results) >= 50:
            break

    return {"results": results, "total": len(results)}


# ── Node configuration export ─────────────────────────────────────────────────

class ExportRequest(BaseModel):
    node_ids: list[int] = []   # empty = all discovered nodes


# Standard objects to read per node during export
_EXPORT_OBJECTS: list[tuple[int, int, str]] = [
    (0x1008, 0, "Manufacturer Device Name"),
    (0x1018, 1, "Identity: Vendor ID"),
    (0x1018, 2, "Identity: Product Code"),
    (0x1018, 3, "Identity: Revision Number"),
    (0x1018, 4, "Identity: Serial Number"),
    (0x1009, 0, "Manufacturer Hardware Version"),
    (0x100A, 0, "Manufacturer Software Version"),
    (0x6041, 0, "Statusword"),
    (0x6061, 0, "Modes of Operation Display"),
    (0x6064, 0, "Position Actual Value"),
    (0x606C, 0, "Velocity Actual Value"),
    (0x6081, 0, "Profile Velocity"),
    (0x6083, 0, "Profile Acceleration"),
    (0x6084, 0, "Profile Deceleration"),
    (0x1017, 0, "Producer Heartbeat Time"),
]


@router.post("/export")
async def export_node_config(req: ExportRequest):
    """
    Export node configuration by reading standard SDO objects from all
    discovered nodes. Initiates SDO read requests -- responses will appear
    in the SDO log as they arrive from each node.

    Returns the list of requested reads so the caller can track progress.
    The actual values appear in GET /canopen/status recent_sdo after each
    node responds.

    Requires an active CAN connection. Node IDs are those discovered via
    heartbeat frames. Unresponsive nodes will timeout in the SDO pairing
    window (500ms) and not appear in the log.
    """
    from canviz.bus import bus_manager

    if not bus_manager.connected:
        raise HTTPException(status_code=409, detail="Not connected to CAN bus")

    status    = canopen_store.full_status()
    all_nodes = [n["node_id"] for n in status.get("nodes", [])]

    targets = req.node_ids if req.node_ids else all_nodes
    if not targets:
        raise HTTPException(
            status_code=404,
            detail="No nodes discovered yet. Enable the decoder and wait for heartbeat frames."
        )

    reads_sent: list[dict] = []
    import asyncio

    for node_id in targets:
        for index, subindex, name in _EXPORT_OBJECTS:
            cob_id = 0x600 + node_id
            data   = [
                0x40,
                index & 0xFF,
                (index >> 8) & 0xFF,
                subindex & 0xFF,
                0x00, 0x00, 0x00, 0x00,
            ]
            try:
                await bus_manager.send(
                    arbitration_id=cob_id,
                    data=data,
                    is_extended_id=False,
                )
                reads_sent.append({
                    "node_id":  node_id,
                    "index":    f"0x{index:04X}",
                    "subindex": subindex,
                    "name":     name,
                })
                # 8ms gap between requests to avoid flooding slow nodes
                await asyncio.sleep(0.008)
            except Exception as exc:
                log.warning("Export SDO read failed node=0x%02X 0x%04X: %s", node_id, index, exc)

    return {
        "ok":        True,
        "nodes":     targets,
        "reads_sent": len(reads_sent),
        "message":   f"Sent {len(reads_sent)} SDO read requests across {len(targets)} node(s). "
                     f"Responses appear in the SDO log as they arrive.",
    }
