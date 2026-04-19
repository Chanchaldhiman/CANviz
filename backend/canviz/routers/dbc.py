"""
canviz/routers/dbc.py
---------------------
DBC file management endpoints.

POST   /dbc/load      — upload and parse a DBC file
GET    /dbc/messages  — list all decoded message definitions
DELETE /dbc           — unload the current DBC
"""

from fastapi import APIRouter, HTTPException, UploadFile, File

from canviz.dbc_store import dbc_store

router = APIRouter(prefix="/dbc", tags=["dbc"])


@router.post("/load")
async def load_dbc(file: UploadFile = File(...)):
    content = await file.read()
    if not file.filename or not file.filename.lower().endswith(".dbc"):
        raise HTTPException(status_code=400, detail="File must have a .dbc extension.")
    try:
        summary = dbc_store.load(content, file.filename)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return summary


@router.get("/messages")
async def get_messages():
    if not dbc_store.loaded:
        return {"loaded": False, "messages": []}
    return {"loaded": True, "filename": dbc_store.path, "messages": dbc_store.messages_list()}


@router.delete("")
async def unload_dbc():
    dbc_store.unload()
    return {"ok": True, "message": "DBC unloaded."}
