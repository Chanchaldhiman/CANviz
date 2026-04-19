# CANviz

**Open-source, browser-based CAN bus analyzer.**  
Works with cheap (~$10) USB-C CAN modules. No GUI install. Just `pip install` and open a browser.

```bash
pip install canviz
canviz --interface gs_usb
# → browser opens at http://localhost:8080
```

---

## What it does

CANviz is a web-based CAN bus analyzer that runs entirely in your browser. You plug in a USB CAN module, run one command, and get a live view of your CAN bus, no desktop app to install, no compiling from source.

**v1 features:**
- Live message table: ID, DLC, data bytes, frame count, rate (fps), last seen
- DBC file support: upload a `.dbc` file and see decoded signal values inline
- Filter by message ID or signal name
- Send CAN frames manually from the UI
- Record sessions to `.asc` and `.csv`
- Replay recorded log files with speed control
- REST API + WebSocket - scriptable and automation-friendly

---

## Hardware

**Primary (plug and play on Windows):**  
Any CAN module running **Candlelight firmware** - including the FYSETC UCAN (STM32F072, ~$8).  
These show up in Windows Device Manager as `gs_usb` / WinUSB - **no COM port, no reflash needed.**

**Also supported:**
- slcan devices (COM port) - CANable and others running slcan firmware
- SocketCAN - Linux, Raspberry Pi, WSL2
- PEAK PCAN-USB, Kvaser, Vector - via python-can config
- Virtual bus - for development and CI (no hardware needed)

---

## Quick Start

### Windows (Candlelight / gs_usb device)

```bash
pip install canviz
canviz
```

Auto-detects the connected gs_usb device. Browser opens at `http://localhost:8080`.

### Windows (slcan / COM port device)

```bash
pip install canviz
canviz --interface slcan --channel COM3 --bitrate 500000
```

### Raspberry Pi / Linux (SocketCAN)

```bash
# One-time setup
sudo ip link set can0 up type can bitrate 500000

pip install canviz
canviz --interface socketcan --channel can0
```

### No hardware (virtual bus)

```bash
pip install canviz
canviz --interface virtual
```

Frames loop back on themselves. Useful for testing and development.

---

## Interface Notes

| Interface | When to use | Windows | Linux |
|-----------|-------------|---------|-------|
| `gs_usb` | Candlelight firmware devices (default) | ✓ | ✓ |
| `slcan` | Devices that enumerate as a COM port | ✓ | ✓ |
| `socketcan` | Native SocketCAN | - | ✓ |
| `virtual` | No hardware, development/CI | ✓ | ✓ |

**Candlelight vs slcan:** If your device shows up as a COM port in Device Manager, use `--interface slcan --channel COMx`. If it shows as `gs_usb` / WinUSB with no COM port, use `--interface gs_usb` (the default).

---

## CLI Reference

```
canviz [OPTIONS]

Options:
  --interface   gs_usb | slcan | socketcan | virtual  (default: gs_usb)
  --channel     COM port or SocketCAN channel (e.g. COM3, can0)
  --bitrate     CAN bitrate in bps (default: 500000)
  --host        Host to bind to (default: 127.0.0.1)
  --port        Port to bind to (default: 8080)
```

---

## API

The backend exposes a REST API and WebSocket. Useful for scripting and automation.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/connect` | Open CAN interface |
| POST | `/disconnect` | Close interface |
| GET | `/status` | Connection state |
| POST | `/send` | Transmit a frame |
| WS | `/ws/frames` | Live frame stream (JSON) |
| POST | `/dbc/load` | Upload DBC file |
| GET | `/dbc/messages` | List decoded messages |
| DELETE | `/dbc` | Unload DBC |
| POST | `/log/start` | Start recording |
| POST | `/log/stop` | Stop recording |
| GET | `/log/download/{file}` | Download log file |
| POST | `/replay/start` | Start log replay |
| POST | `/replay/stop` | Stop replay |

Full interactive API docs available at `http://localhost:8080/docs` when running.

---

## Known Limitations

- USB timestamp jitter ~1ms - not suitable for sub-millisecond timing analysis
- High bus loads (>5000 fps) may require server-side throttling (planned for a future release)
- Tested on Chrome; Firefox and Edge are best-effort
- CAN FD (>8 byte payloads) display support is planned for a future release
- Replay timing accuracy depends on the asyncio scheduler - not wall-clock perfect at high bus loads

---

## Stack

**Backend:** Python 3.10+ · FastAPI · python-can · cantools · aiofiles  
**Frontend:** React 18 · TanStack Table · Zustand · Vite  
**Supported OS:** Windows 10/11 · Linux · Raspberry Pi OS · macOS (best-effort)

---

## License

MIT