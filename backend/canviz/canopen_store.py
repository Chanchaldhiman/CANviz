"""
canviz/canopen_store.py
-----------------------
CANopen passive decoder (CiA 301 + CiA 402) -- v1.

Architecture mirrors j1939_store.py exactly:
  - process_frame() called from ws_broadcaster.on_frame() (sync, bus thread)
  - Internal state protected by threading.Lock()
  - status_dict() returns a lightweight snapshot for the 1s WebSocket stats push
  - full_status() returns complete node table / SDO log for panel polling
  - No canopen library write calls in v1 -- SDO reads only via REST

COB-ID structure (CiA 301, fixed by spec):
  0x000             NMT control
  0x001-0x07F       SYNC (0x080 is SYNC default, 0x001-0x07F are user-configurable)
  0x080             SYNC (default)
  0x081-0x0FF       EMCY  (node ID = COB-ID - 0x080)
  0x100             TIME
  0x101-0x17F       (reserved)
  0x181-0x1FF       TPDO1 (node ID = COB-ID - 0x180)
  0x201-0x27F       RPDO1 (node ID = COB-ID - 0x200)
  0x281-0x2FF       TPDO2 (node ID = COB-ID - 0x280)
  0x301-0x37F       RPDO2 (node ID = COB-ID - 0x300)
  0x381-0x3FF       TPDO3 (node ID = COB-ID - 0x380)
  0x401-0x47F       RPDO3 (node ID = COB-ID - 0x400)
  0x481-0x4FF       TPDO4 (node ID = COB-ID - 0x480)
  0x501-0x57F       RPDO4 (node ID = COB-ID - 0x500)
  0x581-0x5FF       SDO response (node ID = COB-ID - 0x580)
  0x601-0x67F       SDO request  (node ID = COB-ID - 0x600)
  0x701-0x77F       Heartbeat / Node Guarding (node ID = COB-ID - 0x700)
  0x000             Broadcast NMT

EDS decode (optional):
  Uses the 'canopen' Python library when an EDS file is loaded.
  Falls back to raw hex display with frame-type labels when no EDS.
"""

from __future__ import annotations

import logging
import time
import threading
from dataclasses import dataclass, field
from typing import Optional

log = logging.getLogger("canviz.canopen")

# ── Detection threshold ───────────────────────────────────────────────────────

_DETECT_THRESHOLD = 15   # number of CANopen-looking frames before auto_detected = True

# ── Built-in CiA 301 + CiA 402 object dictionary ─────────────────────────────
# These are defined in the open CiA standards and are identical across all
# compliant devices. No EDS file needed for any of these.
# Key: (index, subindex). Value: {"name", "unit"}.

_BUILTIN_OBJECTS: dict[tuple[int, int], dict] = {
    # ── CiA 301 -- Communication Profile ─────────────────────────────────────
    (0x1000, 0): {"name": "Device Type",                        "unit": ""},
    (0x1001, 0): {"name": "Error Register",                     "unit": ""},
    (0x1002, 0): {"name": "Manufacturer Status Register",       "unit": ""},
    (0x1003, 0): {"name": "Pre-defined Error Field: Count",     "unit": ""},
    (0x1005, 0): {"name": "COB-ID SYNC",                        "unit": ""},
    (0x1006, 0): {"name": "Communication Cycle Period",         "unit": "us"},
    (0x1007, 0): {"name": "Synchronous Window Length",          "unit": "us"},
    (0x1008, 0): {"name": "Manufacturer Device Name",           "unit": ""},
    (0x1009, 0): {"name": "Manufacturer Hardware Version",      "unit": ""},
    (0x100A, 0): {"name": "Manufacturer Software Version",      "unit": ""},
    (0x100C, 0): {"name": "Guard Time",                         "unit": "ms"},
    (0x100D, 0): {"name": "Life Time Factor",                   "unit": ""},
    (0x1010, 0): {"name": "Store Parameters: Highest Sub",      "unit": ""},
    (0x1010, 1): {"name": "Store Parameters: All",              "unit": ""},
    (0x1010, 2): {"name": "Store Parameters: Communication",    "unit": ""},
    (0x1010, 3): {"name": "Store Parameters: Application",      "unit": ""},
    (0x1011, 0): {"name": "Restore Default: Highest Sub",       "unit": ""},
    (0x1011, 1): {"name": "Restore Default: All",               "unit": ""},
    (0x1011, 2): {"name": "Restore Default: Communication",     "unit": ""},
    (0x1011, 3): {"name": "Restore Default: Application",       "unit": ""},
    (0x1014, 0): {"name": "COB-ID EMCY",                        "unit": ""},
    (0x1015, 0): {"name": "Inhibit Time EMCY",                  "unit": "100us"},
    (0x1016, 0): {"name": "Consumer Heartbeat: Count",          "unit": ""},
    (0x1017, 0): {"name": "Producer Heartbeat Time",            "unit": "ms"},
    (0x1018, 0): {"name": "Identity: Highest Sub-Index",        "unit": ""},
    (0x1018, 1): {"name": "Identity: Vendor ID",                "unit": ""},
    (0x1018, 2): {"name": "Identity: Product Code",             "unit": ""},
    (0x1018, 3): {"name": "Identity: Revision Number",          "unit": ""},
    (0x1018, 4): {"name": "Identity: Serial Number",            "unit": ""},
    (0x1019, 0): {"name": "Sync Counter Overflow Value",        "unit": ""},
    (0x1029, 0): {"name": "Error Behavior: Highest Sub",        "unit": ""},
    (0x1029, 1): {"name": "Error Behavior: Communication",      "unit": ""},
    # ── CiA 402 -- Drive Profile (all compliant drives) ───────────────────────
    (0x603F, 0): {"name": "Error Code",                         "unit": ""},
    (0x6040, 0): {"name": "Controlword",                        "unit": ""},
    (0x6041, 0): {"name": "Statusword",                         "unit": ""},
    (0x6042, 0): {"name": "vl Target Velocity",                 "unit": "rpm"},
    (0x6043, 0): {"name": "vl Velocity Demand",                 "unit": "rpm"},
    (0x6044, 0): {"name": "vl Control Effort",                  "unit": "rpm"},
    (0x6046, 0): {"name": "vl Velocity Min Amount",             "unit": "rpm"},
    (0x6046, 1): {"name": "vl Velocity Max Amount",             "unit": "rpm"},
    (0x6048, 0): {"name": "vl Velocity Acceleration",           "unit": "rpm/s"},
    (0x6049, 0): {"name": "vl Velocity Deceleration",           "unit": "rpm/s"},
    (0x604A, 0): {"name": "vl Velocity Quick Stop",             "unit": "rpm/s"},
    (0x6060, 0): {"name": "Modes of Operation",                 "unit": ""},
    (0x6061, 0): {"name": "Modes of Operation Display",         "unit": ""},
    (0x6062, 0): {"name": "Position Demand Value",              "unit": "counts"},
    (0x6063, 0): {"name": "Position Actual Internal Value",     "unit": "counts"},
    (0x6064, 0): {"name": "Position Actual Value",              "unit": "counts"},
    (0x6065, 0): {"name": "Following Error Window",             "unit": "counts"},
    (0x6066, 0): {"name": "Following Error Time Out",           "unit": "ms"},
    (0x6067, 0): {"name": "Position Window",                    "unit": "counts"},
    (0x6068, 0): {"name": "Position Window Time",               "unit": "ms"},
    (0x6069, 0): {"name": "Velocity Sensor Actual Value",       "unit": "counts/s"},
    (0x606A, 0): {"name": "Sensor Selection Code",              "unit": ""},
    (0x606B, 0): {"name": "Velocity Demand Value",              "unit": "counts/s"},
    (0x606C, 0): {"name": "Velocity Actual Value",              "unit": "counts/s"},
    (0x606D, 0): {"name": "Velocity Window",                    "unit": "counts/s"},
    (0x606E, 0): {"name": "Velocity Window Time",               "unit": "ms"},
    (0x606F, 0): {"name": "Velocity Threshold",                 "unit": "counts/s"},
    (0x6070, 0): {"name": "Velocity Threshold Time",            "unit": "ms"},
    (0x6071, 0): {"name": "Target Torque",                      "unit": "0.1%"},
    (0x6072, 0): {"name": "Max Torque",                         "unit": "0.1%"},
    (0x6073, 0): {"name": "Max Current",                        "unit": "0.1%"},
    (0x6074, 0): {"name": "Torque Demand Value",                "unit": "0.1%"},
    (0x6075, 0): {"name": "Motor Rated Current",                "unit": "mA"},
    (0x6076, 0): {"name": "Motor Rated Torque",                 "unit": "mNm"},
    (0x6077, 0): {"name": "Torque Actual Value",                "unit": "0.1%"},
    (0x6078, 0): {"name": "Current Actual Value",               "unit": "0.1%"},
    (0x6079, 0): {"name": "DC Link Circuit Voltage",            "unit": "mV"},
    (0x607A, 0): {"name": "Target Position",                    "unit": "counts"},
    (0x607B, 0): {"name": "Position Range Limit: Min",          "unit": "counts"},
    (0x607B, 1): {"name": "Position Range Limit: Max",          "unit": "counts"},
    (0x607C, 0): {"name": "Home Offset",                        "unit": "counts"},
    (0x607D, 0): {"name": "Software Position Limit: Min",       "unit": "counts"},
    (0x607D, 1): {"name": "Software Position Limit: Max",       "unit": "counts"},
    (0x607E, 0): {"name": "Polarity",                           "unit": ""},
    (0x607F, 0): {"name": "Max Profile Velocity",               "unit": "counts/s"},
    (0x6080, 0): {"name": "Max Motor Speed",                    "unit": "rpm"},
    (0x6081, 0): {"name": "Profile Velocity",                   "unit": "counts/s"},
    (0x6082, 0): {"name": "End Velocity",                       "unit": "counts/s"},
    (0x6083, 0): {"name": "Profile Acceleration",               "unit": "counts/s2"},
    (0x6084, 0): {"name": "Profile Deceleration",               "unit": "counts/s2"},
    (0x6085, 0): {"name": "Quick Stop Deceleration",            "unit": "counts/s2"},
    (0x6086, 0): {"name": "Motion Profile Type",                "unit": ""},
    (0x6087, 0): {"name": "Torque Slope",                       "unit": "0.1%/s"},
    (0x6088, 0): {"name": "Torque Profile Type",                "unit": ""},
    (0x6091, 0): {"name": "Gear Ratio: Motor Revolutions",      "unit": ""},
    (0x6091, 1): {"name": "Gear Ratio: Shaft Revolutions",      "unit": ""},
    (0x6092, 0): {"name": "Feed Constant: Feed",                "unit": "counts"},
    (0x6092, 1): {"name": "Feed Constant: Shaft Revolutions",   "unit": ""},
    (0x6098, 0): {"name": "Homing Method",                      "unit": ""},
    (0x6099, 0): {"name": "Homing Speed: Switch",               "unit": "counts/s"},
    (0x6099, 1): {"name": "Homing Speed: Zero",                 "unit": "counts/s"},
    (0x609A, 0): {"name": "Homing Acceleration",                "unit": "counts/s2"},
    (0x60A0, 0): {"name": "Four Quadrant Mode",                 "unit": ""},
    (0x60B0, 0): {"name": "Position Offset",                    "unit": "counts"},
    (0x60B1, 0): {"name": "Velocity Offset",                    "unit": "counts/s"},
    (0x60B2, 0): {"name": "Torque Offset",                      "unit": "0.1%"},
    (0x60B8, 0): {"name": "Touch Probe Function",               "unit": ""},
    (0x60B9, 0): {"name": "Touch Probe Status",                 "unit": ""},
    (0x60BA, 0): {"name": "Touch Probe 1 Positive Edge Position","unit": "counts"},
    (0x60BB, 0): {"name": "Touch Probe 1 Negative Edge Position","unit": "counts"},
    (0x60C2, 0): {"name": "Interpolation Time Period: Value",   "unit": ""},
    (0x60C2, 1): {"name": "Interpolation Time Period: Index",   "unit": ""},
    (0x60C5, 0): {"name": "Max Acceleration",                   "unit": "counts/s2"},
    (0x60C6, 0): {"name": "Max Deceleration",                   "unit": "counts/s2"},
    (0x60E0, 0): {"name": "Positive Torque Limit",              "unit": "0.1%"},
    (0x60E1, 0): {"name": "Negative Torque Limit",              "unit": "0.1%"},
    (0x60F4, 0): {"name": "Following Error Actual Value",       "unit": "counts"},
    (0x60FA, 0): {"name": "Control Effort",                     "unit": "counts/s2"},
    (0x60FC, 0): {"name": "Position Demand Internal Value",     "unit": "counts"},
    (0x60FD, 0): {"name": "Digital Inputs",                     "unit": ""},
    (0x60FE, 0): {"name": "Digital Outputs: Physical Outputs",   "unit": ""},
    (0x60FF, 0): {"name": "Target Velocity",                    "unit": "counts/s"},
    (0x6502, 0): {"name": "Supported Drive Modes",              "unit": ""},
    # ── CiA 402 -- Factor Group ────────────────────────────────────────────────
    # These convert between user units and internal device units
    (0x6089, 0): {"name": "Position Notation Index",             "unit": ""},
    (0x608A, 0): {"name": "Position Dimension Index",            "unit": ""},
    (0x608B, 0): {"name": "Velocity Notation Index",             "unit": ""},
    (0x608C, 0): {"name": "Velocity Dimension Index",            "unit": ""},
    (0x608D, 0): {"name": "Acceleration Notation Index",         "unit": ""},
    (0x608E, 0): {"name": "Acceleration Dimension Index",        "unit": ""},
    (0x608F, 0): {"name": "Position Encoder Resolution: Steps",  "unit": ""},
    (0x608F, 1): {"name": "Position Encoder Resolution: Revs",   "unit": ""},
    (0x6090, 0): {"name": "Velocity Encoder Resolution: Counts", "unit": ""},
    (0x6090, 1): {"name": "Velocity Encoder Resolution: Time",   "unit": ""},
    (0x6093, 0): {"name": "Position Factor: Numerator",          "unit": ""},
    (0x6093, 1): {"name": "Position Factor: Denominator",        "unit": ""},
    (0x6094, 0): {"name": "Velocity Encoder Factor: Numerator",  "unit": ""},
    (0x6094, 1): {"name": "Velocity Encoder Factor: Denominator","unit": ""},
    (0x6096, 0): {"name": "Velocity Factor: Numerator",          "unit": ""},
    (0x6096, 1): {"name": "Velocity Factor: Denominator",        "unit": ""},
    (0x6097, 0): {"name": "Acceleration Factor: Numerator",      "unit": ""},
    (0x6097, 1): {"name": "Acceleration Factor: Denominator",    "unit": ""},
    # ── CiA 402 -- Touch Probe ─────────────────────────────────────────────────
    (0x60BC, 0): {"name": "Touch Probe 2 Positive Edge Position","unit": "counts"},
    (0x60BD, 0): {"name": "Touch Probe 2 Negative Edge Position","unit": "counts"},
    # ── CiA 402 -- Interpolated Position Mode (CSP) ───────────────────────────
    (0x60C0, 0): {"name": "Interpolation Sub Mode Select",       "unit": ""},
    (0x60C1, 0): {"name": "Interpolation Data Record sub0",      "unit": ""},
    (0x60C4, 0): {"name": "Interpolation Data Config: MaxBuf",   "unit": ""},
    (0x60C4, 1): {"name": "Interpolation Data Config: ActBuf",   "unit": ""},
    (0x60C4, 2): {"name": "Interpolation Data Config: BufOrg",   "unit": ""},
    (0x60C4, 3): {"name": "Interpolation Data Config: BufPos",   "unit": ""},
    (0x60C4, 4): {"name": "Interpolation Data Config: BufSize",  "unit": ""},
    (0x60C4, 5): {"name": "Interpolation Data Config: BufClear", "unit": ""},
    # ── CiA 402 -- Homing extended ────────────────────────────────────────────
    # ── CiA 402 -- Digital I/O ────────────────────────────────────────────────
    (0x60FE, 1): {"name": "Digital Outputs: Bit Mask",           "unit": ""},
    # ── CiA 402 -- Torque control extended ───────────────────────────────────
    (0x6410, 0): {"name": "Motor Data: Pole Pair Number",         "unit": ""},
    (0x6410, 1): {"name": "Motor Data: Max Current",             "unit": "mA"},
    (0x6410, 2): {"name": "Motor Data: Torque Constant",         "unit": "mNm/A"},
    (0x6410, 3): {"name": "Motor Data: Motor Winding Conn",      "unit": ""},
    (0x6410, 5): {"name": "Motor Data: Thermal Time Constant",   "unit": "ds"},
    (0x6410, 6): {"name": "Motor Data: Continuous Current Limit","unit": "mA"},
    # ── CiA 402 -- Position control extra ────────────────────────────────────
    (0x60F2, 0): {"name": "Positioning Option Code",             "unit": ""},
    (0x60F8, 0): {"name": "Max Slippage",                        "unit": "counts/s"},
    (0x60FB, 0): {"name": "Position Control Param: P Gain",      "unit": ""},
    (0x60FB, 1): {"name": "Position Control Param: I Gain",      "unit": ""},
    (0x60FB, 2): {"name": "Position Control Param: D Gain",      "unit": ""},
    (0x60FB, 3): {"name": "Position Control Param: Feedforward", "unit": ""},
    # ── CiA 402 -- Following error ────────────────────────────────────────────
    # ── ODrive-specific (common in robotics, index 0x3xxx range) ─────────────
    # ODrive uses standard CiA 402 objects + vendor objects at 0x3xxx
    # We only list the standard ones above; vendor objects need EDS
}


def _builtin_lookup(index: int, subindex: int) -> Optional[dict]:
    """
    Look up an object in the built-in CiA 301/402 dictionary.
    Also handles parameterized index ranges (PDO params, SDO params etc).
    Returns {"name", "unit"} or None.
    """
    result = _BUILTIN_OBJECTS.get((index, subindex))
    if result:
        return result
    # Parameterized ranges -- generate names from the index offset
    if 0x1200 <= index <= 0x127F:
        n = index - 0x1200
        return {"name": f"SDO Server Param [{n}] sub{subindex}", "unit": ""}
    if 0x1280 <= index <= 0x12FF:
        n = index - 0x1280
        return {"name": f"SDO Client Param [{n}] sub{subindex}", "unit": ""}
    if 0x1400 <= index <= 0x15FF:
        n = index - 0x13FF
        return {"name": f"RPDO{n} Comm Param sub{subindex}", "unit": ""}
    if 0x1600 <= index <= 0x17FF:
        n = index - 0x15FF
        return {"name": f"RPDO{n} Mapping sub{subindex}", "unit": ""}
    if 0x1800 <= index <= 0x19FF:
        n = index - 0x17FF
        return {"name": f"TPDO{n} Comm Param sub{subindex}", "unit": ""}
    if 0x1A00 <= index <= 0x1BFF:
        n = index - 0x19FF
        return {"name": f"TPDO{n} Mapping sub{subindex}", "unit": ""}
    if 0x1016 <= index <= 0x1016:
        return {"name": f"Consumer Heartbeat [{subindex}]", "unit": "ms"}
    return None

# ── SDO pairing window ────────────────────────────────────────────────────────

_SDO_PAIR_TIMEOUT_S = 0.5   # max seconds between SDO req and response to pair them

# ── NMT state machine ─────────────────────────────────────────────────────────

_NMT_HEARTBEAT_STATES: dict[int, str] = {
    0x00: "Initialising",
    0x04: "Stopped",
    0x05: "Operational",
    0x7F: "Pre-Operational",
}

# ── CiA 402 statusword decode ─────────────────────────────────────────────────
# Object 0x6041 statusword bit interpretation (CiA 402 state machine)

def _decode_cia402_statusword(sw: int) -> str:
    """
    Map CiA 402 statusword to drive state machine state name.
    Priority order matches the spec state machine evaluation order.
    """
    # Fault condition -- check first
    if sw & 0x0008:   # bit 3 = Fault
        if sw & 0x0020:   # bit 5 = Quick Stop active
            return "Quick Stop Active"
        return "Fault"

    rtso    = sw & 0x0001   # bit 0: Ready to Switch On
    so      = sw & 0x0002   # bit 1: Switched On
    oe      = sw & 0x0004   # bit 2: Operation Enabled
    # bit 3: Fault      -- tested via sw & 0x0008 in state checks below
    # bit 4: Voltage Enabled -- informational, not used in state decode
    # bit 5: Quick Stop -- tested via sw & 0x0020 in state checks below
    sod     = sw & 0x0040   # bit 6: Switch On Disabled

    if sod:
        return "Switch On Disabled"
    if not rtso:
        return "Not Ready to Switch On"
    if rtso and not so:
        return "Ready to Switch On"
    if rtso and so and not oe:
        return "Switched On"
    if rtso and so and oe:
        return "Operation Enabled"
    return f"Unknown (0x{sw:04X})"


_CIA402_MODES: dict[int, str] = {
    0:  "No Mode",
    1:  "Profile Position",
    2:  "Velocity",
    3:  "Profile Velocity",
    4:  "Profile Torque",
    5:  "Reserved",
    6:  "Homing",
    7:  "Interpolated Position",
    8:  "Cyclic Sync Position",
    9:  "Cyclic Sync Velocity",
    10: "Cyclic Sync Torque",
}

# ── EMCY error codes (CiA 301 Table 14) ──────────────────────────────────────

_EMCY_CLASSES: dict[int, str] = {
    0x0000: "Error Reset / No Error",
    0x1000: "Generic Error",
    0x2000: "Current",
    0x2100: "Current -- Device Input Side",
    0x2200: "Current Inside the Device",
    0x2300: "Current -- Device Output Side",
    0x3000: "Voltage",
    0x3100: "Mains Voltage",
    0x3200: "Voltage Inside the Device",
    0x3300: "Output Voltage",
    0x4000: "Temperature",
    0x4100: "Ambient Temperature",
    0x4200: "Device Temperature",
    0x5000: "Device Hardware",
    0x6000: "Device Software",
    0x6100: "Internal Software",
    0x6200: "User Software",
    0x6300: "Data Set",
    0x7000: "Additional Modules",
    0x8000: "Monitoring",
    0x8100: "Communication",
    0x8110: "CAN Overrun",
    0x8120: "CAN in Error Passive Mode",
    0x8130: "Life Guard Error / Heartbeat Error",
    0x8140: "Recovered from Bus Off",
    0x8200: "Protocol Error",
    0x8210: "PDO Not Processed Due to Length Error",
    0x8220: "PDO Length Exceeded",
    0x9000: "External Error",
    0xA000: "Additional Functions",
    0xF000: "Device Specific",
}

def _emcy_class_name(error_code: int) -> str:
    # Try exact match first, then 0xNN00 class match
    if error_code in _EMCY_CLASSES:
        return _EMCY_CLASSES[error_code]
    class_code = error_code & 0xFF00
    return _EMCY_CLASSES.get(class_code, f"Unknown (0x{error_code:04X})")

_EMCY_REGISTER_BITS: list[tuple[int, str]] = [
    (0x01, "Generic"),
    (0x02, "Current"),
    (0x04, "Voltage"),
    (0x08, "Temperature"),
    (0x10, "Communication"),
    (0x20, "Device Profile"),
    (0x40, "Reserved"),
    (0x80, "Manufacturer"),
]

def _emcy_register_flags(reg: int) -> list[str]:
    return [name for bit, name in _EMCY_REGISTER_BITS if reg & bit]


# ── SDO command specifiers ────────────────────────────────────────────────────
# CiA 301 section 7.2.4

def _sdo_description(cmd: int, is_request: bool) -> str:
    """Parse SDO command specifier byte into a human-readable description."""
    if is_request:
        ccs = (cmd >> 5) & 0x07   # client command specifier
        if ccs == 1:
            e = (cmd >> 1) & 1
            s = cmd & 1
            n = (cmd >> 2) & 3
            if e and s:
                size = 4 - n
                return f"Initiate Download (expedited, {size}B)"
            return "Initiate Download (segmented)"
        if ccs == 2:
            return "Initiate Upload"
        if ccs == 3:
            return "Upload Segment"
        if ccs == 0:
            return "Download Segment"
        if ccs == 4:
            return "Abort Transfer"
        return f"SDO Request (ccs={ccs})"
    else:
        scs = (cmd >> 5) & 0x07   # server command specifier
        if scs == 2:
            e = (cmd >> 1) & 1
            s = cmd & 1
            n = (cmd >> 2) & 3
            if e and s:
                size = 4 - n
                return f"Upload Response (expedited, {size}B)"
            return "Upload Response (segmented)"
        if scs == 3:
            return "Download Response"
        if scs == 1:
            return "Upload Segment Response"
        if scs == 0:
            return "Download Segment Response"
        if scs == 4:
            # Abort Transfer -- this function only receives the command byte.
            # Full abort code decode (bytes 4-7) is handled in _handle_sdo_response
            # where the complete frame data is available.
            return "SDO Abort"
        return f"SDO Response (scs={scs})"


# ── COB-ID classification ─────────────────────────────────────────────────────

@dataclass
class CobInfo:
    frame_type: str   # "NMT" | "SYNC" | "TIME" | "EMCY" | "TPDO1"... | "SDO-req" | "SDO-resp" | "Heartbeat"
    node_id: Optional[int]   # None for broadcast frames (NMT, SYNC, TIME)
    pdo_index: Optional[int]   # 1-4 for PDO types
    is_tx: Optional[bool]   # True=TPDO, False=RPDO, None for non-PDO


def classify_cob_id(cob_id: int) -> Optional[CobInfo]:
    """
    Classify a CAN arbitration ID as a CANopen frame type.
    Returns None if the ID is outside the CANopen range (0x000-0x77F).
    Extended-ID frames (29-bit) are never CANopen -- return None.
    """
    if cob_id > 0x77F:
        return None

    if cob_id == 0x000:
        return CobInfo("NMT", None, None, None)
    if cob_id == 0x080:
        return CobInfo("SYNC", None, None, None)
    if cob_id == 0x100:
        return CobInfo("TIME", None, None, None)

    if 0x081 <= cob_id <= 0x0FF:
        return CobInfo("EMCY", cob_id - 0x080, None, None)
    if 0x181 <= cob_id <= 0x1FF:
        return CobInfo("TPDO1", cob_id - 0x180, 1, True)
    if 0x201 <= cob_id <= 0x27F:
        return CobInfo("RPDO1", cob_id - 0x200, 1, False)
    if 0x281 <= cob_id <= 0x2FF:
        return CobInfo("TPDO2", cob_id - 0x280, 2, True)
    if 0x301 <= cob_id <= 0x37F:
        return CobInfo("RPDO2", cob_id - 0x300, 2, False)
    if 0x381 <= cob_id <= 0x3FF:
        return CobInfo("TPDO3", cob_id - 0x380, 3, True)
    if 0x401 <= cob_id <= 0x47F:
        return CobInfo("RPDO3", cob_id - 0x400, 3, False)
    if 0x481 <= cob_id <= 0x4FF:
        return CobInfo("TPDO4", cob_id - 0x480, 4, True)
    if 0x501 <= cob_id <= 0x57F:
        return CobInfo("RPDO4", cob_id - 0x500, 4, False)
    if 0x581 <= cob_id <= 0x5FF:
        return CobInfo("SDO-resp", cob_id - 0x580, None, None)
    if 0x601 <= cob_id <= 0x67F:
        return CobInfo("SDO-req", cob_id - 0x600, None, None)
    if 0x701 <= cob_id <= 0x77F:
        return CobInfo("Heartbeat", cob_id - 0x700, None, None)

    return None


# ── Node state record ─────────────────────────────────────────────────────────

@dataclass
class NodeRecord:
    node_id: int
    nmt_state: str = "Unknown"
    last_heartbeat: float = field(default_factory=time.monotonic)
    heartbeat_interval_ms: Optional[float] = None   # estimated from recent HBs
    _prev_heartbeat: float = field(default_factory=time.monotonic, repr=False)
    frame_count: int = 0
    first_seen: float = field(default_factory=time.monotonic)
    # CiA 402 drive state (populated from PDOs when EDS is loaded)
    cia402_statusword: Optional[int] = None
    cia402_state: Optional[str] = None
    cia402_mode: Optional[str] = None
    cia402_target_value: Optional[float] = None
    cia402_actual_value: Optional[float] = None
    emcy_active: bool = False
    last_emcy_code: Optional[int] = None


# ── SDO pending record ────────────────────────────────────────────────────────

@dataclass
class SdoPending:
    node_id: int
    index: int
    subindex: int
    cmd: int
    description: str
    timestamp: float = field(default_factory=time.monotonic)


@dataclass
class SdoTransaction:
    node_id: int
    index: int
    subindex: int
    request_cmd: str
    response_cmd: str
    data_hex: str
    value_int: Optional[int]   # int interpretation of data (little-endian)
    timestamp: float = field(default_factory=time.monotonic)
    is_abort: bool = False


# ── EMCY record ───────────────────────────────────────────────────────────────

@dataclass
class EmcyRecord:
    node_id: int
    error_code: int
    error_name: str
    error_register: int
    error_register_flags: list[str]
    manufacturer_data: str   # hex
    timestamp: float = field(default_factory=time.monotonic)


# ── NMT record ────────────────────────────────────────────────────────────────

@dataclass
class NmtCommand:
    cs: int          # command specifier byte
    target_node: int   # 0 = broadcast
    description: str
    timestamp: float = field(default_factory=time.monotonic)


_NMT_COMMANDS: dict[int, str] = {
    0x01: "Start Node (Operational)",
    0x02: "Stop Node (Stopped)",
    0x80: "Enter Pre-Operational",
    0x81: "Reset Node (Application)",
    0x82: "Reset Communication",
}


# ── EDS / canopen library integration ────────────────────────────────────────

_canopen_available = False
try:
    import canopen  # type: ignore
    _canopen_available = True
except ImportError:
    pass


class EdsStore:
    """
    Wraps a loaded canopen.Network (EDS file).
    Provides PDO signal decode and object dictionary lookup.
    Thread-safe reads via RLock.
    """
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._network: Optional["canopen.Network"] = None
        self._filename: Optional[str] = None
        self._node_ids: list[int] = []

    def load(self, eds_bytes: bytes, filename: str) -> dict:
        """
        Load an EDS file. Returns {ok, message, node_count}.
        The canopen library requires a file path, so we write to a temp file.
        """
        if not _canopen_available:
            return {"ok": False, "message": "canopen library not installed -- pip install canopen"}

        import canopen
        import tempfile
        import os

        try:
            # canopen library needs a real file path - write bytes to a temp file
            with tempfile.NamedTemporaryFile(suffix=".eds", delete=False, mode="wb") as f:
                f.write(eds_bytes)
                temp_path = f.name

            try:
                network = canopen.Network()
                # add_node(node_id, object_dictionary_path) - standard canopen API
                network.add_node(1, temp_path)  # registers OD under node 1
            finally:
                os.unlink(temp_path)

            with self._lock:
                self._network  = network
                self._filename = filename
                self._node_ids = list(network.nodes.keys())

            log.info("EDS loaded: %s", filename)
            return {
                "ok":         True,
                "message":    f"EDS loaded: {filename}",
                "node_count": len(network.nodes),
                "node_ids":   list(network.nodes.keys()),
            }
        except Exception as exc:
            log.warning("EDS load failed: %s", exc)
            return {"ok": False, "message": f"EDS parse error: {exc}"}

    def clear(self) -> None:
        with self._lock:
            self._network  = None
            self._filename = None
            self._node_ids = []

    @property
    def loaded(self) -> bool:
        return self._network is not None

    @property
    def filename(self) -> Optional[str]:
        return self._filename

    def decode_pdo(self, node_id: int, pdo_index: int, is_tx: bool, data: bytes) -> Optional[dict]:
        """
        Decode a PDO payload directly from EDS mapping objects. Fully offline.

        The canopen library's node.tpdo[n] infrastructure requires a live SDO
        read to initialise the mapping (node.tpdo.read()), which we cannot do
        in passive capture mode. Instead we read the mapping parameters directly
        from the object dictionary that was parsed from the EDS file, then
        extract values from the raw PDO bytes manually.

        Mapping object layout per CiA 301:
          TPDO1 mapping = OD index 0x1A00 (TPDO2=0x1A01, etc.)
          RPDO1 mapping = OD index 0x1600 (RPDO2=0x1601, etc.)
          Each sub-entry (sub 1..N) is UINT32:
            bits 31-16 = object index
            bits 15-8  = object subindex
            bits 7-0   = bit length in PDO payload

        Data extraction: little-endian bit stream from byte 0 onwards.
        """
        if not self._canopen_available_check():
            return None
        with self._lock:
            if self._network is None:
                return None
            try:
                od = self._get_first_od()
                if od is None:
                    return None

                # Locate the mapping record in the OD
                map_index = (0x1A00 if is_tx else 0x1600) + (pdo_index - 1)
                if map_index not in od:
                    log.debug("PDO decode: mapping 0x%04X not in EDS", map_index)
                    return None

                map_obj = od[map_index]

                # Sub 0 = number of mapped objects
                try:
                    num_entries = int(map_obj[0].default)
                except Exception:
                    return None
                if num_entries == 0:
                    return None

                # Signed CANopen data types: INT8=0x02, INT16=0x03, INT32=0x04, INT64=0x15
                _SIGNED_TYPES = {0x02, 0x03, 0x04, 0x15, 0x10}   # INT8/16/32/64, INT24

                data_bytes = bytes(data)
                data_int   = int.from_bytes(data_bytes, "little") if data_bytes else 0
                total_bits = len(data_bytes) * 8

                signals = []
                bit_pos = 0

                for sub in range(1, num_entries + 1):
                    try:
                        entry   = map_obj[sub]
                        map_val = int(entry.default)
                    except Exception:
                        continue

                    if map_val == 0:
                        continue   # dummy / padding

                    obj_index    = (map_val >> 16) & 0xFFFF
                    obj_subindex = (map_val >> 8)  & 0xFF
                    bit_len      = map_val & 0xFF

                    if bit_len == 0:
                        continue
                    if bit_pos + bit_len > total_bits:
                        log.debug("PDO decode: bit_pos %d + bit_len %d > data bits %d",
                                  bit_pos, bit_len, total_bits)
                        break

                    # Extract bits from little-endian stream
                    mask    = (1 << bit_len) - 1
                    raw_val = (data_int >> bit_pos) & mask
                    bit_pos += bit_len

                    # Look up name and data type from OD
                    name      = f"0x{obj_index:04X}:{obj_subindex}"
                    unit      = _BUILTIN_OBJECTS.get((obj_index, obj_subindex), {}).get("unit", "")
                    is_signed = False

                    try:
                        if obj_index in od:
                            obj = od[obj_index]
                            # VAR objects have data_type directly; RECORD/ARRAY do not
                            if hasattr(obj, "data_type"):
                                name      = obj.parameter_name
                                is_signed = (obj.data_type in _SIGNED_TYPES)
                            elif obj_subindex in obj:
                                sub_obj   = obj[obj_subindex]
                                name      = sub_obj.parameter_name
                                is_signed = (sub_obj.data_type in _SIGNED_TYPES)
                    except Exception:
                        pass

                    # Sign-extend if the data type is signed
                    if is_signed and bit_len > 1 and raw_val >= (1 << (bit_len - 1)):
                        raw_val -= (1 << bit_len)

                    signals.append({
                        "name":  name,
                        "value": float(raw_val),
                        "unit":  unit,
                    })

                return {"signals": signals} if signals else None

            except Exception as exc:
                log.debug("PDO decode error node=%d pdo%d: %s", node_id, pdo_index, exc)
                return None

    def lookup_object(self, index: int, subindex: int) -> Optional[dict]:
        """Look up an object by index/subindex. Returns {name, access, data_type, default}."""
        with self._lock:
            if self._network is None:
                return None
            try:
                od = self._get_first_od()
                if od is None:
                    return None
                obj = od.get(index)
                if obj is None:
                    return {"name": f"0x{index:04X}", "access": "unknown", "data_type": "unknown"}
                if hasattr(obj, "subindices"):
                    sub = obj.subindices.get(subindex)
                    if sub:
                        return {
                            "name":      sub.name,
                            "access":    getattr(sub, "access_type", "unknown"),
                            "data_type": str(getattr(sub, "data_type", "unknown")),
                        }
                return {
                    "name":      obj.name,
                    "access":    getattr(obj, "access_type", "unknown"),
                    "data_type": str(getattr(obj, "data_type", "unknown")),
                }
            except Exception:
                return None

    def _get_first_od(self):
        """Return the object dictionary from the first node in the network."""
        if self._network is None:
            return None
        for node in self._network.nodes.values():
            return node.object_dictionary
        return None

    def _canopen_available_check(self) -> bool:
        return _canopen_available


eds_store = EdsStore()


# ── Main CANopen store ────────────────────────────────────────────────────────

class CANopenStore:
    def __init__(self) -> None:
        self._lock               = threading.Lock()
        self._mode: str          = "off"
        self._auto_detected      = False
        self._canopen_frame_count = 0

        self._nodes: dict[int, NodeRecord] = {}
        self._sdo_pending: dict[int, SdoPending] = {}   # keyed by node_id
        self._recent_sdo: list[dict]  = []   # last 50 completed SDO transactions
        self._recent_emcy: list[dict] = []   # last 20 EMCY events
        self._nmt_log: list[dict]     = []   # last 20 NMT commands seen
        self._sync_count: int         = 0
        self._last_sync: Optional[float] = None

    # ── Public control ────────────────────────────────────────────────────────

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

    def reset(self) -> None:
        with self._lock:
            self._auto_detected       = False
            self._canopen_frame_count = 0
            self._nodes.clear()
            self._sdo_pending.clear()
            self._recent_sdo.clear()
            self._recent_emcy.clear()
            self._nmt_log.clear()
            self._sync_count  = 0
            self._last_sync   = None

    # ── Frame processing (called from bus thread) ────────────────────────────

    def process_frame(
        self, arb_id: int, data: bytes, is_extended: bool
    ) -> Optional[dict]:
        """
        Main entry point -- called for every frame from ws_broadcaster.on_frame().
        Returns a dict to attach as frame["canopen"] if the frame is CANopen,
        or None if it is not a CANopen frame.

        Extended-ID frames are never CANopen -- return None immediately.
        """
        if is_extended:
            return None

        cob = classify_cob_id(arb_id)
        if cob is None:
            return None

        # Count for auto-detection even when mode is off
        with self._lock:
            self._canopen_frame_count += 1
            if not self._auto_detected and self._canopen_frame_count >= _DETECT_THRESHOLD:
                self._auto_detected = True
                log.info("CANopen auto-detected after %d frames", self._canopen_frame_count)

        if self._mode != "on":
            # Still return minimal type label for the message table even in off mode
            # so users see it when they look at the auto-detected banner
            return None

        return self._decode(cob, arb_id, data)

    # ── Internal decode ───────────────────────────────────────────────────────

    def _decode(self, cob: CobInfo, arb_id: int, data: bytes) -> dict:
        now = time.monotonic()
        base: dict = {
            "frame_type": cob.frame_type,
            "node_id":    cob.node_id,
            "cob_id_hex": f"0x{arb_id:03X}",
        }

        if cob.frame_type == "NMT":
            base.update(self._handle_nmt(data, now))
        elif cob.frame_type == "SYNC":
            base.update(self._handle_sync(now))
        elif cob.frame_type == "TIME":
            base["detail"] = "TIME object"
        elif cob.frame_type == "EMCY":
            base.update(self._handle_emcy(cob.node_id, data, now))
        elif cob.frame_type in ("TPDO1", "TPDO2", "TPDO3", "TPDO4",
                                "RPDO1", "RPDO2", "RPDO3", "RPDO4"):
            base.update(self._handle_pdo(cob, data, now))
        elif cob.frame_type == "SDO-req":
            base.update(self._handle_sdo_request(cob.node_id, data, now))
        elif cob.frame_type == "SDO-resp":
            base.update(self._handle_sdo_response(cob.node_id, data, now))
        elif cob.frame_type == "Heartbeat":
            base.update(self._handle_heartbeat(cob.node_id, data, now))

        # Update per-node frame count
        if cob.node_id is not None:
            with self._lock:
                rec = self._nodes.get(cob.node_id)
                if rec is None:
                    self._nodes[cob.node_id] = NodeRecord(node_id=cob.node_id, frame_count=1)
                else:
                    rec.frame_count += 1

        return base

    def _handle_nmt(self, data: bytes, now: float) -> dict:
        if len(data) < 2:
            return {"detail": "NMT (malformed)"}
        cs          = data[0]
        target_node = data[1]
        desc = _NMT_COMMANDS.get(cs, f"NMT cmd 0x{cs:02X}")
        record = {
            "cs":          cs,
            "target_node": target_node,
            "description": desc,
        }
        with self._lock:
            self._nmt_log = [record] + self._nmt_log
            self._nmt_log = self._nmt_log[:20]
        return {"detail": f"{desc} -> node 0x{target_node:02X}", "nmt": record}

    def _handle_sync(self, now: float) -> dict:
        with self._lock:
            self._sync_count += 1
            self._last_sync   = now
        return {"detail": "SYNC", "sync_count": self._sync_count}

    def _handle_emcy(self, node_id: Optional[int], data: bytes, now: float) -> dict:
        if len(data) < 5 or node_id is None:
            return {"detail": "EMCY (malformed)"}

        error_code = data[0] | (data[1] << 8)
        error_reg  = data[2]
        mfr_data   = data[3:8].hex(" ").upper() if len(data) >= 8 else data[3:].hex(" ").upper()

        emcy = {
            "node_id":              node_id,
            "error_code":           error_code,
            "error_code_hex":       f"0x{error_code:04X}",
            "error_name":           _emcy_class_name(error_code),
            "error_register":       error_reg,
            "error_register_flags": _emcy_register_flags(error_reg),
            "manufacturer_data":    mfr_data,
            "timestamp":            round(now, 3),
        }

        with self._lock:
            rec = self._nodes.get(node_id)
            if rec is None:
                rec = NodeRecord(node_id=node_id)
                self._nodes[node_id] = rec
            rec.emcy_active    = error_code != 0x0000
            rec.last_emcy_code = error_code if error_code != 0x0000 else None

            # Prepend, keep last 20
            self._recent_emcy = [emcy] + [
                e for e in self._recent_emcy if e["node_id"] != node_id or e["error_code"] != error_code
            ]
            self._recent_emcy = self._recent_emcy[:20]

        return {
            "detail": f"EMCY: {_emcy_class_name(error_code)} (0x{error_code:04X})",
            "emcy":   emcy,
        }

    def _handle_pdo(self, cob: CobInfo, data: bytes, now: float) -> dict:
        result: dict = {
            "pdo_index": cob.pdo_index,
            "is_tx":     cob.is_tx,
            "data_hex":  data.hex(" ").upper(),
        }

        # Attempt EDS decode
        if eds_store.loaded and cob.node_id is not None:
            decoded = eds_store.decode_pdo(cob.node_id, cob.pdo_index, cob.is_tx, data)
            if decoded:
                result["pdo_signals"] = decoded["signals"]

                # CiA 402 drive state -- look for statusword by object name
                for sig in decoded["signals"]:
                    name_lower = sig["name"].lower()
                    if "statusword" in name_lower or "status_word" in name_lower:
                        sw = int(sig["value"]) & 0xFFFF
                        state = _decode_cia402_statusword(sw)
                        with self._lock:
                            rec = self._nodes.get(cob.node_id)
                            if rec:
                                rec.cia402_statusword = sw
                                rec.cia402_state      = state
                        result["cia402_state"]      = state
                        result["cia402_statusword"] = f"0x{sw:04X}"

                    elif "modes_of_operation_display" in name_lower or "mode_of_operation" in name_lower:
                        mode_int = int(sig["value"]) & 0xFF
                        mode_name = _CIA402_MODES.get(mode_int, f"Mode {mode_int}")
                        with self._lock:
                            rec = self._nodes.get(cob.node_id)
                            if rec:
                                rec.cia402_mode = mode_name
                        result["cia402_mode"] = mode_name

        # Best-effort CiA 402 statusword without EDS:
        # TPDO1 default mapping (CiA 402 spec) places Statusword in bytes 0-1.
        # Only applied when no EDS is loaded -- EDS path above is authoritative.
        # Annotated as "(default)" so users know it assumed standard TPDO1 mapping.
        if (cob.pdo_index == 1 and cob.is_tx
                and len(data) >= 2
                and not eds_store.loaded
                and cob.node_id is not None):
            sw = data[0] | (data[1] << 8)
            state = _decode_cia402_statusword(sw)
            result["cia402_state_default"] = state
            result["cia402_statusword"] = f"0x{sw:04X}"
            with self._lock:
                rec = self._nodes.get(cob.node_id)
                if rec:
                    # Always overwrite -- state changes every time Controlword
                    # is written and TPDO1 carries the new Statusword.
                    # The is_None guard prevented any update after the first frame.
                    rec.cia402_state      = f"{state} (default)"
                    rec.cia402_statusword = sw

        return result

    def _handle_sdo_request(self, node_id: Optional[int], data: bytes, now: float) -> dict:
        if len(data) < 4 or node_id is None:
            return {"detail": "SDO-req (malformed)"}

        cmd      = data[0]
        index    = data[1] | (data[2] << 8)
        subindex = data[3]
        desc     = _sdo_description(cmd, is_request=True)

        with self._lock:
            self._sdo_pending[node_id] = SdoPending(
                node_id=node_id, index=index, subindex=subindex,
                cmd=cmd, description=desc, timestamp=now,
            )

        return {
            "detail":    f"SDO req: {desc} 0x{index:04X}:{subindex}",
            "sdo_index": f"0x{index:04X}",
            "sdo_sub":   subindex,
            "sdo_desc":  desc,
        }

    def _handle_sdo_response(self, node_id: Optional[int], data: bytes, now: float) -> dict:
        if len(data) < 4 or node_id is None:
            return {"detail": "SDO-resp (malformed)"}

        cmd      = data[0]
        index    = data[1] | (data[2] << 8)
        subindex = data[3]
        resp_desc = _sdo_description(cmd, is_request=False)

        # Data bytes (4-7) for expedited upload response
        payload = bytes(data[4:8]) if len(data) >= 8 else b""
        # Trim to actual size for expedited transfers
        n = (cmd >> 2) & 3
        if (cmd >> 1) & 1 and cmd & 1:   # expedited + size indicated
            payload = payload[:4 - n]

        data_hex  = payload.hex(" ").upper() if payload else ""
        value_int: Optional[int] = None
        if payload:
            value_int = int.from_bytes(payload, "little")

        # Pair with pending request
        transaction: Optional[dict] = None
        with self._lock:
            pending = self._sdo_pending.pop(node_id, None)
            # Only pair if within timeout window and same index/subindex
            if (pending is not None
                    and now - pending.timestamp <= _SDO_PAIR_TIMEOUT_S
                    and pending.index == index
                    and pending.subindex == subindex):
                transaction = {
                    "node_id":      node_id,
                    "index":        f"0x{index:04X}",
                    "subindex":     subindex,
                    "request_cmd":  pending.description,
                    "response_cmd": resp_desc,
                    "data_hex":     data_hex,
                    "value_int":    value_int,
                    "timestamp":    round(now, 3),
                    "is_abort":     resp_desc == "SDO Abort",
                }

                # Enrich with object name:
                # 1. Built-in CiA 301/402 dict (works without EDS)
                # 2. EDS as fallback for vendor-specific objects
                obj_info = _builtin_lookup(index, subindex)
                if obj_info is None and eds_store.loaded:
                    eds_obj = eds_store.lookup_object(index, subindex)
                    if eds_obj:
                        obj_info = {"name": eds_obj.get("name", ""), "unit": ""}
                if obj_info:
                    transaction["object_name"] = obj_info["name"]
                    transaction["unit"]        = obj_info.get("unit", "")

                self._recent_sdo = [transaction] + self._recent_sdo
                self._recent_sdo = self._recent_sdo[:50]

        result: dict = {
            "detail":    f"SDO resp: {resp_desc} 0x{index:04X}:{subindex}",
            "sdo_index": f"0x{index:04X}",
            "sdo_sub":   subindex,
            "sdo_desc":  resp_desc,
        }
        if data_hex:
            result["data_hex"]  = data_hex
            result["value_int"] = value_int
        if transaction:
            result["sdo_transaction"] = transaction

        return result

    def _handle_heartbeat(self, node_id: Optional[int], data: bytes, now: float) -> dict:
        if node_id is None:
            return {"detail": "Heartbeat (unknown node)"}

        state_byte = data[0] & 0x7F if data else 0
        state_name = _NMT_HEARTBEAT_STATES.get(state_byte, f"State 0x{state_byte:02X}")

        with self._lock:
            rec = self._nodes.get(node_id)
            if rec is None:
                rec = NodeRecord(node_id=node_id, nmt_state=state_name)
                self._nodes[node_id] = rec
            else:
                interval_ms: Optional[float] = None
                if rec.last_heartbeat:
                    interval_ms = (now - rec.last_heartbeat) * 1000
                rec._prev_heartbeat        = rec.last_heartbeat
                rec.last_heartbeat         = now
                rec.nmt_state              = state_name
                if interval_ms and 0 < interval_ms < 60_000:
                    rec.heartbeat_interval_ms = round(interval_ms, 1)

        return {
            "detail":     f"Heartbeat: {state_name}",
            "nmt_state":  state_name,
            "state_byte": state_byte,
        }

    # ── Status snapshots ──────────────────────────────────────────────────────

    def status_dict(self) -> dict:
        """Lightweight snapshot for the 1s WebSocket stats push."""
        return {
            "canopen_mode":     self._mode,
            "canopen_detected": self._auto_detected,
        }

    def full_status(self) -> dict:
        """Full status for panel polling (GET /canopen/status)."""
        with self._lock:
            now = time.monotonic()
            nodes = []
            for node_id in sorted(self._nodes.keys()):
                rec = self._nodes[node_id]
                node_dict: dict = {
                    "node_id":              node_id,
                    "node_id_hex":          f"0x{node_id:02X}",
                    "nmt_state":            rec.nmt_state,
                    "frame_count":          rec.frame_count,
                    "last_heartbeat_s":     round(now - rec.last_heartbeat, 1) if rec.last_heartbeat else None,
                    "heartbeat_interval_ms": rec.heartbeat_interval_ms,
                    "emcy_active":          rec.emcy_active,
                }
                if rec.cia402_state is not None:
                    node_dict["cia402_state"]      = rec.cia402_state
                    node_dict["cia402_statusword"]  = f"0x{rec.cia402_statusword:04X}" if rec.cia402_statusword is not None else None
                    node_dict["cia402_mode"]        = rec.cia402_mode
                nodes.append(node_dict)

            return {
                "mode":             self._mode,
                "auto_detected":    self._auto_detected,
                "eds_loaded":       eds_store.loaded,
                "eds_filename":     eds_store.filename,
                "canopen_lib":      _canopen_available,
                "nodes":            nodes,
                "recent_sdo":       list(self._recent_sdo),
                "recent_emcy":      list(self._recent_emcy),
                "nmt_log":          list(self._nmt_log),
                "sync_count":       self._sync_count,
                "last_sync_s":      round(now - self._last_sync, 1) if self._last_sync else None,
            }


# Singleton
canopen_store = CANopenStore()