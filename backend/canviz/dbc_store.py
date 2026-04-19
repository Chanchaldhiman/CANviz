"""
canviz/dbc_store.py
-------------------
Holds the in-memory DBC database (if loaded) and provides a single
decode() call that the WebSocket broadcaster uses to enrich frames.

cantools is the decode engine.  Malformed DBC files produce a
structured error — never a crash.
"""

from __future__ import annotations

import logging
from typing import Optional

import cantools
import cantools.database

log = logging.getLogger("canviz.dbc")


class DBCStore:
    def __init__(self) -> None:
        self._db: Optional[cantools.database.Database] = None
        self._path: str = ""

    @property
    def loaded(self) -> bool:
        return self._db is not None

    @property
    def path(self) -> str:
        return self._path

    def load(self, content: bytes, filename: str) -> dict:
        """
        Parse a DBC file from raw bytes.
        Returns a summary dict on success, raises ValueError on bad DBC.
        """
        try:
            db = cantools.database.Database()
            db.add_dbc_string(content.decode("utf-8", errors="replace"))
            self._db   = db
            self._path = filename
            log.info("DBC loaded: %s (%d messages)", filename, len(db.messages))
            return self._summary()
        except Exception as exc:
            log.warning("DBC parse failed: %s", exc)
            raise ValueError(f"Could not parse DBC file: {exc}") from exc

    def unload(self) -> None:
        self._db   = None
        self._path = ""

    def decode(self, arbitration_id: int, data: bytes) -> list[dict]:
        """
        Attempt to decode a frame.
        Returns a list of signal dicts matching the frontend CanFrame type:
            [{name, value, unit, message_name}, ...]
        Returns [] if no DBC loaded or ID not in DBC.
        """
        if self._db is None:
            return []
        try:
            message = self._db.get_message_by_frame_id(arbitration_id)
            decoded = message.decode(data, decode_choices=False)
            # Build signal lookup for units
            signal_map = {s.name: s for s in message.signals}
            result = []
            for name, value in decoded.items():
                sig = signal_map.get(name)
                result.append({
                    "name":         name,
                    "value":        float(value),
                    "unit":         (sig.unit or "") if sig else "",
                    "message_name": message.name,
                })
            return result
        except KeyError:
            return []  # ID not in DBC — normal for mixed bus traffic
        except Exception as exc:
            log.debug("Decode error id=0x%X: %s", arbitration_id, exc)
            return []

    def messages_list(self) -> list[dict]:
        """Return all message definitions for GET /dbc/messages."""
        if self._db is None:
            return []
        out = []
        for msg in self._db.messages:
            out.append({
                "id":      hex(msg.frame_id),
                "name":    msg.name,
                "length":  msg.length,
                "signals": [
                    {
                        "name":   s.name,
                        "start":  s.start,
                        "length": s.length,
                        "unit":   s.unit or "",
                        "min":    s.minimum,
                        "max":    s.maximum,
                    }
                    for s in msg.signals
                ],
            })
        return out

    def _summary(self) -> dict:
        assert self._db is not None
        return {
            "filename":      self._path,
            "message_count": len(self._db.messages),
            "messages":      self.messages_list(),
        }


# Singleton
dbc_store = DBCStore()