"""
canviz/routers/j1939.py
-----------------------
REST endpoints for J1939 decoder control.

GET  /j1939/status   - mode, auto_detected, SA table, recent BAM/DM1
POST /j1939/mode     - set mode: {"mode": "on"} | {"mode": "off"}
POST /j1939/reset    - clear SA table and BAM sessions
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from canviz.j1939_store import j1939_store

router = APIRouter(prefix="/j1939", tags=["j1939"])


class ModeRequest(BaseModel):
    mode: str   # "on" | "off"


@router.get("/status")
async def get_status():
    return j1939_store.full_status()


@router.post("/mode")
async def set_mode(req: ModeRequest):
    try:
        j1939_store.set_mode(req.mode)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"ok": True, "mode": j1939_store.mode}


@router.post("/reset")
async def reset():
    j1939_store.reset()
    return {"ok": True}


@router.get("/debug/pgn_db")
async def debug_pgn_db():
    """
    Diagnostic endpoint - returns the raw top-level keys from J1939db.json
    and the first 5 entries so we can see the actual structure.
    Only used during development to diagnose pretty_j1939 loading issues.
    """
    import pathlib
    import json as _json
    try:
        import pretty_j1939  # type: ignore
        pkg_dir = pathlib.Path(pretty_j1939.__file__).parent
        db_path = pkg_dir / "J1939db.json"
        if not db_path.exists():
            return {"error": f"J1939db.json not found in {pkg_dir}"}
        with db_path.open("r", encoding="utf-8") as fh:
            data = _json.load(fh)
        top_keys = list(data.keys())
        samples: dict = {}
        for key in top_keys:
            val = data[key]
            if isinstance(val, dict):
                first_5 = dict(list(val.items())[:5])
                samples[key] = {"type": "dict", "len": len(val), "first_5": first_5}
            elif isinstance(val, list):
                samples[key] = {"type": "list", "len": len(val), "first_2": val[:2]}
            else:
                samples[key] = {"type": type(val).__name__, "value": str(val)[:200]}
        return {"top_keys": top_keys, "samples": samples}
    except ImportError:
        return {"error": "pretty_j1939 not installed"}
    except Exception as exc:
        return {"error": str(exc)}
