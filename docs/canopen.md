# CANopen Decoder Guide

> CANviz v0.3.1 -- CiA 301 (Communication Profile) + CiA 402 (Drive Profile)

---

## Overview

The CANopen decoder passively captures and decodes CANopen traffic without requiring
any configuration from the node. The COB-ID structure defined by CiA 301 is fixed by
specification, so a large set of information is available from the CAN ID alone before
any EDS file is loaded.

**What works without an EDS file:**
- Frame type labelling (TPDO1, SDO-resp, Heartbeat, EMCY, NMT, SYNC)
- Node ID extraction from every frame
- NMT state machine per node (from Heartbeat frames)
- EMCY decode (error code, error register flags, manufacturer data)
- SDO request/response pairing (names from 180-entry built-in CiA 301/402 dict)
- CiA 402 Statusword best-effort decode from TPDO1 bytes 0-1 (standard default mapping)

**What requires an EDS file:**
- Named PDO signal values 
- Vendor-specific object names (0x2000+ range)
- PDO signals in the Plot tab signal selector

---

## Quick Start

1. Connect to the CAN bus via the Connection panel.
2. Open the **CANopen** tab in the right panel.
3. If CANopen traffic is detected, an amber badge appears automatically.
4. Click **Enable Decoder**.
5. Nodes appear in the Nodes table within one heartbeat cycle (typically 250-1000 ms).

---

## Panel Sections

### Nodes Table

Populated automatically from Heartbeat frames (COB-ID range 0x701-0x77F). Each node
discovered shows:

| Column | Description |
|--------|-------------|
| Node | Node ID in hex (0x01-0x7F) |
| NMT State | Operational (green) / Pre-Operational (amber) / Stopped (red) |
| Heartbeat | Time since last heartbeat frame |
| Interval | Estimated heartbeat interval from timestamp delta |
| Frames | Total CANopen frames seen from this node |

If a node has CiA 402 drive profile data visible, a sub-row shows the decoded drive
state machine state and Statusword:

- **Operation Enabled** (green) -- motor live, drive accepting commands
- **Switched On** (amber) -- power applied, not yet enabled
- **Ready to Switch On** (amber) -- drive healthy, awaiting enable sequence
- **Switch On Disabled** (amber) -- drive powered, not ready
- **Quick Stop Active** (amber) -- decelerating
- **Fault** (red) -- drive in fault state, requires Fault Reset

States annotated with **(default)** mean CANviz assumed the standard CiA 402 TPDO1
mapping (Statusword in bytes 0-1) without EDS confirmation. Loading the device EDS
removes this annotation.

---

### CiA 402 Drive Control

Quick Controlword shortcuts for common state transitions. Writes directly to 0x6040
via SDO on the selected node.

| Button | Controlword | Transition |
|--------|-------------|------------|
| Enable | 0x000F | Switched On -> Operation Enabled |
| Switch On | 0x0007 | Ready to Switch On -> Switched On |
| Shutdown | 0x0006 | Any -> Ready to Switch On |
| Quick Stop | 0x0002 | Operation Enabled -> Quick Stop Active |
| Disable | 0x0000 | Any -> Switch On Disabled |
| Fault Reset | 0x0080 | Fault -> Switch On Disabled |

A one-time safety warning is shown on first use. After acceptance, the warning is
stored in browser localStorage. A small "safety notice" link resets it if needed.

**To enable a real drive (standard CiA 402 sequence):**
1. Confirm NMT state is Operational
2. Click **Shutdown** (0x0006) -- brings drive to Ready to Switch On
3. Click **Switch On** (0x0007) -- brings drive to Switched On
4. Click **Enable** (0x000F) -- brings drive to Operation Enabled

> **Important:** On a real drive, Operation Enabled means the motor is live and
> will respond to position/velocity/torque commands. Ensure the machine is safe
> before sending Enable.

---

### EMCY Events

Shows only when emergency frames (COB-ID 0x081-0x0FF) have been received.
Each event shows:

- Node ID
- Error code (16-bit) with CiA 301 error class name
- Error register flags: Generic / Current / Voltage / Temperature / Communication / Device Profile / Manufacturer
- Manufacturer-specific data (hex)

Error code 0x0000 with no flags = "Error Reset / No Error" -- the node is clearing a
previous fault. This is normal after Fault Reset.

---

### SDO Log

Auto-populated from bus traffic. Every SDO request/response pair seen on the bus is
captured and displayed. Passive -- no polling required.

| Column | Description |
|--------|-------------|
| Node | Source/destination node in hex |
| Index:Sub | Object dictionary address (e.g. 0x6041:0) |
| Name | Object name from built-in dict or loaded EDS |
| Value | Raw hex bytes + decimal interpretation for numeric types |
| Status | OK or ABORT (abort code decoded) |

Up to 50 transactions stored. Newest entries appear at the top.

---

### SDO Read

Sends an expedited SDO upload request to a live node. The response arrives as a normal
CAN frame, is decoded by the passive capture pipeline, and appears in the SDO log
above. No synchronous blocking -- the request fires and returns immediately.

Fields: Node ID (decimal), Index (hex, e.g. 0x1008), Sub (decimal).

**Tip:** Use the Object Dictionary browser below to find standard object indices and
auto-fill this form with one click.

---

### SDO Write

Sends an expedited SDO download to a live node. Writes are sent immediately on click
-- no second confirmation step. The button is disabled (amber) until valid hex byte
data is entered (1-4 bytes, space or comma separated, e.g. `0F 00`).

The object name is looked up automatically as you type the index.

Response (download acknowledgement from node) appears in the SDO log.

**Data encoding:** Little-endian byte order. For a 16-bit value like Controlword 0x000F,
enter `0F 00` (LSB first). For a 32-bit value like Target Position 12345 (0x00003039),
enter `39 30 00 00`.

**Example -- read device name:**
```
Node ID: 1    Index: 0x1008    Sub: 0    (no data needed, use SDO Read instead)
```

**Example -- set Modes of Operation to Profile Position (mode 1):**
```
Node ID: 1    Index: 0x6060    Sub: 0    Data: 01
```

**Example -- set Profile Velocity to 500 counts/s (0x000001F4):**
```
Node ID: 1    Index: 0x6081    Sub: 0    Data: F4 01 00 00
```

---

### NMT Commands

Sends Network Management commands. Requires selecting a target (specific node or
broadcast to all). Click a command button, choose the target in the confirm strip
that appears, then click Send.

| Command | CS Byte | Effect |
|---------|---------|--------|
| Operational | 0x01 | Node starts PDO transmission, CANviz receives live data |
| Pre-Operational | 0x80 | PDOs stop, only SDOs and heartbeats continue |
| Stop | 0x02 | Node stops all communication except heartbeat |
| Reset Node | 0x81 | Full application reset (device reboots its firmware) |
| Reset Comm | 0x82 | Resets communication parameters only |

> **Reset Node** to all nodes (broadcast) will reset every device on the bus
> simultaneously. Use with care on live machines.

---

### Object Dictionary Browser

Collapsible section (click the header to expand). Contains all 180 built-in CiA 301
and CiA 402 standard objects. Search by name or index:

- `velocity` -- shows all velocity-related objects
- `6041` or `0x6041` -- finds Statusword directly
- `heartbeat` -- finds producer/consumer heartbeat time objects

Clicking **Read** next to any result auto-fills the SDO Read form above with that
index and subindex. Press Read in the SDO Read panel to query the live node.

---

### Read All Node Objects

Sends 15 SDO read requests to every discovered node and collects the responses in
the SDO log. One click replaces what would otherwise be 15 manual read operations
per node.

Objects read per node:

| Index | Name |
|-------|------|
| 0x1008:0 | Manufacturer Device Name |
| 0x1018:1 | Identity: Vendor ID |
| 0x1018:2 | Identity: Product Code |
| 0x1018:3 | Identity: Revision Number |
| 0x1018:4 | Identity: Serial Number |
| 0x1009:0 | Manufacturer Hardware Version |
| 0x100A:0 | Manufacturer Software Version |
| 0x6041:0 | Statusword |
| 0x6061:0 | Modes of Operation Display |
| 0x6064:0 | Position Actual Value |
| 0x606C:0 | Velocity Actual Value |
| 0x6081:0 | Profile Velocity |
| 0x6083:0 | Profile Acceleration |
| 0x6084:0 | Profile Deceleration |
| 0x1017:0 | Producer Heartbeat Time |

Requests are sent with 8 ms gaps between each to avoid flooding slow nodes.
Unresponsive nodes will not appear in the log for that read cycle.

---

### EDS / DCF File Upload

Optional. Enables named PDO signal decode for vendor-specific objects and unlocks
PDO signal plotting.

EDS (Electronic Data Sheet) files are device-specific. They cannot be bundled with
CANviz due to being vendor-proprietary. Obtain yours from:
- The device manufacturer's website or support portal
- The motor/drive commissioning software (often exports EDS)
- The device itself via LSS (Layer Setting Services) on some devices

DCF (Device Configuration File) files use the same format and are also accepted.

After upload, TPDO signals are decoded to named values and appear in the Plot tab
signal selector under `CANopen 0x01.Statusword`, `CANopen 0x01.Position Actual Value`
etc.

**EDS PDO mapping used by CANviz:**
- TPDO1 = object 0x1A00 (sub 1..N define what is mapped)
- TPDO2 = object 0x1A01
- RPDO1 = object 0x1600
- RPDO2 = object 0x1601

CANviz reads the mapping parameters directly from the EDS defaults (offline decode --
no live SDO read of the device required).

---

## PDO Signal Plotting

When an EDS is loaded, CANopen PDO signals feed directly into the same plot store as
DBC signals. To plot a CANopen signal:

1. Upload your EDS file.
2. Open the **Plot** tab in the bottom panel.
3. Click **Add Signal** and select from the CANopen signals (e.g. `CANopen 0x01 > Position Actual Value`).
4. The signal plots live as TPDO frames arrive.

Without EDS, the best-effort Statusword decode (bytes 0-1 of TPDO1) is not
continuously numeric enough for useful plotting. Load an EDS to get position,
velocity, and torque signals into the plot.

---

## Message Table Columns

When the decoder is enabled, three columns are appended to the message table:

| Column | Width | Content |
|--------|-------|---------|
| Type | 80px | Frame type: TPDO1 (blue), RPDO (purple), Heartbeat (green), EMCY (red), SDO-resp (green), NMT (amber), SYNC (muted) |
| Node | 50px | Node ID hex (0x01, 0x02 ...) |
| Protocol Info | 200px | Context-specific: Heartbeat shows NMT state; SDO-resp shows object name = value; EMCY shows error class name; NMT shows command description |

Badges appear on rows with matched transactions:
- Red **EMCY** badge -- emergency frame received for this CAN ID
- Green **SDO** badge -- SDO request/response pair successfully matched

---

## REST API Reference

All endpoints are prefixed `/canopen`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/canopen/status` | Full decoder status: nodes, SDO log, EMCY log, NMT log |
| POST | `/canopen/mode` | `{"mode": "on"}` or `{"mode": "off"}` |
| POST | `/canopen/reset` | Clear all accumulated state |
| POST | `/canopen/eds` | Upload EDS / DCF file (multipart form) |
| DELETE | `/canopen/eds` | Unload current EDS |
| POST | `/canopen/sdo/read` | `{"node_id": 1, "index": 4161, "subindex": 0}` |
| POST | `/canopen/sdo/write` | `{"node_id": 1, "index": 24640, "subindex": 0, "data": [15, 0], "confirmed": true}` |
| POST | `/canopen/nmt` | `{"node_id": 0, "command": 1, "confirmed": true}` |
| GET | `/canopen/objects` | `?q=velocity` -- search built-in object dictionary |
| POST | `/canopen/export` | Read all standard objects from all discovered nodes |

Full interactive docs at `http://localhost:8080/docs` while running.

### `/canopen/status` response structure

```json
{
  "mode": "on",
  "auto_detected": true,
  "eds_loaded": false,
  "eds_filename": null,
  "canopen_lib": true,
  "sync_count": 21306,
  "last_sync_s": 44.1,
  "nodes": [
    {
      "node_id": 1,
      "node_id_hex": "0x01",
      "nmt_state": "Operational",
      "last_heartbeat_s": 0.25,
      "heartbeat_interval_ms": 250,
      "frame_count": 33251,
      "emcy_active": false,
      "last_emcy_code": null,
      "cia402_state": "Ready to Switch On (default)",
      "cia402_statusword": "0x0021",
      "cia402_mode": null
    }
  ],
  "recent_sdo": [...],
  "recent_emcy": [...],
  "nmt_log": [...]
}
```

---

## Known Limitations

| Limitation | Detail |
|------------|--------|
| EDS required for PDO names | Without EDS, PDO payloads are raw hex. TPDO1 bytes 0-1 are decoded as Statusword by default (CiA 402 standard mapping assumption). |
| SDO segmented / block transfer | Only expedited SDO (1-4 byte payloads) is decoded and displayed. Segmented SDO responses show as raw data. |
| RxPDO decode | RPDO frames (from master to drive) are captured and typed. Signal decode requires EDS. |
| CANopen over CAN FD (CiA 1301) | Out of scope. Requires CAN FD hardware (minimum ~$53). |
| Node ID reassignment via LSS | LSS (Layer Setting Services) is not decoded. Node IDs are assumed fixed. |
| PDO mapping changes at runtime | If a node dynamically remaps its PDOs via SDO writes, CANviz will continue using the EDS-defined static mapping. |
| slcan error frame visibility | slcan firmware silently drops error frames before forwarding. EMCY events from the CANopen application layer still appear correctly. |
| CiA 402 state change validation | After writing a Controlword, CANviz updates the displayed state only when the next TPDO1 frame arrives with the new Statusword. There is no synchronous ACK -- use the SDO log to confirm the write was acknowledged by the node. |

---

## Troubleshooting

**Decoder is On but no nodes appear**
Heartbeat frames are required for node discovery. If the remote nodes have heartbeat
disabled (producer heartbeat time 0x1017 = 0), send an NMT command to trigger a
boot-up message, or manually read 0x1017 from each node. Any 11-bit CANopen frame
from the node (PDO, SDO, EMCY) will add it to the frame count, but the NMT State
column will show Unknown until a Heartbeat frame arrives.

**SDO read returns ABORT**
The node rejected the read request. Common abort codes:

| Code | Meaning |
|------|---------|
| 0x06020000 | Object does not exist in node's OD |
| 0x06090011 | Subindex does not exist |
| 0x08000021 | Object cannot be read in current state |
| 0x06010001 | Attempt to read write-only object |

**EDS upload fails**
Verify the EDS file is valid by opening it in a text editor and checking for `[FileInfo]`
and `[DeviceInfo]` sections at the top. DCF files follow the same format. The canopen
Python library (v2.4.1) parses EDS files directly -- parse errors are shown in the
upload response message.

**PDO signals not appearing in Plot tab after EDS upload**
The EDS must define PDO mapping objects (0x1A00 for TPDO1, 0x1A01 for TPDO2 etc.)
with DefaultValue entries for each sub-index. Check that your EDS has sections like:

```ini
[1A00]
...
[1A00sub0]
DefaultValue=0x03      <- number of mapped objects
[1A00sub1]
DefaultValue=0x60410010   <- Statusword at bytes 0-1
```

If the EDS only lists the objects without PDO mapping records, signals cannot be
extracted from raw PDO bytes.

**CiA 402 Drive Control buttons visible but node has no CiA 402 state**
The Drive Control panel appears for all discovered nodes, not only confirmed CiA 402
devices. You can send a Controlword to any node -- non-drive nodes will simply ABORT
the SDO if 0x6040 is not in their object dictionary. The abort will appear in the
SDO log.
