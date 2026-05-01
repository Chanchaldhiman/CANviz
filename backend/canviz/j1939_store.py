"""
canviz/j1939_store.py
---------------------
J1939 passive decoder.

pretty_j1939 JSON structure (confirmed from /j1939/debug/pgn_db):
    J1939PGNdb      - PGN definitions  (13 in bundled free DB)
    J1939SATabledb  - SA address names (99 entries - main value of bundled DB)
    J1939SPNdb      - SPN definitions  (11 entries in bundled DB)

The bundled DB has only 13 PGNs because it only includes freely licensed data.
Our built-in table (52 PGNs) is better for PGN names.
SA names (99 entries) and SPN definitions are the real gain from the bundled DB.

For full PGN/SPN coverage obtain the SAE J1939 Digital Annex, run:
    create_j1939db-json -f J1939DA.xlsx -w J1939db.json
then place the result at:
    Windows: %APPDATA%\\pretty_j1939\\J1939db.json
    Linux:   ~/.config/pretty_j1939/J1939db.json
"""

from __future__ import annotations

import json
import logging
import os
import pathlib
import time
import threading
from dataclasses import dataclass, field
from typing import Optional

log = logging.getLogger("canviz.j1939")

# ── PGN name database (built-in, 52 entries) ──────────────────────────────────

_PGN_NAMES: dict[int, str] = {
    0xEC00: "TP.CM - Connection Management",
    0xEB00: "TP.DT - Data Transfer",
    0xEA00: "RQST - Request PGN",
    0xEE00: "AC - Address Claimed",
    0xF003: "EEC2 - Engine Control 2",
    0xF004: "EEC1 - Engine Speed / Torque",
    0xF005: "TC1 - Transmission Control 1",
    0xFECA: "DM1 - Active Diagnostic Trouble Codes",
    0xFECB: "DM2 - Previously Active DTCs",
    0xFECC: "DM3 - Diagnostic Data Clear",
    0xFECD: "DM4 - Freeze Frame Parameters",
    0xFECE: "DM5 - Diagnostic Readiness 1",
    0xFECF: "DM6 - Emission-Related Faults",
    0xFED0: "DM7 - Link-Specific Read Command",
    0xFED1: "DM8 - Memory Access",
    0xFED4: "DM11 - Clear Active DTCs",
    0xFEDA: "DM12 - Emissions-Related Active DTCs",
    0xFEDB: "DM13 - Stop/Start Broadcast",
    0xFEDF: "EEC3 - Engine Control 3",
    0xFEDE: "EEC4 - Engine Control 4",
    0xFEDD: "EEC5 - Engine Control 5",
    0xFEE5: "HOURS - Engine Hours / Revolutions",
    0xFEE0: "VD - Vehicle Distance",
    0xFEE9: "LFC - Fuel Consumption (Liquid)",
    0xFEF1: "CCVS - Cruise Control / Vehicle Speed",
    0xFEF2: "LFE - Fuel Economy (Liquid)",
    0xFEF3: "ET1 - Engine Temperature 1",
    0xFEF4: "IC1 - Inlet/Exhaust Conditions 1",
    0xFEF5: "AMB - Ambient Conditions",
    0xFEF6: "AICR - Aftertreatment 1 Intake Gas",
    0xFEF7: "VEP1 - Vehicle Electrical Power 1",
    0xFEF8: "TF - Transmission Fluids",
    0xFEF9: "ERC1 - Engine Retarder Controller 1",
    0xFEFA: "ERC2 - Engine Retarder Controller 2",
    0xFEFB: "PTO - Power Takeoff Information",
    0xFEEF: "EFL/P1 - Engine Fluid Level/Pressure 1",
    0xFEC1: "EFL/P2 - Engine Fluid Level/Pressure 2",
    0xFEC0: "BRAKE - Brake System Data",
    0xFEEB: "CI - Component Identification",
    0xFEEC: "VI - Vehicle Identification",
    0xFED8: "SOFT - Software Identification",
    0xFED9: "VDHR - High-Resolution Vehicle Distance",
    0xFEB3: "TCFG - Transmission Configuration",
    0xFEB2: "ECFG - Engine Configuration",
    0xFEBB: "SAS - Suspension Control",
    0xFEBE: "TIRE - Tire Condition",
    0xFEB5: "WFI - Water in Fuel Indicator",
    0xFEBD: "FD - Fan Drive",
    0xFED5: "AT1T1I - Aftertreatment 1 DEF Tank 1",
    0xFED6: "AT1OG1 - Aftertreatment 1 Outlet Gas 1",
    0xFF00: "Proprietary B",
    0xEF00: "Proprietary A",
}

# ── SA address names (built-in, enriched from J1939SATabledb) ─────────────────

_SA_NAMES: dict[int, str] = {
    0x00: "Engine #1",
    0x01: "Engine #2",
    0x02: "Turbocharger",
    0x03: "Transmission #1",
    0x04: "Transmission #2",
    0x05: "Axle #1 Steering",
    0x06: "Axle #2 Steering",
    0x0B: "Brakes - System Controller",
    0x0F: "Instrument Cluster #1",
    0x10: "Trip Recorder",
    0x11: "Vehicle Management System",
    0x13: "Body Controller",
    0x17: "Cab Display #1",
    0x1C: "Steering Wheel Interface Unit",
    0x21: "Cab Controller - Primary",
    0x22: "Cab Controller - Secondary",
    0x27: "Engine Retarder",
    0x28: "Transmission Display",
    0x33: "Suspension - System Controller",
    0x3D: "Power Takeoff",
    0x40: "Passenger Climate Control #1",
    0x4D: "On-Board Diagnostic Unit",
    0x80: "Diagnostic Tool",
    0xF0: "Handheld Diagnostics",
    0xFE: "Null Address",
    0xFF: "Global / Broadcast",
}

# ── SPN definitions (from J1939SPNdb, used for DM1 enrichment) ───────────────

_SPN_DB: dict[int, dict] = {}

_HAS_PRETTY_J1939 = False

# ── pretty_j1939 loader ───────────────────────────────────────────────────────

def _find_db_path() -> Optional[pathlib.Path]:
    """Find J1939db.json - user config dir first, then package bundled."""
    if os.name == "nt":
        base = os.environ.get("APPDATA", "")
        user_path = pathlib.Path(base) / "pretty_j1939" / "J1939db.json"
    else:
        user_path = pathlib.Path.home() / ".config" / "pretty_j1939" / "J1939db.json"

    if user_path.exists():
        log.info("pretty_j1939: using database from user config: %s", user_path)
        return user_path

    try:
        import pretty_j1939  # type: ignore
        bundled = pathlib.Path(pretty_j1939.__file__).parent / "J1939db.json"
        if bundled.exists():
            return bundled
    except ImportError:
        pass

    return None


def _load_pretty_j1939() -> bool:
    """
    Load PGN names, SA names, and SPN definitions from J1939db.json.

    Correct top-level keys (confirmed from debug endpoint):
        J1939PGNdb      - {"61444": {"Label": "EEC1", ...}, ...}
        J1939SATabledb  - {"0": "Engine #1", "1": "Engine #2", ...}
        J1939SPNdb      - {"190": {"Name": "Engine Speed", "Units": "rpm", ...}, ...}
    """
    global _HAS_PRETTY_J1939

    try:
        db_path = _find_db_path()
        if db_path is None:
            log.debug("pretty_j1939: J1939db.json not found - using built-in tables")
            return False

        with db_path.open("r", encoding="utf-8") as fh:
            data: dict = json.load(fh)

        # 1. PGN names  (key: J1939PGNdb)
        pgn_added = 0
        for pgn_str, pgn_data in data.get("J1939PGNdb", {}).items():
            try:
                pgn   = int(pgn_str, 0)
                label = (pgn_data.get("Label") or pgn_data.get("Name") or "").strip()
                if label and pgn not in _PGN_NAMES:
                    _PGN_NAMES[pgn] = label
                    pgn_added += 1
            except (ValueError, TypeError, AttributeError):
                continue

        # 2. SA address names  (key: J1939SATabledb, value: plain string)
        sa_added = 0
        for sa_str, sa_name in data.get("J1939SATabledb", {}).items():
            try:
                sa = int(sa_str, 0)
                if isinstance(sa_name, str) and sa_name.strip() and sa not in _SA_NAMES:
                    _SA_NAMES[sa] = sa_name.strip()
                    sa_added += 1
            except (ValueError, TypeError):
                continue

        # 3. SPN definitions  (key: J1939SPNdb - for DM1 name enrichment)
        spn_loaded = 0
        for spn_str, spn_data in data.get("J1939SPNdb", {}).items():
            try:
                spn = int(spn_str, 0)
                _SPN_DB[spn] = {
                    "name":       spn_data.get("Name", ""),
                    "units":      spn_data.get("Units", ""),
                    "resolution": float(spn_data.get("Resolution", 1.0)),
                    "offset":     float(spn_data.get("Offset", 0)),
                    "length":     int(spn_data.get("SPNLength", 0)),
                }
                spn_loaded += 1
            except (ValueError, TypeError):
                continue

        pgn_count = len(data.get("J1939PGNdb", {}))
        is_full   = pgn_count > 20    # bundled has 13; full SAE DA has 1000+

        log.debug(
            "pretty_j1939 [%s]: +%d PGNs (%d total), +%d SA names (%d total), "
            "%d SPN defs - from %s",
            "full SAE DA" if is_full else f"bundled, {pgn_count} PGNs",
            pgn_added, len(_PGN_NAMES),
            sa_added,  len(_SA_NAMES),
            spn_loaded, db_path.name,
        )

        if not is_full:
            log.debug(
                "pretty_j1939: bundled DB has only %d PGNs (freely licensed data). "
                "For full coverage buy the SAE J1939 Digital Annex, run "
                "create_j1939db-json, and place the result at "
                "%%APPDATA%%\\pretty_j1939\\J1939db.json",
                pgn_count,
            )

        _HAS_PRETTY_J1939 = True
        return True

    except ImportError:
        log.debug("pretty_j1939 not installed")
        return False
    except Exception as exc:
        log.warning("pretty_j1939 load failed: %s", exc)
        return False


# Must be called after all three dicts are defined
_load_pretty_j1939()

# ── DM1 lamp states ───────────────────────────────────────────────────────────

_LAMP_STATE: dict[int, str] = {0: "Not Active", 1: "Active", 2: "Error", 3: "Not Available"}

# ── BAM session ───────────────────────────────────────────────────────────────

_BAM_TIMEOUT_S    = 0.75
_MAX_BAM_SESSIONS = 8
_DETECT_THRESHOLD = 25


@dataclass
class _BamSession:
    pgn: int
    total_size: int
    num_packets: int
    packets: dict[int, bytes] = field(default_factory=dict)
    updated_at: float = field(default_factory=time.monotonic)

    @property
    def complete(self) -> bool:
        return len(self.packets) >= self.num_packets

    def assemble(self) -> bytes:
        raw = b"".join(self.packets[i] for i in range(1, self.num_packets + 1))
        return raw[: self.total_size]


@dataclass
class SARecord:
    sa: int
    sa_name: str
    frame_count: int = 0
    first_seen: float = field(default_factory=time.monotonic)
    last_seen: float  = field(default_factory=time.monotonic)


# ── Main store ────────────────────────────────────────────────────────────────

class J1939Store:
    def __init__(self) -> None:
        self._lock           = threading.Lock()
        self._mode: str      = "off"
        self._auto_detected  = False
        self._extended_count = 0
        self._bam: dict[int, _BamSession] = {}
        self._sa_table: dict[int, SARecord] = {}
        self._recent_bam: list[dict] = []
        self._recent_dm1: list[dict] = []

    @property
    def mode(self) -> str:
        return self._mode

    @property
    def auto_detected(self) -> bool:
        return self._auto_detected

    def set_mode(self, mode: str) -> None:
        if mode not in ("on", "off"):
            raise ValueError(f"Invalid mode: {mode!r}")
        with self._lock:
            self._mode = mode
            if mode == "off":
                self._bam.clear()

    def reset(self) -> None:
        with self._lock:
            self._auto_detected  = False
            self._extended_count = 0
            self._bam.clear()
            self._sa_table.clear()
            self._recent_bam.clear()
            self._recent_dm1.clear()

    def process_frame(self, arb_id: int, data: bytes, is_extended: bool) -> Optional[dict]:
        if is_extended:
            with self._lock:
                self._extended_count += 1
                if not self._auto_detected and self._extended_count >= _DETECT_THRESHOLD:
                    self._auto_detected = True
                    log.info("J1939 auto-detected after %d extended frames", self._extended_count)

        if self._mode != "on" or not is_extended:
            return None

        return self._decode(arb_id, data)

    def _decode(self, arb_id: int, data: bytes) -> dict:
        priority = (arb_id >> 26) & 0x07
        dp       = (arb_id >> 24) & 0x01
        pf       = (arb_id >> 16) & 0xFF
        ps       = (arb_id >>  8) & 0xFF
        sa       =  arb_id        & 0xFF

        if pf < 0xF0:
            da = ps
            pgn = (dp << 16) | (pf << 8)
            is_broadcast = (da == 0xFF)
        else:
            da = 0xFF
            pgn = (dp << 16) | (pf << 8) | ps
            is_broadcast = True

        sa_name  = _SA_NAMES.get(sa,  f"SA 0x{sa:02X}")
        da_name  = "Broadcast" if is_broadcast else _SA_NAMES.get(da, f"DA 0x{da:02X}")
        pgn_name = _PGN_NAMES.get(pgn, f"PGN 0x{pgn:04X}")

        now = time.monotonic()
        with self._lock:
            rec = self._sa_table.get(sa)
            if rec is None:
                self._sa_table[sa] = SARecord(sa=sa, sa_name=sa_name,
                                               frame_count=1,
                                               first_seen=now, last_seen=now)
            else:
                rec.frame_count += 1
                rec.last_seen    = now

            self._expire_bam(now)

            is_bam_cm    = False
            is_bam_dt    = False
            bam_complete: Optional[dict] = None
            dm1_faults:   Optional[list] = None

            if pgn == 0xEC00 and len(data) >= 8 and data[0] == 0x20:
                is_bam_cm   = True
                total_size  = data[1] | (data[2] << 8)
                num_packets = data[3]
                target_pgn  = data[5] | (data[6] << 8) | (data[7] << 16)
                if len(self._bam) < _MAX_BAM_SESSIONS:
                    self._bam[sa] = _BamSession(pgn=target_pgn, total_size=total_size,
                                                 num_packets=num_packets)

            elif pgn == 0xEB00 and len(data) >= 8:
                is_bam_dt = True
                seq_num   = data[0]
                chunk     = bytes(data[1:8])
                session   = self._bam.get(sa)
                if session is not None and 1 <= seq_num <= session.num_packets:
                    session.packets[seq_num] = chunk
                    session.updated_at = now
                    if session.complete:
                        payload = session.assemble()
                        bam_complete = {
                            "pgn":      session.pgn,
                            "pgn_hex":  f"0x{session.pgn:04X}",
                            "pgn_name": _PGN_NAMES.get(session.pgn, f"PGN 0x{session.pgn:04X}"),
                            "data_hex": payload.hex(" ").upper(),
                            "length":   len(payload),
                        }
                        if session.pgn == 0xFECA:
                            bam_complete["dm1_faults"] = _decode_dm1(payload)
                        # Deduplicate by PGN - same message replaces previous
                        self._recent_bam = (
                            [bam_complete]
                            + [b for b in self._recent_bam if b["pgn"] != session.pgn]
                        )[:20]
                        del self._bam[sa]

            if pgn == 0xFECA and len(data) >= 6 and not is_bam_dt:
                faults = _decode_dm1(bytes(data))
                if faults:
                    dm1_faults = faults
                    existing = {(f["spn"], f["fmi"]): f for f in self._recent_dm1}
                    for f in faults:
                        existing[(f["spn"], f["fmi"])] = f
                    self._recent_dm1 = list(existing.values())[:20]

        return {
            "priority":    priority,
            "pgn":         pgn,
            "pgn_hex":     f"0x{pgn:04X}",
            "pgn_name":    pgn_name,
            "sa":          sa,
            "sa_hex":      f"0x{sa:02X}",
            "sa_name":     sa_name,
            "da":          da,
            "da_hex":      f"0x{da:02X}",
            "da_name":     da_name,
            "is_broadcast": is_broadcast,
            "is_bam_cm":   is_bam_cm,
            "is_bam_dt":   is_bam_dt,
            "bam_complete": bam_complete,
            "dm1_faults":  dm1_faults,
        }

    def _expire_bam(self, now: float) -> None:
        stale = [sa for sa, s in self._bam.items() if now - s.updated_at > _BAM_TIMEOUT_S]
        for sa in stale:
            log.debug("BAM SA=0x%02X timed out", sa)
            del self._bam[sa]

    def status_dict(self) -> dict:
        return {"j1939_mode": self._mode, "j1939_detected": self._auto_detected}

    def full_status(self) -> dict:
        with self._lock:
            sa_list = sorted(self._sa_table.values(), key=lambda r: r.sa)
            return {
                "mode":             self._mode,
                "auto_detected":    self._auto_detected,
                "has_pretty_j1939": _HAS_PRETTY_J1939,
                "pgn_db_size":      len(_PGN_NAMES),
                "sa_db_size":       len(_SA_NAMES),
                "spn_db_size":      len(_SPN_DB),
                "sa_table": [
                    {
                        "sa":          r.sa,
                        "sa_hex":      f"0x{r.sa:02X}",
                        "sa_name":     r.sa_name,
                        "frame_count": r.frame_count,
                        "last_seen_s": round(time.monotonic() - r.last_seen, 1),
                    }
                    for r in sa_list
                ],
                "recent_bam":          list(self._recent_bam),
                "recent_dm1":          list(self._recent_dm1),
                "active_bam_sessions": len(self._bam),
            }


# ── DM1 decoder ───────────────────────────────────────────────────────────────

def _decode_dm1(data: bytes) -> list[dict]:
    """
    Parse DM1 payload into active fault records.
    Enriches each fault with the SPN name and units from _SPN_DB.
    """
    if len(data) < 6:
        return []

    lamp_byte = data[0]
    lamps = {
        "MIL":     _LAMP_STATE.get((lamp_byte >> 6) & 0x03, "?"),
        "RSL":     _LAMP_STATE.get((lamp_byte >> 4) & 0x03, "?"),
        "AWL":     _LAMP_STATE.get((lamp_byte >> 2) & 0x03, "?"),
        "Protect": _LAMP_STATE.get( lamp_byte        & 0x03, "?"),
    }

    faults = []
    i = 2
    while i + 4 <= len(data):
        b0, b1, b2, b3 = data[i], data[i+1], data[i+2], data[i+3]
        if (b0 == 0xFF and b1 == 0xFF) or (b0 == 0x00 and b1 == 0x00 and b2 == 0x00):
            i += 4
            continue
        spn = b0 | (b1 << 8) | ((b2 & 0x07) << 16)
        fmi = (b2 >> 3) & 0x1F
        oc  = (b3 >> 1) & 0x7F
        cm  =  b3        & 0x01
        spn_info = _SPN_DB.get(spn, {})
        faults.append({
            "spn":      spn,
            "spn_name": spn_info.get("name", ""),   # "Engine Oil Pressure"
            "units":    spn_info.get("units", ""),  # "kPa"
            "fmi":      fmi,
            "oc":       oc,
            "cm":       cm,
            "lamps":    lamps,
        })
        i += 4

    return faults


j1939_store = J1939Store()
