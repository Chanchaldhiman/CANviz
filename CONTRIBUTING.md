# Contributing to CANviz

CANviz is a young project and community input genuinely shapes where it goes. Whether you have five minutes or five hours, there is something useful you can do.

---

## The most valuable thing right now : hardware testing

The validated hardware list is short. The CAN adapter ecosystem is huge. If you have any of the following sitting on your bench, plugging it in and reporting back is one of the most useful contributions you can make:

| Hardware | Status | What we need |
|----------|--------|--------------|
| CANable 2.0 (Candlelight firmware) | Untested | Does gs_usb connect cleanly? |
| CANable 2.0 Pro (CAN FD) | Untested | Any gs_usb issues? FD frame behaviour? |
| PEAK PCAN-USB | Config only | Does `--interface pcan` work end to end? |
| Kvaser Leaf | Config only | Does `--interface kvaser` work? |
| Vector VN1610 | Config only | Any python-can config gotchas? |
| Any slcan device on COM port | Untested | `--interface slcan --channel COMx` : does it connect and stream? |
| Any device on macOS | Untested | Does `pip install canviz && canviz` even start? |
| Any device on Ubuntu / Fedora desktop | Limited | SocketCAN on non-Pi Linux : any quirks? |

You do not need to write any code. Just open a GitHub issue titled `[Hardware] <device name>` and tell us:

- Hardware name and firmware version
- OS and Python version
- Command you ran
- Whether it worked, and the full terminal output if it didn't

Every confirmed device gets added to the hardware matrix in the README. Your name goes in the commit.

---

## Bug reports

If something doesn't work, please tell us. CANviz has been tested on a limited set of hardware and conditions : real-world reports are the only way to find edge cases.

A useful bug report includes:

```
OS:            Windows 11 / Raspberry Pi OS / Ubuntu 24.04 / ...
Python:        python --version
CANviz:        pip show canviz
Hardware:      FYSETC UCAN / CANable / PEAK / ...
Interface:     gs_usb / slcan / socketcan / virtual
Command run:   canviz --interface ...
What happened: ...
Expected:      ...
Terminal output (full):
```

Open an issue and paste it in. Don't worry about formatting it perfectly : the information matters more than the presentation.

---

## DBC files that expose decode bugs

DBC files from real projects (anonymised or synthetic) that expose signal decode issues are extremely useful. If you load a DBC and signals decode incorrectly or the load fails, open an issue with:

- A minimal DBC snippet that reproduces the problem (remove anything proprietary)
- What CANviz decoded vs what you expected

---

## Code contributions

If you want to write code, these are the open areas:

**Good first issues (well scoped, no hardware needed):**
- Add more unit tests for the virtual bus : frame edge cases, malformed DBC handling, WebSocket reconnect behaviour
- Improve error messages when a DBC file fails to load : currently returns a raw exception string
- Add a `--version` flag to the CLI

**Medium complexity:**
- slcan device auto-detection : currently requires `--channel COMx` manually; could scan available COM ports and probe for a CAN device
- Frame rate throttling : the hook is built in `ws_broadcaster.py`, it just needs a configurable threshold wired to the CLI and UI
- Firefox / Edge compatibility fixes : known to be best-effort; specific failures welcome

**Larger scope (discuss in an issue first):**
- Signal time-series plotting (this is Phase 4 : happy to coordinate)
- CAN FD payload display (requires CAN FD hardware for testing)
- Docker image

---

## Getting the dev environment running

No hardware needed for development : the virtual bus handles everything.

```bash
git clone https://github.com/yourname/CANviz.git
cd CANviz

# Backend
cd backend
pip install -e ".[dev]"
pytest tests/ -v          # all tests should pass

# Frontend (separate terminal)
cd frontend
npm install
npm run dev               # → http://localhost:5173 (proxies to backend on :8080)

# Run backend with virtual bus
cd backend
canviz --interface virtual
```

---

## Pull request process

1. Fork the repo and create a branch: `git checkout -b fix/description` or `feat/description`
2. Make your changes
3. Run `pytest tests/ -v` : all tests must pass
4. Run `ruff check .` : no linting errors
5. Open a PR with a clear description of what changed and why
6. If it's a hardware compatibility fix, mention the device and OS

Small, focused PRs get reviewed and merged faster than large ones. If you're unsure whether something is in scope, open an issue and ask first : that's not a gatekeeping step, it's just a way to avoid wasted effort on both sides.

---

## Code style

- **Python:** `ruff` enforced, line length 100
- **TypeScript:** `eslint` + `prettier`
- Keep functions small and single-purpose
- No `type: ignore` without an explanatory comment

---

## Questions

If you're not sure where to start, open a GitHub Discussion or issue and ask. There are no silly questions about a project this young : context that seems obvious to us is not obvious to someone seeing the codebase for the first time.

---

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
