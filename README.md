# CANviz

**A browser-based CAN bus analyzer that works with any low cost hardware.**  
Plug in. Run one command. Analyze.

[![PyPI version](https://img.shields.io/pypi/v/canviz.svg)](https://pypi.org/project/canviz/)
[![PyPI downloads](https://img.shields.io/pypi/dm/canviz.svg)](https://pypi.org/project/canviz/)
[![Python](https://img.shields.io/pypi/pyversions/canviz.svg)](https://pypi.org/project/canviz/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

![CANviz demo](docs/demo.gif)

---

## Why CANviz?

Getting started with CAN bus analysis usually means one of two things:

- **Expensive commercial tools** : PEAK, Kvaser, Vector hardware bundles cost hundreds to thousands of dollars, and the software is tied to their ecosystem
- **Complex open source setups** : compiling from source, installing native desktop apps, managing dependencies

CANviz takes a different approach. It is a `pip install` away, runs entirely in your browser, and works with cheap commodity hardware that costs less than a meal.

```bash
pip install canviz
canviz
# → browser opens at http://localhost:8080
```

---

## What you get

**Live message table**  
Every frame on the bus, in real time. ID, DLC, raw bytes, frame count, update rate, last seen timestamp. Virtual scrolling handles thousands of rows without breaking a sweat : tested at 2,000 fps with zero frame loss.

**DBC signal decoding**  
Upload your `.dbc` file and raw hex bytes become named, human-readable signal values : right inline in the message table. Toggle between raw and decoded view at any time.

**Filtering**  
Filter by message ID (hex range) or signal name. Filter state persists in the URL so you can share an exact view with a colleague.

**Send frames**  
Craft and transmit CAN frames directly from the UI. Useful for testing ECU responses without writing any code.

**Record and replay**  
Record sessions to industry-standard `.asc` and `.csv` formats. Replay any log file back through the UI with adjustable speed (0.5× to 10×).

**Remote and SSH friendly**  
CANviz runs on a Raspberry Pi or any Linux machine and serves the dashboard over HTTP. Use SSH port forwarding to access the full UI in your local browser : no monitor needed on the remote machine.

**Developer friendly**  
Everything is accessible via REST API and WebSocket. Scriptable, automation-friendly, and works headlessly in CI pipelines using the virtual bus interface.

---

## Hardware

### Primary : plug and play on Windows

Any module running **Candlelight firmware** : most cheap CAN USB modules ship with this by default:

| Hardware | Price | Notes |
|----------|-------|-------|
| FYSETC UCAN (STM32F072) | ~$8 | Tested reference hardware |
| CANable 1.0 (Candlelight firmware) | ~$15 | Widely available |
| Any gs_usb compatible device | varies | : |

These appear in Windows Device Manager as `gs_usb / WinUSB` : **no COM port, no driver install, no reflashing needed.**

> If your device shows a COM port in Device Manager, it is running slcan firmware : see the [slcan quick start](#windows-slcan--com-port) below.

### Also supported

- **slcan** : devices running slcan firmware that enumerate as a COM port
- **SocketCAN** : Linux, Raspberry Pi, WSL2
- **PEAK PCAN-USB, Kvaser, Vector** : supported via python-can configuration, no code changes needed
- **Virtual bus** : software loopback for development and CI, no hardware required

---

## Quick Start

### Windows : gs_usb (Candlelight firmware)

```bash
pip install canviz
canviz
```

Auto-detects your connected device. Browser opens automatically.

### Windows : slcan / COM port

```bash
pip install canviz
canviz --interface slcan --channel COM3 --bitrate 500000
```

### Raspberry Pi / Linux

```bash
# One-time interface setup
sudo ip link set can0 up type can bitrate 500000

pip install canviz
canviz --interface socketcan --channel can0
```

### Remote machine over SSH

```bash
# From your laptop : forward port 8080 from the remote machine
ssh -L 8080:localhost:8080 user@remote-ip

# On the remote machine
canviz --interface socketcan --channel can0

# Open in your local browser
http://localhost:8080
```

### No hardware : virtual bus

```bash
pip install canviz
canviz --interface virtual
```

Frames loop back on themselves. Useful for exploring the UI or testing automation scripts without any hardware.

---

## CLI Reference

```
canviz [OPTIONS]

  --interface   gs_usb | slcan | socketcan | virtual  (default: gs_usb)
  --channel     COM port or SocketCAN channel  (e.g. COM3, can0)
  --bitrate     CAN bitrate in bps  (default: 500000)
  --host        Host to bind to  (default: 127.0.0.1)
  --port        Port to bind to  (default: 8080)
```

---

## Interface Reference

| Interface | Best for | Windows | Linux / Pi |
|-----------|----------|---------|------------|
| `gs_usb` | Candlelight firmware devices (default) | ✓ | ✓ |
| `slcan` | COM port devices | ✓ | ✓ |
| `socketcan` | Native SocketCAN | : | ✓ |
| `virtual` | Development, CI, no hardware | ✓ | ✓ |

---

## REST API & WebSocket

Full interactive docs at `http://localhost:8080/docs` while running.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/connect` | Open CAN interface |
| POST | `/disconnect` | Close interface |
| GET | `/status` | Connection state and config |
| POST | `/send` | Transmit a CAN frame |
| WS | `/ws/frames` | Live frame stream (JSON) |
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
[USB CAN Module]
    ↓
[Python Backend : FastAPI · python-can · cantools · aiofiles]
    ↓  WebSocket + REST
[Browser UI : React 18 · TanStack Table · TanStack Virtual · Zustand]
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
| PEAK PCAN-USB | pcan | Windows / Linux | Config only |
| Kvaser | kvaser | Windows / Linux | Config only |

**Throughput:** 2,000 fps sustained : zero frame loss, stable UI, no memory growth.

---

## Known Limitations

- **USB timestamp jitter ~1ms** : a general limitation of USB-connected CAN adapters, not specific to CANviz. Not suitable for sub-millisecond timing analysis.
- **Loads above 2,000 fps** : untested. A server-side throttling hook is built in and can be enabled if needed.
- **CAN FD** : frames with >8 byte payloads display as raw hex. Full CAN FD UI support is planned and requires CAN FD capable hardware.
- **Replay timing** : depends on the Python asyncio scheduler, not a wall clock.
- **Browser support** : tested on Chrome. Firefox and Edge are best-effort.
- **Mobile layout** : not a target for v1. Optimised for 1080p and above.

---

## Roadmap

- [x] **v1** : Live frame table, DBC decode, filter, send, record, replay, pip install
- [ ] **v2** : Signal time-series plotting
- [ ] **v3** : CAN FD support, UDS / OBD-II decoder, multi-channel

- See the [full project board](https://github.com/users/Chanchaldhiman/projects/1/views/1) 
for live status on what's being built.
---

## Other Tools Worth Knowing

CANviz is not the right tool for every situation.

**[SavvyCAN](https://github.com/collin80/SavvyCAN)** is a mature, feature-rich native desktop CAN analyzer with a large community and strong protocol support. If you prefer a native app with a long track record, SavvyCAN is an excellent choice.

**[python-can](https://github.com/hardbyte/python-can)** is the library CANviz is built on. Use it directly if you need scripting and automation without a UI.

**Commercial tools (PEAK, Kvaser, Vector)** are the right choice for production automotive development where support contracts, calibration, and regulatory traceability matter.

CANviz is designed for engineers and hobbyists who need a capable, low-friction analyzer for debugging, development, and learning : without the cost or complexity of commercial tooling.

---

## Contributing

CANviz is a young project and the hardware compatibility list is short. **The most useful thing you can do right now is test it with hardware we haven't tried** : a CANable 2.0, a PEAK PCAN-USB, anything on macOS, anything on a COM port. No code required. Just plug it in, try it, and open an issue telling us what happened.

If you find a bug, have a DBC file that decodes incorrectly, or want to write code : all of that is equally welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for specifics on what's most needed and how to get the dev environment running.

---

## License

MIT : see [LICENSE](LICENSE).
