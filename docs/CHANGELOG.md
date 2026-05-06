# Changelog

All notable changes to CANviz are documented here.
Versions follow [Semantic Versioning](https://semver.org/).

---

## v0.3.2 -- CANopen CiA 301 + CiA 402

**CANopen decoder** -- passive protocol intelligence for robotics, industrial
automation, and motion control.

### Added
- Auto-detection of CANopen traffic from COB-ID structure
- Nodes table -- NMT state, heartbeat interval, frame count per discovered node
- CiA 402 drive state decoded from Statusword per node (Operation Enabled, Fault, Quick Stop etc.)
- CiA 402 Drive Control panel -- quick Controlword buttons (Enable, Switch On, Shutdown, Quick Stop, Disable, Fault Reset) with one-time safety notice
- EMCY decode -- error code, error class name, error register flags, manufacturer data
- SDO log -- request/response pairs auto-paired from bus traffic with names from 180-entry built-in CiA 301/402 object dictionary
- SDO Read and SDO Write -- send expedited reads and writes to live nodes from the panel
- NMT commands -- Operational, Pre-Op, Stop, Reset Node, Reset Comm with node selector and confirm step
- Object dictionary browser -- search 180 standard CiA 301/402 objects by name or index
- EDS / DCF file upload -- enables named PDO signal decode and PDO signals in Plot tab
- PDO signal plotting -- TPDO payloads decoded to named signals, fed into the existing plot store
- Read All Node Objects -- one click reads 15 standard objects from every discovered node
- Right panel layout -- protocol decoders (CANopen, J1939) moved to a dedicated full-height resizable right panel; bottom panel keeps 4 tool tabs (Send Frame, Record, Replay, Plot)
- Message table: Type, Node, Protocol Info columns when decoder active; EMCY and SDO badges per row
- REST endpoints: `/canopen/status`, `/canopen/mode`, `/canopen/reset`, `/canopen/eds`, `/canopen/sdo/read`, `/canopen/sdo/write`, `/canopen/nmt`, `/canopen/objects`, `/canopen/export`

### Fixed
- `ValueError: Unknown format code 'X' for object of type 'str'` in `full_status()` when CiA 402 default statusword was stored as formatted string instead of int
- `bus.py` log format string had 4 specifiers but 3 arguments -- crashed on every slcan connection

### Changed
- Version bumped to 0.3.2
- `pyproject.toml` description updated to mention protocol decoders

---

## v0.3.0 -- J1939 Passive Decoder

**J1939 passive decoder** -- zero-config protocol intelligence for trucks,
agriculture, and marine networks.

### Added
- Auto-detection of 29-bit extended-ID traffic at 250 kbps
- CAN ID decomposition: Priority, PGN, Source Address, Destination Address on every frame
- 54 built-in PGN name definitions (EEC1, CCVS, DM1, ET1, AMB, VEP1, TP.CM/DT and more)
- 99 source address names (ECU names per SAE J1939/81)
- BAM transport protocol reassembly -- multi-packet messages shown complete
- DM1 active fault decode -- SPN, component name, Failure Mode Indicator, occurrence count, lamp status
- Message table columns: PGN, PGN Name, SA, DA when decoder enabled
- BAM CM, BAM DT, and DM1 badges per message table row
- Light / dark theme toggle in top bar, persists across sessions
- J1939 decoder panel in bottom tab strip
- REST endpoints: `/j1939/status`, `/j1939/mode`

---

## v0.2.4 -- Hardware Support and Bug Fixes

### Added
- GY / Seeed Studio USB-CAN Analyzer support (`seeedstudio` interface) -- the `0xAA/0x55` binary protocol adapter widely sold on Amazon and AliExpress

### Fixed
- `The serial module is not installed` error -- `pyserial` added as declared dependency
- Sent frames not appearing in message table on seeedstudio and slcan interfaces -- non-loopback interfaces now echo sent frames in software
- `AttributeError` on first connect -- `self._open_serial_baudrate` not initialised in `BusManager.__init__`

---

## v0.2.0 -- Signal Plotting, CLI Mode, Bus Health

### Added
- Signal time-series plotting (uPlot) -- up to 8 signals on shared time axis, LTTB downsampling, 10 Hz render
- Adjustable time window (10s, 30s, 1m, 5m, 30m), zoom/pan, per-signal threshold lines with breach alerts, PNG export
- Always-visible bus health status bar -- frames Rx/Tx, bus load %, error frame count, bus-off events, throughput
- Multi-frame transmit with per-frame independent interval timers
- `canviz monitor` -- Rich live table in terminal, 4 Hz refresh, colour-coded by change direction
- `canviz serve --headless` -- FastAPI + WebSocket, no browser launch
- `canviz decode` -- reads log, outputs JSON or CSV to stdout
- `--no-browser` flag on default serve command
- Shell autocomplete for bash/zsh/fish via Typer
- COOP/COEP headers on FastAPI (`CrossOriginIsolationMiddleware`) for SharedArrayBuffer
- SendFramePanel rewrite -- multiple frame rows, per-frame interval timers, state survives tab switches
- DBC panel ID formatting fix -- backend returned hex string, frontend was prepending `0x` twice

### Fixed
- typer `[all]` extra removed in typer 0.12.1 -- changed to `typer>=0.12`
- Removed separate `rich>=13` dependency (now bundled with typer)

---

## v0.1.x -- Core Release

- PyPI package `canviz` -- `pip install canviz` published
- Package rename `canvaz` to `canviz` (original name was taken)
- Frontend static build bundled as package data
- Windows hardware validation -- FYSETC UCAN plug-and-play confirmed
- Raspberry Pi validation -- socketcan interface confirmed
- SSH port forwarding workflow confirmed for remote Pi use
- Performance baseline -- 2,000 fps sustained, zero frame loss
- SocketCAN added to connection panel interface dropdown

---

## v0.1.0 -- First Release

- CAN interface module -- gs_usb, slcan, socketcan, virtual
- Frame model: id, dlc, data, timestamp, is_extended_id, is_fd, is_error_frame
- WebSocket endpoint `/ws/frames` -- live frame and stats stream
- REST endpoints: `/connect`, `/disconnect`, `/status`, `/stats`, `/send`
- DBC parsing via cantools -- file upload, signal decode attached to WebSocket frames
- Session logging -- `.asc` and `.csv` formats via aiofiles
- Live message table (TanStack Table + TanStack Virtual) -- ID, DLC, data, count, rate, last seen
- DBC signal panel -- file upload, decoded signals nested under message ID, raw/decoded toggle
- Filter bar -- by message ID (hex/range) and signal name, state in URL params
- Send frame panel -- ID, DLC, hex data, extended ID toggle
- Log controls -- start/stop recording, download `.asc` and `.csv`
- Replay panel -- upload log, play/pause/speed controls
- Settings panel -- interface/channel/bitrate without page reload
- Frontend bundled into pip package via `npm run build`
- Unit tests -- virtual bus throughout
