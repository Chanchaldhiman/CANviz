# CANviz

**A browser-based CAN bus analyzer. Plug in. One command. Analyze.**

[![PyPI version](https://img.shields.io/pypi/v/canviz.svg)](https://pypi.org/project/canviz/)
[![Total Downloads](https://img.shields.io/pepy/dt/canviz?label=total%20downloads)](https://pepy.tech/project/canviz)
[![Monthly Downloads](https://static.pepy.tech/badge/canviz/month)](https://pepy.tech/project/canviz)
[![Python](https://img.shields.io/pypi/pyversions/canviz.svg)](https://pypi.org/project/canviz/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/Chanchaldhiman/CANviz?style=social)](https://github.com/Chanchaldhiman/CANviz)

```bash
pip install canviz
canviz
# → browser opens at http://localhost:8080
```

![CANviz demo](https://github.com/Chanchaldhiman/CANviz/blob/main/docs/demo.gif)

CANviz works with any Candlelight-firmware USB CAN adapter (~$8). No GUI install,
no driver setup, no account, no internet connection required. It runs entirely in
your browser at `localhost` - whether you are an embedded engineer debugging an ECU,
a researcher studying automotive protocols, or a hobbyist on your first CAN project.

It is designed to complement the excellent tools that already exist.
[SavvyCAN](https://github.com/collin80/SavvyCAN) is a mature native desktop analyzer
with a strong community - if you prefer a native app with a long track record, it is
an excellent choice. [python-can](https://github.com/hardbyte/python-can) is the library
CANviz is built on and is invaluable for scripting and automation. CANviz takes a
different approach: browser-first, pip-installable, and SSH-friendly for engineers
working on remote and headless setups.

---
## What's New
 
### v0.2.3 
 
**New hardware support**
- Added **GY / Seeed Studio USB-CAN Analyzer** (`seeedstudio` interface) - the cheap
  USB CAN adapter widely sold on Amazon and AliExpress using the `0xAA`/`0x55` binary
  protocol. Select `USB-CAN Analyzer (GY/Seeed)` in the interface dropdown, enter your
  COM port, and connect. No baud rate configuration needed.
**slcan improvements**
- Added **Serial Baud Rate** selector in the UI for slcan devices. The USB-serial link
  speed is now configurable (up to 2000000) - previously hardcoded to
  115200, which caused no frames to appear on newer slcan adapters that use 2000000.
- Added `--serial-baudrate` flag to `canviz monitor` and `canviz capture` CLI subcommands.
- Added 5-second no-frame warning in the backend log with actionable hints when slcan
  is connected but silent.
**Bug fixes**
- Fixed `The serial module is not installed` error - `pyserial` is now a declared
  dependency and installs automatically with `pip install canviz`.
- Fixed sent frames not appearing in the message table on seeedstudio and slcan
  interfaces. Previously only gs_usb (Candlelight) showed sent frames because it
  echoes them back through hardware loopback. Non-loopback interfaces now echo sent
  frames in software.
- Fixed `AttributeError` on first connect (`self._open_serial_baudrate` not
  initialised in `BusManager.__init__`).
---

## Quick Start

### Windows - gs_usb (Candlelight firmware)
```bash
pip install canviz
canviz
```
Auto-detects your connected device. Browser opens automatically.

### Windows - slcan / COM port
```bash
canviz --interface slcan --channel COM3 --bitrate 500000
```

### Raspberry Pi / Linux
```bash
sudo ip link set can0 up type can bitrate 500000
canviz --interface socketcan --channel can0
```

### Remote machine over SSH
```bash
# On your laptop - forward port 8080 from the remote machine
ssh -L 8080:localhost:8080 user@remote-ip

# On the remote machine
canviz --interface socketcan --channel can0

# Open in your local browser
http://localhost:8080
```

### Headless / no browser
```bash
canviz serve --headless --port 8080
```

### No hardware - virtual bus
```bash
canviz --interface virtual
```

> **If your device shows a COM port** in Device Manager, it is running slcan firmware -
> use the slcan quick start above. Candlelight devices enumerate as `gs_usb / WinUSB`
> with no COM port.

---

## Features

### Live message table
Every frame on the bus, in real time. ID, DLC, raw bytes, frame count, update rate,
last seen timestamp. Virtual scrolling handles thousands of rows without frame loss.
Tested at 2,000 fps sustained with zero drops.

### DBC signal decoding
Upload your `.dbc` file and raw hex bytes become named signal values - inline in the
message table. Toggle between raw and decoded view at any time.

### Signal time-series plotting *(new in v0.2.0)*
Plot any DBC-decoded signal as a live time-series graph. Select up to 8 signals
simultaneously on a shared time axis. Built on [uPlot](https://github.com/leeoniya/uPlot)
- handles 36,000 buffered points per signal with LTTB downsampling, rendering at a
smooth 10 Hz regardless of bus rate.

- **Adjustable time window** - 10s, 30s, 1m, 5m, 30m
- **Zoom and pan** - drag to zoom, double-click to resume live scroll
- **Threshold lines** - set a limit per signal; line and pill border turn red on breach
- **Multi-signal overlay** - compare RPM, throttle, and vehicle speed on one axis
- **PNG export** - one click, includes signal legend and axis labels

### Bus health statistics *(new in v0.2.0)*
Always-visible status bar showing frames Rx/Tx, bus load %, error frame count,
bus-off events, and KB/s throughput. Error frame visibility depends on hardware -
slcan devices typically drop error frames silently; a tooltip explains this when
a slcan interface is active.

### Multi-frame transmit with timers *(new in v0.2.0)*
Build a list of frames, each with its own independent transmission interval.
Send a heartbeat at 20 Hz and a speed signal at 10 Hz simultaneously.
Each row has its own start/stop control. State persists across tab switches.

### CLI and headless mode *(new in v0.2.0)*
`canviz monitor` renders a live colour-coded table in the terminal - works over SSH,
in CI pipelines, and on headless Raspberry Pi setups. See the
[CLI Reference](#cli-reference) below for all subcommands.

### Record and replay
Record sessions to industry-standard `.asc` and `.csv` formats. Replay any log file
with adjustable speed (0.5× to 10×).

### Filtering
Filter by message ID (hex range) or signal name. Filter state persists in the URL
so you can share an exact view with a colleague.

---

## Hardware

Any module running **Candlelight firmware** works plug-and-play on Windows:

| Hardware | Price | Notes |
|----------|-------|-------|
| FYSETC UCAN (STM32F072) | ~$8 | Validated reference hardware |
| CANable 1.0 (Candlelight firmware) | ~$15 | Widely available |
| Any gs_usb / WinUSB compatible device | varies | Should work |

**Also supported via python-can configuration:**
- **slcan** - devices running slcan firmware (COM port)
- **SocketCAN** - Linux, Raspberry Pi, WSL2
- **PEAK PCAN-USB, Kvaser** - via python-can config, no code changes needed
- **Virtual bus** - software loopback, no hardware needed

---

## Security Model

CANviz does not use WebUSB or any browser-level hardware access API.

```
Browser  (your local browser tab)
    ↕  HTTP + WebSocket - localhost only, never leaves your machine
Python backend  (127.0.0.1:8080)
    ↕  python-can
USB CAN adapter
    ↕
CAN Bus
```

The browser communicates only with a local Python process at `127.0.0.1:8080`.
No data leaves your machine. No cloud. No telemetry. No external connections of any kind.
All USB communication happens inside the Python backend - the browser never has
direct access to your USB device or CAN bus.

The security model is the same as running any locally installed Python tool:
you are trusting the code you installed via `pip`. If you are security-conscious,
review the source on GitHub before installing.

**Remote deployments:** Use the default `--host 127.0.0.1` binding and access via
SSH port forwarding. Do not expose port 8080 to an untrusted network without additional
controls such as a reverse proxy with authentication.

---

## CLI Reference

```
canviz [OPTIONS]

  --interface   gs_usb | slcan | socketcan | virtual  (default: gs_usb)
  --channel     COM port or SocketCAN channel  (e.g. COM3, can0)
  --bitrate     CAN bitrate in bps  (default: 500000)
  --host        Host to bind to  (default: 127.0.0.1)
  --port        Port to bind to  (default: 8080)
  --headless    Start without opening a browser
```

**Subcommands:**
```bash
# Live terminal monitor - works over SSH
canviz monitor --interface socketcan --channel can0 --dbc vehicle.dbc

# Capture frames to file
canviz capture --output trace.json --duration 60

# Decode a captured log
canviz decode --input trace.json --dbc vehicle.dbc --output decoded.csv

# API-only server, no browser
canviz serve --headless --port 8080
```

See the **[CLI Guide](https://github.com/Chanchaldhiman/CANviz/blob/main/docs/cli.md)** for full SSH workflow documentation.

---

## REST API & WebSocket

Full interactive docs at `http://localhost:8080/docs` while running.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/connect` | Open CAN interface |
| POST | `/disconnect` | Close interface |
| GET | `/status` | Connection state and config |
| GET | `/stats` | Bus statistics snapshot |
| POST | `/send` | Transmit a CAN frame |
| WS | `/ws/frames` | Live frame + stats stream (JSON) |
| POST | `/dbc/load` | Upload a DBC file |
| GET | `/dbc/messages` | List decoded message definitions |
| DELETE | `/dbc` | Unload DBC |
| POST | `/log/start` | Start recording |
| POST | `/log/stop` | Stop and finalise log |
| GET | `/log/download/{file}` | Download `.asc` or `.csv` |
| POST | `/replay/start` | Start replaying a log file |
| POST | `/replay/stop` | Stop replay |

---

## Architecture

```
[CAN Bus]
    ↓
[USB CAN Module]  ~$8–$65 depending on capability
    ↓
[Python Backend]
  FastAPI · python-can · cantools · aiofiles · typer · rich
    ↓  HTTP + WebSocket (localhost only - no external connections)
[Browser UI]
  React 18 · TanStack Table · TanStack Virtual · Zustand · uPlot
    ↓
  http://localhost:8080
```

---

## Validated Hardware & Performance

| Hardware | Interface | OS | Status |
|----------|-----------|-----|--------|
| FYSETC UCAN (STM32F072, Candlelight) | gs_usb | Windows 11 | ✅ Tested |
| FYSETC UCAN (STM32F072, Candlelight) | gs_usb | Raspberry Pi OS | ✅ Tested |
| Virtual bus | virtual | Windows / Linux | ✅ Tested |
| PEAK PCAN-USB | pcan | Windows / Linux | ✅ Tested |
| Kvaser | kvaser | Windows / Linux | Blocked - see Known Limitations |

**Throughput:** 2,000 fps sustained - zero frame loss, stable UI, no memory growth.

---

## Known Limitations

- **USB timestamp jitter ~1 ms** - a hardware limitation of USB-connected CAN adapters.
  Not suitable for sub-millisecond timing analysis.
- **Bus load above 2,000 fps** - untested. A server-side throttling hook is built in
  and can be enabled if needed.
- **CAN FD** - frames with >8 byte payloads display as raw hex. Full CAN FD UI
  support is in progress.
- **Kvaser on Windows** - CANviz has full UI support for Kvaser hardware. However,
  connecting fails due to multiple `canIoCtlInit` calls returning `canERR_PARAM (-1)`
  in python-can 4.6.1 on Windows. This is a python-can bug tracked at
  [python-can #2051](https://github.com/hardbyte/python-can/issues/2051). No CANviz
  code change is needed - once the upstream fix releases, upgrade python-can and
  Kvaser will work without any other changes.
- **slcan error frames** - slcan firmware on most adapters silently drops error frames
  before forwarding to the host. Bus error statistics will read 0% on slcan interfaces
  even on a degraded bus. Use gs_usb (Candlelight) for accurate error visibility.
- **Replay timing** - depends on the Python asyncio scheduler, not a wall clock.
- **Browser support** - tested on Chrome. Firefox and Edge are best-effort.
- **Mobile layout** - not a target for v1. Optimised for 1080p and above.

---

## Roadmap

- [x] **v1** - Live frame table, DBC decode, filter, send, record, replay, pip install
- [x] **v2** - Signal plotting, multi-signal overlay, threshold alerts, CLI mode,
              bus health statistics, multi-frame transmit with timers
- [ ] **v3** - CAN FD UI, J1939 decoder, OBD-II over raw CAN, UDS diagnostics,
              CANopen (CiA 301 + CiA 402), reverse engineering toolkit, plugin API

See the [full project board](https://github.com/users/Chanchaldhiman/projects/1/views/1)
for live status.

---

## Troubleshooting

**`No matching distribution found for canviz` on Ubuntu/Linux**
Use `pip3 install canviz` or `python3 -m pip install canviz`. CANviz requires Python 3.10+.
Ubuntu 20.04 ships Python 3.8 - upgrade to 22.04+ or install Python 3.10 separately.

**Kvaser device fails to connect (`canIoCtl failed - Error in parameter`)**
Known bug in python-can 4.6.1, not a CANviz issue. Tracked at
[python-can #2051](https://github.com/hardbyte/python-can/issues/2051).
Upgrade python-can once the issue is resolved and Kvaser will connect without any
other changes.

**PEAK PCAN-USB fails to connect**
Ensure the [PEAK driver](https://www.peak-system.com/Drivers.523.0.html) is installed.
Device Manager must show the device under **CAN-Hardware**, not as an unknown device.

**Device shows a COM port on Windows**
Your adapter is running slcan firmware, not Candlelight.
Use: `canviz --interface slcan --channel COM3`

---

## Contributing

CANviz is actively developed. **The most useful contribution right now is testing
hardware we have not tried** - a CANable 2.0, anything on macOS, anything on a COM
port. No code required. Open an issue and tell us what happened.

Bug reports, DBC files that decode incorrectly, and code contributions are all welcome.
See [CONTRIBUTING.md](https://github.com/Chanchaldhiman/CANviz/blob/main/CONTRIBUTING.md) for how to get the dev environment running.

---

## License

MIT - see [LICENSE](https://github.com/Chanchaldhiman/CANviz/blob/main/LICENSE).