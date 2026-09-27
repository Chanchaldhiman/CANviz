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
import math
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
        return [self._message_info(msg) for msg in self._db.messages]

    @staticmethod
    def _message_info(msg) -> dict:
        return {
            "id":          hex(msg.frame_id),
            "name":        msg.name,
            "length":      msg.length,
            "is_extended": bool(msg.is_extended_frame),
            "cycle_time":  msg.cycle_time,           # ms, from GenMsgCycleTime (or None)
            "senders":     list(msg.senders or []),
            "comment":     msg.comment or "",
            "signals":     [DBCStore._signal_info(s) for s in msg.signals],
        }

    @staticmethod
    def _signal_info(s) -> dict:
        return {
            "name":               s.name,
            "start":              s.start,
            "length":             s.length,
            "unit":               s.unit or "",
            "min":                s.minimum,
            "max":                s.maximum,
            "scale":              s.scale,
            "offset":             s.offset,
            "is_signed":          s.is_signed,
            "is_float":           s.is_float,
            "byte_order":         s.byte_order,
            "initial":            s.initial,
            # Value table (VAL_) as {raw value: label}; JSON keys are strings
            "choices":            {int(k): str(v) for k, v in (s.choices or {}).items()},
            "is_multiplexer":     s.is_multiplexer,
            "multiplexer_ids":    s.multiplexer_ids,
            "multiplexer_signal": s.multiplexer_signal,
            "comment":            s.comment or "",
        }

    def _get_message(self, name: str):
        if self._db is None:
            raise LookupError("No DBC loaded.")
        try:
            return self._db.get_message_by_name(name)
        except KeyError:
            raise LookupError(f"Message '{name}' not found in DBC.") from None

    def encode(self, message_name: str, signals: dict[str, float]) -> dict:
        """
        Encode physical signal values into a frame payload.

        Signals missing from `signals` default to their DBC initial value
        (GenSigStartValue) or 0. For multiplexed messages only the signals
        selected by the multiplexer value are used; the rest are ignored.

        Values outside the DBC [min|max] range are allowed on purpose, so
        out-of-range / fault values can be injected on a bench; values that do
        not fit the signal's bit width raise ValueError.

        Raises LookupError if no DBC / unknown message.
        """
        msg = self._get_message(message_name)
        values: dict[str, float] = {}
        for sig in msg.signals:
            v = signals.get(sig.name)
            if v is None:
                v = sig.initial if isinstance(sig.initial, (int, float)) else 0
            if not math.isfinite(v):
                raise ValueError(f"{sig.name}: value must be a finite number")
            values[sig.name] = v
        try:
            if msg.is_multiplexed():
                values = msg.gather_signals(values)
            data = msg.encode(values, strict=False)
        except OverflowError as exc:
            raise ValueError(f"Value does not fit the signal's bit width: {exc}") from exc
        except Exception as exc:
            raise ValueError(f"Could not encode {msg.name}: {exc}") from exc
        return {
            "message":     msg.name,
            "id":          msg.frame_id,
            "is_extended": bool(msg.is_extended_frame),
            "dlc":         msg.length,
            "data":        list(data),
            "signals":     {k: float(v) for k, v in values.items()},
        }

    def decode_message(self, message_name: str, data: bytes) -> dict[str, float]:
        """
        Decode `data` as the named message, returning {signal: physical value}.
        Short payloads are decoded as far as they go (missing signals omitted).

        Raises LookupError if no DBC / unknown message, ValueError on bad data.
        """
        msg = self._get_message(message_name)
        try:
            decoded = msg.decode(data, decode_choices=False, allow_truncated=True)
        except Exception as exc:
            raise ValueError(f"Could not decode {msg.name}: {exc}") from exc
        return {k: float(v) for k, v in decoded.items()}

    def _summary(self) -> dict:
        assert self._db is not None
        return {
            "filename":      self._path,
            "message_count": len(self._db.messages),
            "messages":      self.messages_list(),
        }


# Singleton
dbc_store = DBCStore()