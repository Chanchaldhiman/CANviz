# CANviz CLI & Headless Guide

CANviz has two modes of operation:

- **Browser UI** - `canviz serve` starts a local web server and opens your browser. This is the default.
- **CLI mode** - `canviz monitor`, `canviz capture`, and `canviz decode` run entirely in the terminal - no browser, no server. Designed for SSH sessions, Raspberry Pi, automated test benches, and shell pipelines.

---

![CANviz cli demo](cli.gif)

---

## Quick reference

| Command | What it does |
|---|---|
| `canviz` | Start the web server and open the browser (default) |
| `canviz serve --headless` | Start the API + WebSocket only - no browser opens |
| `canviz monitor` | Live frame table in the terminal |
| `canviz monitor --j1939` | Live frame table with PGN and SA columns for J1939 traffic |
| `canviz capture` | Record frames to a JSON file |
| `canviz decode` | Apply DBC signal decode to a captured file |
| `canviz j1939 status` | Show J1939 nodes, BAM log, and active faults from a running server |

---

## Interface options (shared across all commands)

Every command accepts the same interface flags:

| Flag | Default | Description |
|---|---|---|
| `--interface` | `gs_usb` | `gs_usb` · `slcan` · `socketcan` · `virtual` |
| `--channel` | _(empty)_ | Required for `slcan` (e.g. `COM3`) and `socketcan` (e.g. `can0`) |
| `--bitrate` | `500000` | CAN bus bitrate in bps |
| `--index` | `0` | gs_usb device index when multiple adapters are plugged in |

---

## `canviz serve` - Web server

This is the default command. Running `canviz` with no subcommand is identical to `canviz serve`.

```
canviz serve [OPTIONS]
```

**Start the server and open the browser (default):**
```
canviz serve --interface gs_usb
```

**Auto-connect on startup:**

When you pass `--interface` and `--channel`, CANviz automatically POSTs to `/connect` as soon as the server is ready. You land in the browser already live - no need to click Connect in the UI.

```bash
# slcan - connects and opens browser automatically
canviz serve --interface slcan --channel COM9 --bitrate 250000

# Same, also enables J1939 decoder immediately
canviz serve --interface slcan --channel COM9 --bitrate 250000 --j1939
```

Running bare `canviz` with no flags starts the server and opens the browser, but does **not** auto-connect - use the Connection panel in the UI to connect.

**Headless - API + WebSocket only, browser does not open:**
```bash
canviz serve --interface socketcan --channel can0 --bitrate 250000 --headless

# Headless + auto-connect + J1939 enabled (SSH / Pi workflow)
canviz serve --interface slcan --channel COM9 --bitrate 250000 --headless --j1939
```

Use `--headless` when running CANviz over SSH, in Docker, or as part of an automated pipeline where another process will consume the WebSocket stream. The full REST API and `/ws/frames` WebSocket are still available - only the `webbrowser.open()` call is skipped.

**Additional flags:**

| Flag | Default | Description |
|---|---|---|
| `--host` | `127.0.0.1` | Host to bind (use `0.0.0.0` to expose on the network) |
| `--port` | `8080` | Port to listen on |
| `--headless` | off | Skip opening a browser |
| `--j1939` | off | Auto-enable J1939 decoder after connecting |
| `--log-level` | `info` | `debug` · `info` · `warning` · `error` |

> **Tip - SSH users:** Run `canviz serve --headless` on the remote machine, then use SSH port forwarding to access the UI from your local browser:
> ```
> ssh -L 8080:localhost:8080 user@your-pi-ip
> ```
> Then open `http://localhost:8080` in your local browser.

---

## `canviz monitor` - Live terminal table

Watch live CAN frames directly in your terminal. No browser required.

```
canviz monitor [OPTIONS]
```

**Basic usage:**
```
canviz monitor --interface virtual
```

**Expected output:**
```
  Monitoring virtual @ 500000 bps - Ctrl+C to stop

 ID (hex)   Name              DLC   Data                      Count    Rate (fps)   Last seen
 ────────── ───────────────── ───── ──────────────────────── ──────── ──────────── ──────────
 000001A4   EngineData          8   FF 12 00 3C 00 00 00 00   4,821      100.0      0.01s
 000002B0   TransmissionData    8   01 00 64 00 00 00 00 00   4,820       99.9      0.01s
 000003C0   -                   4   AA BB CC DD               1,205       25.0      0.04s
```

Data bytes are **colour-coded on change:**
- Green - value increased since last frame
- Red - value decreased
- White - unchanged (stable signal)

**With a DBC file for signal names:**
```
canviz monitor --interface gs_usb --dbc vehicle.dbc
```

Signal names from the DBC appear in the `Name` column. Message IDs not in the DBC show `-`.

**Available flags:**

| Flag | Default | Description |
|---|---|---|
| `--dbc` | _(none)_ | Path to a `.dbc` file for signal name lookup |
| `--j1939` | off | Enable J1939 decode - adds PGN and SA columns. Use 250 kbps for trucks/agriculture. |
| `--refresh-rate` | `4.0` | Table refresh rate in Hz |

**J1939 mode:**

```
canviz monitor --interface slcan --channel COM3 --bitrate 250000 --j1939
```

Adds **PGN** and **SA** (Source Address) columns to the live table. Each row shows the Parameter Group Number, its human-readable name, and the ECU that sent it. Works standalone over SSH - no browser or server needed.

```
  Monitoring slcan COM3 @ 250000 bps [J1939] - Ctrl+C to stop

 ID (hex)    Name   PGN       PGN Name                       SA                DLC   Data                      Count
 ─────────── ────── ───────── ────────────────────────────── ───────────────── ───── ──────────────────────────────
 18F00400    -      0xF004    EEC1 - Engine Speed / Torque   0x00 Engine #1    8     F0 4F 4F FB 14 FF F0 FF   2,277
 18FEF100    -      0xFEF1    CCVS - Cruise Control / Ve…    0x00 Engine #1    8     F1 1C 5D FF FF FF FF FF     459
 18FECA00    -      0xFECA    DM1 - Active Diagnostic Tr…    0x00 Engine #1    8     04 00 64 00 08 06 FF FF       5
```

**Pipe mode (non-TTY):**

When stdout is not a terminal (piped to another command), `canviz monitor` automatically switches to plain JSON lines - one object per frame, no Rich formatting or escape codes:

```
canviz monitor --interface virtual | grep "000001A4"
```
```json
{"ts": 1.234567, "id": "000001A4", "dlc": 8, "data": "FF 12 00 3C 00 00 00 00", "name": "EngineData"}
{"ts": 1.244891, "id": "000001A4", "dlc": 8, "data": "FF 13 00 3C 00 00 00 00", "name": "EngineData"}
```

With `--j1939`, each JSON line also includes `pgn`, `pgn_name`, `sa`, and `sa_name` fields:

```
canviz monitor --interface slcan --channel COM3 --bitrate 250000 --j1939 | jq .
```
```json
{"ts": 1.234567, "id": "18F00400", "dlc": 8, "data": "F0 4F 4F FB 14 FF F0 FF",
 "name": "", "pgn": "0xF004", "pgn_name": "EEC1 - Engine Speed / Torque",
 "sa": "0x00", "sa_name": "Engine #1"}
```

Filter by source address or PGN:
```bash
# Show only Engine #1 traffic
canviz monitor --interface socketcan --channel can0 --bitrate 250000 --j1939 \
  | jq 'select(.sa == "0x00")'

# Show only DM1 active fault frames
canviz monitor --interface socketcan --channel can0 --bitrate 250000 --j1939 \
  | jq 'select(.pgn == "0xFECA")'
```

Pipe it to `jq` for structured filtering (standard traffic):
```
canviz monitor --interface socketcan --channel can0 | jq 'select(.id == "000001A4")'
```

**Stop:** `Ctrl+C` - prints a summary of unique IDs and total frames seen.

---

## `canviz capture` - Record frames to a file

Record all frames on the bus to a JSON file for offline analysis or replay.

```
canviz capture [OPTIONS]
```

**Capture for 60 seconds then stop automatically:**
```
canviz capture --interface gs_usb --duration 60 --output my_trace.json
```

**Capture until Ctrl+C (no duration limit):**
```
canviz capture --interface socketcan --channel can0 --output run1.json
```

**Expected output while capturing:**
```
  Capturing → my_trace.json  (max 60s) - Ctrl+C to stop
     12,483 frames  14.2s / 60s
```

**After capture completes:**
```
  Saved 51,200 frames → my_trace.json (3,840 KB)
```

**Available flags:**

| Flag | Default | Description |
|---|---|---|
| `--output` / `-o` | `canviz_YYYYMMDD_HHMMSS.json` | Output file path |
| `--duration` / `-d` | _(none - run until Ctrl+C)_ | Capture duration in seconds |

**Output file format:**

The JSON file contains a `meta` block and a `frames` array:

```json
{
  "meta": {
    "interface": "gs_usb",
    "channel": "",
    "bitrate": 500000,
    "captured_at": "2026-04-22T14:32:01.123456",
    "duration_s": 60.012,
    "frame_count": 51200
  },
  "frames": [
    {
      "ts": 0.000123,
      "id": 420,
      "id_hex": "000001A4",
      "dlc": 8,
      "data": [255, 18, 0, 60, 0, 0, 0, 0],
      "is_extended_id": false,
      "is_error_frame": false,
      "is_fd": false
    }
  ]
}
```

---

## `canviz decode` - Apply DBC signal decode to a captured file

Takes a `.json` capture file and a DBC, decodes every frame, and writes the result to a file or stdout.

```
canviz decode --input trace.json --dbc vehicle.dbc [OPTIONS]
```

### Save decoded output to a file

**JSON output (default):**
```
canviz decode --input my_trace.json --dbc vehicle.dbc --output decoded.json
```

**CSV output (one row per signal per frame - opens directly in Excel):**
```
canviz decode --input my_trace.json --dbc vehicle.dbc --format csv --output signals.csv
```

**Expected terminal output:**
```
  Saved 51,200 frames (48,930 decoded) → decoded.json (12 KB)
```

Frames with IDs not in the DBC are included in the output with empty signal fields - they are not silently dropped.

### CSV format

The CSV has one row per signal per frame:

```csv
ts,id_hex,message,signal,value
0.000123,000001A4,EngineData,EngineRPM,820.0
0.000123,000001A4,EngineData,CoolantTemp,87.5
0.010241,000001A4,EngineData,EngineRPM,824.0
0.010241,000001A4,EngineData,CoolantTemp,87.5
```

This format loads directly into Excel, pandas, or any data tool without further transformation.

**Load in pandas:**
```python
import pandas as pd
df = pd.read_csv("signals.csv")
rpm = df[df["signal"] == "EngineRPM"]
print(rpm["value"].describe())
```

### Pipe to shell tools (stdout mode)

Omit `--output` to write to stdout - useful for filtering or chaining:

```
# Show only signals from one message ID
canviz decode --input trace.json --dbc vehicle.dbc | jq '.[] | select(.id_hex == "000001A4")'

# Get just signal names and values
canviz decode --input trace.json --dbc vehicle.dbc | jq '.[] | .signals'

# CSV to grep
canviz decode --input trace.json --dbc vehicle.dbc --format csv | grep EngineRPM
```

**Available flags:**

| Flag | Default | Description |
|---|---|---|
| `--input` / `-i` | _(required)_ | `.json` file from `canviz capture` |
| `--dbc` | _(required)_ | DBC file for signal decoding |
| `--format` / `-f` | `json` | `json` or `csv` |
| `--output` / `-o` | _(stdout)_ | Output file. Omit to write to stdout. |

---

## `canviz j1939` - J1939 decoder commands

Inspect J1939 decoder state from the command line. Requires `canviz serve` to be running.

### `canviz j1939 status`

Prints the full J1939 picture from a running CANviz server - decoder mode, PGN database size, live nodes table, BAM log, and active DM1 fault codes.

```
canviz j1939 status [--host 127.0.0.1] [--port 8080]
```

**Example output:**

```
  J1939 Decoder  ON

  Database: 54 PGNs · 101 SA names · 11 SPNs (pretty_j1939)

  Nodes (2)
 ──────────────────────────────────────────────────────────
  SA       Name             Frames    Last seen
  0x00     Engine #1        2,647     just now
  0x10     Trip Recorder       81     just now

  BAM Log (1 reassembled)
 ──────────────────────────────────────────────────────────
  PGN      Name                    Bytes  Payload (hex)
  0xFEEC   VI - Vehicle Identif…    37    31 48 47 43 4D 38 32 36…

  DM1 Active Faults (1)
 ──────────────────────────────────────────────────────────
  SPN   Component              FMI                          OC   Lamps
  100   Engine Oil Pressure    1 - Below normal operating    3   Amber Warn
```

**Available flags:**

| Flag | Default | Description |
|---|---|---|
| `--host` | `127.0.0.1` | Host where `canviz serve` is running |
| `--port` | `8080` | Port where `canviz serve` is listening |

**Typical SSH workflow:**

```bash
# On the remote machine
canviz serve --interface socketcan --channel can0 --bitrate 250000 --headless &

# From your laptop (SSH tunnel already open)
canviz j1939 status --host 127.0.0.1 --port 8080
```

---

## Common workflows

### Monitor a J1939 truck/agriculture bus over SSH

```bash
# On the remote machine (Pi or embedded Linux)
sudo ip link set can0 up type can bitrate 250000
canviz monitor --interface socketcan --channel can0 --j1939
```

Adds PGN and SA columns directly in the SSH terminal. No browser or port forwarding needed.

### Inspect J1939 faults headlessly

```bash
# Start server on remote machine - auto-connects and enables J1939
canviz serve --interface socketcan --channel can0 --bitrate 250000 --headless --j1939 &

# From your laptop - check fault codes
canviz j1939 status
```

### Capture J1939 traffic and filter by PGN offline

```bash
# Capture raw frames (is_extended_id is preserved in the file)
canviz capture --interface slcan --channel COM3 --bitrate 250000 --duration 60 --output j1939_trace.json

# Pipe monitor output to capture only DM1 frames
canviz monitor --interface slcan --channel COM3 --bitrate 250000 --j1939 \
  | jq 'select(.pgn == "0xFECA")' > dm1_events.jsonl
```

### SSH into a Raspberry Pi and monitor live

On the Pi:
```
pip install canviz
sudo ip link set can0 up type can bitrate 500000
canviz monitor --interface socketcan --channel can0 --dbc vehicle.dbc
```

### Run the API headless on a Pi, view UI on your laptop

On the Pi:
```
canviz serve --interface socketcan --channel can0 --headless
```

On your laptop (in a separate terminal):
```
ssh -L 8080:localhost:8080 user@pi-ip-address
```

Then open `http://localhost:8080` in your browser.

### Capture, decode, and analyse offline

```bash
# Step 1 - capture 2 minutes of data
canviz capture --interface gs_usb --duration 120 --output drive_cycle.json

# Step 2 - decode to CSV
canviz decode --input drive_cycle.json --dbc vehicle.dbc --format csv --output drive_cycle.csv

# Step 3 - open drive_cycle.csv in Excel, or load with pandas
```

### Automated test bench - CI/CD

```bash
# Start headless server with virtual bus - auto-connects immediately
canviz serve --interface virtual --headless &
SERVER_PID=$!
sleep 2

# Your test script hits the REST API or WebSocket
python run_tests.py

kill $SERVER_PID
```

---

## Shell autocomplete

CANviz uses Typer, which generates shell completion scripts automatically.

**bash:**
```
canviz --install-completion bash
source ~/.bashrc
```

**zsh:**
```
canviz --install-completion zsh
source ~/.zshrc
```

**fish:**
```
canviz --install-completion fish
```

After installing, press `Tab` after `canviz` to see subcommands, and `Tab` again after `--interface` to see valid options.

---

## Limitations

- `canviz monitor` shows per-ID rate and last-seen - it does not decode individual signal values in the table. Load the DBC in the browser UI for per-signal detail, or use `canviz capture` + `canviz decode` for offline analysis.
- `canviz monitor --j1939` decodes PGN names and SA addresses but does not decode signal values (RPM, speed, temperature) inside each message. For full signal decode load a J1939 DBC file in the browser UI or use `canviz decode` with a J1939-compatible DBC.
- `canviz j1939 status` requires `canviz serve` to be running - it queries the server's REST API. It does not work standalone without a server.
- `canviz capture` stores raw bytes only. Signal decoding happens in the `decode` step, not at capture time - this keeps the capture loop fast and the capture file format stable even if the DBC changes.
- `canviz serve` auto-connects when `--interface` and `--channel` are provided. Running bare `canviz` (no flags) opens the browser only - use the Connection panel to connect manually.
- `canviz monitor` colour coding is based on byte sum delta - it is a heuristic to show "something changed", not a precise signal-level diff. Use the browser UI for signal-level detail.
