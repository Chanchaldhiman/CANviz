"""
canviz/cli.py
-------------
Typer-based entry point registered as the `canviz` console script.

Subcommands:
  canviz serve    - start the web server (default behaviour, backward-compatible)
  canviz monitor  - Rich live table in the terminal (SSH / headless workflow)
  canviz capture  - record frames to a JSON file for a fixed duration
  canviz decode   - read a captured file, apply DBC decode, write JSON/CSV to stdout

Backward-compatible invocation (no subcommand = serve):
  canviz                                       # auto-detect gs_usb, open browser
  canviz --interface slcan --channel COM3      # slcan
  canviz --interface virtual --no-browser      # virtual bus, headless

Explicit subcommands:
  canviz serve --interface gs_usb
  canviz serve --headless                      # API + WebSocket only, no browser
  canviz monitor --interface socketcan --channel can0 --dbc vehicle.dbc
  canviz capture --interface virtual --duration 30 --output trace.json
  canviz decode --input trace.json --dbc vehicle.dbc --format csv
"""

from __future__ import annotations

import csv
import json
import logging
import sys
import threading
import time
import webbrowser
from datetime import datetime
from pathlib import Path
from typing import Optional

import can
import typer
import uvicorn
from rich.console import Console
from rich.live import Live
from rich.table import Table
from rich.text import Text
from typing_extensions import Annotated

from canviz.bus import open_bus  
from canviz.config import settings


# ── Typer app ────────────────────────────────────────────────────────────────

app = typer.Typer(
    name="canviz",
    help="CANviz - open-source browser-based CAN bus analyzer",
    add_completion=True,          # generates shell autocomplete for bash/zsh/fish
    no_args_is_help=False,        # allow bare `canviz` to run serve (backward compat)
    invoke_without_command=True,
)

console = Console()
err_console = Console(stderr=True)  # for status messages that must not pollute stdout

# ── Shared option types (reused across subcommands) ──────────────────────────

InterfaceOpt = Annotated[
    str,
    typer.Option(
        "--interface", "-i",
        help="CAN interface: gs_usb | slcan | socketcan | virtual",
    ),
]
ChannelOpt = Annotated[
    str,
    typer.Option("--channel", "-c", help="Channel for slcan (e.g. COM3) or socketcan (e.g. can0)"),
]
BaudrateOpt = Annotated[
    int,
    typer.Option("--baudrate", "-s", help="tty or COM bus baudrate in bps"),
]
BitrateOpt = Annotated[
    int,
    typer.Option("--bitrate", "-b", help="CAN bus bitrate in bps"),
]
IndexOpt = Annotated[
    int,
    typer.Option("--index", help="gs_usb device index when multiple devices are attached"),
]
DbcOpt = Annotated[
    Optional[Path],
    typer.Option("--dbc", help="Path to a .dbc file for signal decoding"),
]



# ── Root callback - invoked when no subcommand is given ──────────────────────

@app.callback(invoke_without_command=True)
def root(
    ctx: typer.Context,
    interface: InterfaceOpt = "gs_usb",
    channel: ChannelOpt = "",
    index: IndexOpt = 0,
    bitrate: BitrateOpt = 500_000,
    baudrate: BaudrateOpt = 115_200,
    host: Annotated[str, typer.Option("--host", help="Host to bind")] = "127.0.0.1",
    port: Annotated[int, typer.Option("--port", help="Port to listen on")] = 8080,
    no_browser: Annotated[bool, typer.Option("--no-browser", help="Do not auto-open the browser")] = False,
    log_level: Annotated[str, typer.Option("--log-level", help="Logging level")] = "info",
) -> None:
    """
    Start the CANviz web server (default behaviour - runs when no subcommand is given).
    Backward-compatible with all previous canviz flags.
    """
    if ctx.invoked_subcommand is not None:
        # A subcommand was given - let it handle everything
        return

    _run_serve(
        interface=interface,
        channel=channel,
        index=index,
        bitrate=bitrate,
        baudrate=baudrate,
        host=host,
        port=port,
        headless=no_browser,
        log_level=log_level,
        enable_j1939=False,
    )


# ── serve ─────────────────────────────────────────────────────────────────────

@app.command()
def serve(
    interface: InterfaceOpt = "gs_usb",
    channel: ChannelOpt = "",
    index: IndexOpt = 0,
    bitrate: BitrateOpt = 500_000,
    baudrate: BaudrateOpt = 115_200,
    host: Annotated[str, typer.Option("--host", help="Host to bind")] = "127.0.0.1",
    port: Annotated[int, typer.Option("--port", help="Port to listen on")] = 8080,
    headless: Annotated[bool, typer.Option("--headless", help="Start API only - do not open a browser")] = False,
    no_browser: Annotated[bool, typer.Option("--no-browser", hidden=True)] = False,
    j1939: Annotated[bool, typer.Option("--j1939", help="Auto-enable J1939 decoder after connect")] = False,
    log_level: Annotated[str, typer.Option("--log-level")] = "info",
) -> None:
    """Start the CANviz web server and (optionally) open a browser."""
    _run_serve(
        interface=interface,
        channel=channel,
        index=index,
        bitrate=bitrate,
        baudrate=baudrate,
        host=host,
        port=port,
        headless=headless or no_browser,
        log_level=log_level,
        enable_j1939=j1939,
    )


def _run_serve(
    interface: str,
    channel: str,
    index: int,
    bitrate: int,
    baudrate: int,
    host: str,
    port: int,
    headless: bool,
    log_level: str,
    enable_j1939: bool = False,
) -> None:
    """Shared implementation used by root callback and `serve` subcommand."""
    settings.interface = interface
    settings.channel   = channel
    settings.index     = index
    settings.bitrate   = bitrate
    settings.host      = host
    settings.port      = port
    settings.baudrate  = baudrate

    logging.basicConfig(
        level=getattr(logging, log_level.upper()),
        format="%(asctime)s [%(name)s] %(levelname)s - %(message)s",
    )

    url = f"http://{host}:{port}"
    console.print(f"\n  [bold green]CANviz[/]  ->  [link={url}]{url}[/link]")
    console.print(f"  Interface : [cyan]{interface}[/]", end="")
    if channel:
        console.print(f"  channel=[cyan]{channel}[/]", end="")
    if interface == "gs_usb":
        console.print(f"  index=[cyan]{index}[/]", end="")
    console.print(f"  bitrate=[cyan]{bitrate}[/]\n")

    if headless:
        console.print("  [yellow]Headless mode[/] - API + WebSocket only, browser will not open.")
        console.print("  Connect to the WebSocket at [cyan]ws://{}:{}/ws/frames[/]\n".format(host, port))

    def _auto_connect(do_connect: bool = True) -> None:
        import urllib.request
        
        base = f"http://{host}:{port}"
        # Wait for server to be ready (up to 15s)
        for _ in range(60):
            try:
                urllib.request.urlopen(f"{base}/status", timeout=1)
                break
            except Exception:
                time.sleep(0.25)
        if not do_connect:
            # No explicit args given - just open browser, skip /connect
            if not headless:
                webbrowser.open(url)
            return
        # POST /connect
        body = json.dumps({
            "interface": interface,
            "channel":   channel,
            "bitrate":   bitrate,
            "index":     index,
            "baudrate":  baudrate
        }).encode()
        req = urllib.request.Request(
            f"{base}/connect",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                if resp.status == 200:
                    console.print(f"  [green]Auto-connected:[/] {interface}"
                                  + (f" on {channel}" if channel else ""))
        except Exception as exc:
            err_console.print(f"  [yellow]Auto-connect failed:[/] {exc}")
            return
        # Optionally enable J1939
        if enable_j1939:
            j_body = json.dumps({"mode": "on"}).encode()
            j_req = urllib.request.Request(
                f"{base}/j1939/mode",
                data=j_body,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            try:
                with urllib.request.urlopen(j_req, timeout=5) as resp:
                    if resp.status == 200:
                        console.print("  [green]J1939 decoder enabled.[/]")
            except Exception as exc:
                err_console.print(f"  [yellow]J1939 enable failed:[/] {exc}")
        # Open browser unless headless
        if not headless:
            webbrowser.open(url)

    # Only auto-connect when the user explicitly passed connection args.
    # Bare `canviz` (gs_usb + no channel) should just open the browser.
    _should_auto_connect = (interface != "gs_usb") or bool(channel)
    threading.Thread(target=_auto_connect, daemon=True, args=(_should_auto_connect,)).start()

    uvicorn.run(
        "canviz.server:app",
        host=host,
        port=port,
        log_level=log_level,
    )


# ── monitor ───────────────────────────────────────────────────────────────────

@app.command()
def monitor(
    interface: InterfaceOpt = "gs_usb",
    channel: ChannelOpt = "",
    index: IndexOpt = 0,
    bitrate: BitrateOpt = 500_000,
    dbc: DbcOpt = None,
    j1939: Annotated[bool, typer.Option("--j1939", help="Enable J1939 decode - adds PGN and SA columns. Use 250 kbps for trucks/agriculture.")] = False,
    refresh_rate: Annotated[float, typer.Option("--refresh-rate", help="Table refresh rate in Hz")] = 4.0,
) -> None:
    """
    Live CAN frame monitor in the terminal.

    Shows a Rich table that refreshes at 4 Hz. Each row is one unique CAN message ID.
    Columns: ID · Name (if DBC loaded) · DLC · Data (hex) · Count · Rate (fps) · Last Seen
    With --j1939: adds PGN and SA (Source Address) columns for J1939 traffic.

    Data column is colour-coded on change:
      Green  - byte sum increased since last frame
      Red    - byte sum decreased
      White  - unchanged

    Falls back to plain JSON lines when stdout is not a TTY (e.g. piped to grep or jq).

    Ctrl+C to exit cleanly.

    Examples:
      canviz monitor --interface socketcan --channel can0
      canviz monitor --interface slcan --channel COM3 --bitrate 250000 --j1939
      canviz monitor --interface gs_usb --dbc vehicle.dbc
    """
    is_tty = sys.stdout.isatty()

    # Optionally load a DBC for signal name lookup
    db = None
    if dbc is not None:
        try:
            import cantools
            db = cantools.database.load_file(str(dbc))
            if is_tty:
                console.print(f"  [green]DBC loaded:[/] {dbc.name} ({len(db.messages)} messages)\n")
        except Exception as exc:
            console.print(f"  [yellow]Warning:[/] DBC load failed - {exc}", err=True)

    # Import J1939 store if needed
    j1939_store_inst = None
    if j1939:
        try:
            from canviz.j1939_store import J1939Store
            j1939_store_inst = J1939Store()
            j1939_store_inst.set_mode("on")
            if is_tty:
                console.print("  [cyan]J1939 decode enabled[/] - PGN and SA columns active\n")
        except Exception as exc:
            console.print(f"  [yellow]Warning:[/] J1939 init failed - {exc}", err=True)
            j1939_store_inst = None

    # Open the bus directly - no FastAPI involved
    try:
        bus = open_bus(interface, channel, bitrate, index)
    except Exception as exc:
        console.print(f"  [red]Error:[/] Could not open bus - {exc}", err=True)
        raise typer.Exit(code=1)

    if is_tty:
        console.print(f"  [bold green]Monitoring[/] {interface}"
                      + (f" {channel}" if channel else "")
                      + f" @ {bitrate} bps"
                      + (" [cyan][J1939][/]" if j1939 else "")
                      + " - [dim]Ctrl+C to stop[/]\n")

    rows: dict[int, dict] = {}
    lock = threading.Lock()

    def _on_message(msg: can.Message) -> None:
        arb_id = msg.arbitration_id
        now    = time.monotonic()
        data   = bytes(msg.data)

        # J1939 decode
        j1939_info: dict | None = None
        if j1939_store_inst is not None:
            j1939_info = j1939_store_inst.process_frame(
                arb_id=arb_id,
                data=data,
                is_extended=msg.is_extended_id,
            )
            # process_frame returns pgn_hex/sa_hex but not always names.
            # Look them up from the store's loaded pgn_db/sa_db directly.
            if j1939_info and not j1939_info.get("pgn_name"):
                pgn_db = getattr(j1939_store_inst, "pgn_db", {})
                sa_db  = getattr(j1939_store_inst, "sa_db",  {})
                try:
                    pgn_raw = j1939_info.get("pgn_hex", "")
                    sa_raw  = j1939_info.get("sa_hex",  "")
                    pgn_int = int(pgn_raw, 16) if pgn_raw else None
                    sa_int  = int(sa_raw,  16) if sa_raw  else None
                    if pgn_int is not None:
                        j1939_info["pgn_name"] = (
                            pgn_db.get(pgn_int)
                            or pgn_db.get(str(pgn_int))
                            or ""
                        )
                    if sa_int is not None:
                        j1939_info["sa_name"] = (
                            sa_db.get(sa_int)
                            or sa_db.get(str(sa_int))
                            or ""
                        )
                except Exception:
                    pass

        with lock:
            if arb_id not in rows:
                name = ""
                if db is not None:
                    try:
                        name = db.get_message_by_frame_id(arb_id).name
                    except KeyError:
                        pass
                rows[arb_id] = {
                    "count": 0, "dlc": msg.dlc, "data": data,
                    "prev_data": data, "last_time": now,
                    "first_time": now, "rate": 0.0, "name": name,
                    "j1939": j1939_info,
                }

            row = rows[arb_id]
            elapsed = now - row["last_time"]
            row["prev_data"] = row["data"]
            row["data"]      = data
            row["dlc"]       = msg.dlc
            row["count"]    += 1
            row["last_time"] = now
            if j1939_info:
                row["j1939"] = j1939_info
            if elapsed > 0:
                inst_rate = 1.0 / elapsed
                row["rate"] = 0.2 * inst_rate + 0.8 * row["rate"]

        if not is_tty:
            line: dict = {
                "ts":   round(now, 6),
                "id":   f"{arb_id:08X}",
                "dlc":  msg.dlc,
                "data": data.hex(" ").upper(),
                "name": rows[arb_id]["name"],
            }
            if j1939_info:
                line["pgn"]     = j1939_info.get("pgn_hex", "")
                line["pgn_name"]= j1939_info.get("pgn_name", "")
                line["sa"]      = j1939_info.get("sa_hex", "")
                line["sa_name"] = j1939_info.get("sa_name", "")
            sys.stdout.write(json.dumps(line) + "\n")
            sys.stdout.flush()

    bus.set_filters(None)
    _running = True

    def _reader() -> None:
        _no_frame_count = 0
        while _running:
            try:
                msg = bus.recv(timeout=0.1)
                if msg is not None:
                    _no_frame_count = 0
                    _on_message(msg)
                else:
                    _no_frame_count += 1
                    if _no_frame_count == 300 and interface == "slcan":
                        err_console.print(
                            f"\n  [yellow]Warning:[/] slcan: no frames in ~30 s. "
                            f"Check CAN bitrate ({bitrate} bps) matches the bus. "
                            f"Try --serial-baudrate 2000000 if needed."
                        )
            except Exception as exc:
                err_console.print(f"  [red]recv error:[/] {exc}")
                time.sleep(0.1)

    reader_thread = threading.Thread(target=_reader, daemon=True)
    reader_thread.start()

    def _build_table() -> Table:
        table = Table(
            show_header=True,
            header_style="bold cyan",
            border_style="dim",
            expand=True,
        )
        table.add_column("ID (hex)",   style="cyan",  no_wrap=True, min_width=10)
        table.add_column("Name",       style="white", no_wrap=True, min_width=16)

        if j1939:
            table.add_column("PGN",      style="blue",   no_wrap=True, min_width=8)
            table.add_column("PGN Name", style="white",  no_wrap=True, min_width=22)
            table.add_column("SA",       style="yellow", no_wrap=True, min_width=12)

        table.add_column("DLC",        style="dim",   no_wrap=True, min_width=4, justify="right")
        table.add_column("Data",       no_wrap=True,  min_width=24)
        table.add_column("Count",      justify="right", min_width=8)
        table.add_column("Rate (fps)", justify="right", min_width=10)
        table.add_column("Last seen",  justify="right", min_width=10)

        now = time.monotonic()
        with lock:
            sorted_ids = sorted(rows.keys())

        for arb_id in sorted_ids:
            with lock:
                row = dict(rows[arb_id])

            hex_id  = f"{arb_id:08X}"
            name    = row["name"] or "-"
            dlc     = str(row["dlc"])
            count   = f"{row['count']:,}"
            rate    = f"{row['rate']:.1f}"
            age     = now - row["last_time"]
            age_str = f"{age:.2f}s" if age < 60 else f"{age/60:.1f}m"

            curr_sum  = sum(row["data"])
            prev_sum  = sum(row["prev_data"])
            hex_data  = row["data"].hex(" ").upper()
            if curr_sum > prev_sum:
                data_text = Text(hex_data, style="bold green")
            elif curr_sum < prev_sum:
                data_text = Text(hex_data, style="bold red")
            else:
                data_text = Text(hex_data, style="white")

            if j1939:
                j = row.get("j1939") or {}
                pgn_hex  = j.get("pgn_hex",  "-")
                pgn_name = j.get("pgn_name", "-")
                # Truncate long PGN names for terminal width
                if len(pgn_name) > 28:
                    pgn_name = pgn_name[:26] + "…"
                sa_str   = f"{j.get('sa_hex','-')} {j.get('sa_name','')}"
                table.add_row(hex_id, name, pgn_hex, pgn_name, sa_str,
                              dlc, data_text, count, rate, age_str)
            else:
                table.add_row(hex_id, name, dlc, data_text, count, rate, age_str)

        return table

    try:
        if is_tty:
            refresh_interval = 1.0 / refresh_rate
            with Live(
                _build_table(),
                console=console,
                refresh_per_second=refresh_rate,
                screen=False,
            ) as live:
                while True:
                    time.sleep(refresh_interval)
                    live.update(_build_table())
        else:
            while True:
                time.sleep(1)

    except KeyboardInterrupt:
        pass
    finally:
        _running = False
        reader_thread.join(timeout=1.0)
        try:
            bus.shutdown()
        except Exception:
            pass
        if is_tty:
            with lock:
                total = sum(r["count"] for r in rows.values())
            console.print(
                f"\n  [dim]Stopped. {len(rows)} unique IDs · {total:,} total frames.[/]\n"
            )
    """
    Live CAN frame monitor in the terminal.

    Shows a Rich table that refreshes at 4 Hz. Each row is one unique CAN message ID.
    Columns: ID · Name (if DBC loaded) · DLC · Data (hex) · Count · Rate (fps) · Last Seen

    Data column is colour-coded on change:
      Green  - byte sum increased since last frame
      Red    - byte sum decreased
      White  - unchanged

    Falls back to plain JSON lines when stdout is not a TTY (e.g. piped to grep or jq).

    Ctrl+C to exit cleanly.
    """
    is_tty = sys.stdout.isatty()

    # Optionally load a DBC for signal name lookup
    db = None
    if dbc is not None:
        try:
            import cantools
            db = cantools.database.load_file(str(dbc))
            if is_tty:
                console.print(f"  [green]DBC loaded:[/] {dbc.name} ({len(db.messages)} messages)\n")
        except Exception as exc:
            console.print(f"  [yellow]Warning:[/] DBC load failed - {exc}", err=True)

    # Open the bus directly - no FastAPI involved
    try:
        bus = open_bus(interface, channel, bitrate, index)
    except Exception as exc:
        console.print(f"  [red]Error:[/] Could not open bus - {exc}", err=True)
        raise typer.Exit(code=1)

    if is_tty:
        console.print(f"  [bold green]Monitoring[/] {interface}"
                      + (f" {channel}" if channel else "")
                      + f" @ {bitrate} bps"
                      + " - [dim]Ctrl+C to stop[/]\n")

    # State per message ID
    # { arb_id: { "count": int, "dlc": int, "data": bytes, "prev_data": bytes,
    #             "last_time": float, "rate": float, "name": str } }
    rows: dict[int, dict] = {}
    lock = threading.Lock()

    def _on_message(msg: can.Message) -> None:
        arb_id = msg.arbitration_id
        now = time.monotonic()
        data = bytes(msg.data)

        with lock:
            if arb_id not in rows:
                # Resolve name from DBC if available
                name = ""
                if db is not None:
                    try:
                        name = db.get_message_by_frame_id(arb_id).name
                    except KeyError:
                        pass
                rows[arb_id] = {
                    "count": 0,
                    "dlc": msg.dlc,
                    "data": data,
                    "prev_data": data,
                    "last_time": now,
                    "first_time": now,
                    "rate": 0.0,
                    "name": name,
                }

            row = rows[arb_id]
            elapsed = now - row["last_time"]
            row["prev_data"] = row["data"]
            row["data"]      = data
            row["dlc"]       = msg.dlc
            row["count"]    += 1
            row["last_time"] = now
            # Exponential moving average for rate
            if elapsed > 0:
                inst_rate = 1.0 / elapsed
                row["rate"] = 0.2 * inst_rate + 0.8 * row["rate"]

        if not is_tty:
            # Plain JSON line for piped output
            line = {
                "ts": round(now, 6),
                "id": f"{arb_id:08X}",
                "dlc": msg.dlc,
                "data": data.hex(" ").upper(),
                "name": rows[arb_id]["name"],
            }
            sys.stdout.write(json.dumps(line) + "\n")
            sys.stdout.flush()

    # Attach callback - synchronous since we're in a thread
    bus.set_filters(None)

    _running = True

    def _reader() -> None:
        _no_frame_count = 0
        while _running:
            try:
                msg = bus.recv(timeout=0.1)
                if msg is not None:
                    _no_frame_count = 0
                    _on_message(msg)
                else:
                    _no_frame_count += 1
                    # After 30 s of silence on slcan, surface one actionable hint.
                    if _no_frame_count == 300 and interface == "slcan":
                        err_console.print(
                            f"\n  [yellow]Warning:[/] slcan: no frames in ~30 s. "
                            f"Check CAN bitrate ({bitrate} bps) matches the bus. "
                            f"Try --serial-baudrate 2000000 if needed."
                        )
            except Exception as exc:
                err_console.print(f"  [red]recv error:[/] {exc}")
                time.sleep(0.1)

    reader_thread = threading.Thread(target=_reader, daemon=True)
    reader_thread.start()

    def _build_table() -> Table:
        table = Table(
            show_header=True,
            header_style="bold cyan",
            border_style="dim",
            expand=True,
        )
        table.add_column("ID (hex)",  style="cyan",  no_wrap=True, min_width=10)
        table.add_column("Name",      style="white", no_wrap=True, min_width=16)
        table.add_column("DLC",       style="dim",   no_wrap=True, min_width=4, justify="right")
        table.add_column("Data",      no_wrap=True,  min_width=24)
        table.add_column("Count",     justify="right", min_width=8)
        table.add_column("Rate (fps)",justify="right", min_width=10)
        table.add_column("Last seen", justify="right", min_width=10)

        now = time.monotonic()
        with lock:
            sorted_ids = sorted(rows.keys())

        for arb_id in sorted_ids:
            with lock:
                row = dict(rows[arb_id])  # shallow copy to release lock quickly

            hex_id = f"{arb_id:08X}"
            name   = row["name"] or "-"
            dlc    = str(row["dlc"])
            count  = f"{row['count']:,}"
            rate   = f"{row['rate']:.1f}"
            age    = now - row["last_time"]
            age_str = f"{age:.2f}s" if age < 60 else f"{age/60:.1f}m"

            # Colour-code data by change direction
            curr_sum = sum(row["data"])
            prev_sum = sum(row["prev_data"])
            hex_data = row["data"].hex(" ").upper()
            if curr_sum > prev_sum:
                data_text = Text(hex_data, style="bold green")
            elif curr_sum < prev_sum:
                data_text = Text(hex_data, style="bold red")
            else:
                data_text = Text(hex_data, style="white")

            table.add_row(hex_id, name, dlc, data_text, count, rate, age_str)

        return table

    try:
        if is_tty:
            refresh_interval = 1.0 / refresh_rate
            with Live(
                _build_table(),
                console=console,
                refresh_per_second=refresh_rate,
                screen=False,
            ) as live:
                while True:
                    time.sleep(refresh_interval)
                    live.update(_build_table())
        else:
            # Non-TTY - _on_message already writes JSON lines; just block
            while True:
                time.sleep(1)

    except KeyboardInterrupt:
        pass
    finally:
        _running = False
        reader_thread.join(timeout=1.0)
        try:
            bus.shutdown()
        except Exception:
            pass
        if is_tty:
            with lock:
                total = sum(r["count"] for r in rows.values())
            console.print(
                f"\n  [dim]Stopped. {len(rows)} unique IDs · {total:,} total frames.[/]\n"
            )


# ── capture ───────────────────────────────────────────────────────────────────

@app.command()
def capture(
    interface: InterfaceOpt = "gs_usb",
    channel: ChannelOpt = "",
    index: IndexOpt = 0,
    bitrate: BitrateOpt = 500_000, 
    output: Annotated[
        Optional[Path],
        typer.Option("--output", "-o", help="Output file path (default: canviz_YYYYMMDD_HHMMSS.json)"),
    ] = None,
    duration: Annotated[
        Optional[float],
        typer.Option("--duration", "-d", help="Capture duration in seconds (default: run until Ctrl+C)"),
    ] = None,
) -> None:
    """
    Capture CAN frames to a JSON file.

    Records every raw frame (id, dlc, data, timestamp) to disk.
    Use `canviz decode` to apply DBC signal decoding to the captured file.

    Examples:
      canviz capture --interface virtual --duration 30
      canviz capture --interface socketcan --channel can0 --output run1.json
      canviz capture --interface slcan --channel COM3 --serial-baudrate 2000000
    """
    if output is None:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        output = Path(f"canviz_{ts}.json")

    try:
        bus = open_bus(interface, channel, bitrate, index,)
    except Exception as exc:
        console.print(f"  [red]Error:[/] Could not open bus - {exc}", err=True)
        raise typer.Exit(code=1)

    console.print(f"  [bold green]Capturing[/] → [cyan]{output}[/]", end="")
    if duration:
        console.print(f"  (max [cyan]{duration}s[/])", end="")
    console.print("  - [dim]Ctrl+C to stop[/]")

    frames: list[dict] = []
    start = time.monotonic()
    _running = True

    def _reader() -> None:
        _no_frame_count = 0
        while _running:
            try:
                msg = bus.recv(timeout=0.1)
                if msg is None:
                    _no_frame_count += 1
                    # After 30 s of silence on slcan, surface one actionable hint.
                    if _no_frame_count == 300 and interface == "slcan":
                        err_console.print(
                            f"\n  [yellow]Warning:[/] slcan: no frames in ~30 s. "
                            f"Check CAN bitrate ({bitrate} bps) matches the bus. "
                            f"Try --serial-baudrate 2000000 if needed."
                        )
                    continue
                _no_frame_count = 0
                frames.append({
                    "ts":       round(time.monotonic() - start, 6),
                    "id":       msg.arbitration_id,
                    "id_hex":   f"{msg.arbitration_id:08X}",
                    "dlc":      msg.dlc,
                    "data":     list(msg.data),
                    "is_extended_id": msg.is_extended_id,
                    "is_error_frame": msg.is_error_frame,
                    "is_fd":    getattr(msg, "is_fd", False),
                })
            except Exception as exc:
                err_console.print(f"  [red]recv error:[/] {exc}")
                time.sleep(0.1)

    reader_thread = threading.Thread(target=_reader, daemon=True)
    reader_thread.start()

    try:
        if duration is not None:
            deadline = start + duration
            while time.monotonic() < deadline:
                elapsed = time.monotonic() - start
                console.print(
                    f"\r  {len(frames):>8,} frames  {elapsed:5.1f}s / {duration:.0f}s",
                    end="",
                    highlight=False,
                )
                time.sleep(0.25)
            console.print()  # newline after progress
        else:
            while True:
                elapsed = time.monotonic() - start
                console.print(
                    f"\r  {len(frames):>8,} frames  {elapsed:5.1f}s",
                    end="",
                    highlight=False,
                )
                time.sleep(0.25)

    except KeyboardInterrupt:
        console.print()

    finally:
        _running = False
        reader_thread.join(timeout=1.0)
        try:
            bus.shutdown()
        except Exception:
            pass

    # Write output
    payload = {
        "meta": {
            "interface": interface,
            "channel":   channel,
            "bitrate":   bitrate,
            "captured_at": datetime.now().isoformat(),
            "duration_s":  round(time.monotonic() - start, 3),
            "frame_count": len(frames),
        },
        "frames": frames,
    }
    output.write_text(json.dumps(payload, indent=2))
    console.print(
        f"\n  [green]Saved[/] {len(frames):,} frames → [cyan]{output}[/] "
        f"({output.stat().st_size // 1024} KB)\n"
    )


# ── decode ────────────────────────────────────────────────────────────────────

@app.command()
def decode(
    input: Annotated[Path, typer.Option("--input", "-i", help="Captured JSON file from `canviz capture`")],
    dbc: Annotated[Path, typer.Option("--dbc", help="DBC file for signal decoding")],
    format: Annotated[
        str,
        typer.Option("--format", "-f", help="Output format: json | csv"),
    ] = "json",
    output: Annotated[
        Optional[Path],
        typer.Option("--output", "-o", help="Output file path. If omitted, writes to stdout (for shell pipelines)."),
    ] = None,
) -> None:
    """
    Decode a captured frame file using a DBC and write decoded signals to a file or stdout.

    Reads a .json file produced by `canviz capture`, applies cantools DBC
    signal decoding to each frame, and outputs the result as JSON or CSV.

    Save to a file:
      canviz decode --input trace.json --dbc vehicle.dbc --output decoded.json
      canviz decode --input trace.json --dbc vehicle.dbc --format csv --output signals.csv

    Or pipe to shell tools (stdout mode - omit --output):
      canviz decode --input trace.json --dbc vehicle.dbc | jq '.[] | .signals'
      canviz decode --input trace.json --dbc vehicle.dbc --format csv | grep EngineRPM
    """
    try:
        import cantools
    except ImportError:
        console.print("  [red]Error:[/] cantools is not installed.", err=True)
        raise typer.Exit(code=1)

    if not input.exists():
        console.print(f"  [red]Error:[/] Input file not found: {input}", err=True)
        raise typer.Exit(code=1)

    if not dbc.exists():
        console.print(f"  [red]Error:[/] DBC file not found: {dbc}", err=True)
        raise typer.Exit(code=1)

    try:
        db = cantools.database.load_file(str(dbc))
    except Exception as exc:
        console.print(f"  [red]Error:[/] DBC parse failed - {exc}", err=True)
        raise typer.Exit(code=1)

    try:
        raw = json.loads(input.read_text())
    except Exception as exc:
        console.print(f"  [red]Error:[/] Could not read capture file - {exc}", err=True)
        raise typer.Exit(code=1)

    frames = raw.get("frames", raw) if isinstance(raw, dict) else raw

    decoded_frames: list[dict] = []
    for frame in frames:
        arb_id  = frame["id"]
        data    = bytes(frame["data"])
        signals: dict = {}

        try:
            msg_def = db.get_message_by_frame_id(arb_id)
            signals = msg_def.decode(data, decode_choices=False)
            # Convert numpy types to plain Python for JSON serialisation
            signals = {
                k: float(v) if hasattr(v, "item") else v
                for k, v in signals.items()
            }
            msg_name = msg_def.name
        except Exception:
            msg_name = ""

        decoded_frames.append({
            "ts":      frame["ts"],
            "id_hex":  frame.get("id_hex", f"{arb_id:08X}"),
            "name":    msg_name,
            "dlc":     frame["dlc"],
            "data_hex": bytes(frame["data"]).hex(" ").upper(),
            "signals": signals,
        })

    format = format.lower()

    if format not in ("json", "csv"):
        console.print(f"  [red]Error:[/] Unknown format '{format}'. Use: json | csv", err=True)
        raise typer.Exit(code=1)

    # Determine output destination
    use_file = output is not None
    out_stream = open(output, "w", newline="", encoding="utf-8") if use_file else sys.stdout

    try:
        if format == "json":
            json.dump(decoded_frames, out_stream, indent=2)
            out_stream.write("\n")

        elif format == "csv":
            # Flatten: one row per signal per frame
            writer = csv.writer(out_stream)
            writer.writerow(["ts", "id_hex", "message", "signal", "value"])
            for f in decoded_frames:
                if f["signals"]:
                    for sig_name, value in f["signals"].items():
                        writer.writerow([f["ts"], f["id_hex"], f["name"], sig_name, value])
                else:
                    # Frame received but no signals decoded (unknown ID or no DBC match)
                    writer.writerow([f["ts"], f["id_hex"], f["name"], "", ""])

    finally:
        if use_file:
            out_stream.close()

    if use_file:
        size_kb = output.stat().st_size // 1024
        n_with_signals = sum(1 for f in decoded_frames if f["signals"])
        err_console.print(
            f"\n  [green]Saved[/] {len(decoded_frames):,} frames "
            f"({n_with_signals:,} decoded) → [cyan]{output}[/] ({size_kb} KB)\n"
        )


# ── j1939 subcommand group ────────────────────────────────────────────────────

j1939_app = typer.Typer(
    name="j1939",
    help="J1939 decoder commands - inspect nodes, faults, and BAM log.",
    no_args_is_help=True,
)
app.add_typer(j1939_app, name="j1939")


@j1939_app.command("status")
def j1939_status(
    host: Annotated[str, typer.Option("--host", help="CANviz server host")] = "127.0.0.1",
    port: Annotated[int, typer.Option("--port", help="CANviz server port")] = 8080,
) -> None:
    """
    Show J1939 decoder status from a running CANviz server.

    Displays mode, PGN database size, active nodes, recent BAM messages,
    and active DM1 fault codes. Requires `canviz serve` to be running.

    Example:
      canviz serve --interface slcan --channel COM3 --bitrate 250000 &
      canviz j1939 status
    """
    import urllib.request
    import urllib.error

    url = f"http://{host}:{port}/j1939/status"
    try:
        with urllib.request.urlopen(url, timeout=3) as resp:
            data = json.loads(resp.read())
    except urllib.error.URLError:
        console.print(f"  [red]Error:[/] Could not reach CANviz at {url}")
        console.print("  Is [cyan]canviz serve[/] running?")
        raise typer.Exit(code=1)

    mode    = data.get("mode", "off")
    detected= data.get("auto_detected", False)
    pgn_sz  = data.get("pgn_db_size", 0)
    sa_sz   = data.get("sa_db_size", 0)
    spn_sz  = data.get("spn_db_size", 0)
    has_pj  = data.get("has_pretty_j1939", False)

    # Header
    mode_color = "green" if mode == "on" else "dim"
    console.print(f"\n  [bold]J1939 Decoder[/]  [{mode_color}]{mode.upper()}[/]"
                  + ("  [yellow](traffic detected)[/]" if detected and mode == "off" else ""))
    console.print(f"  Database: [cyan]{pgn_sz}[/] PGNs · [cyan]{sa_sz}[/] SA names · "
                  f"[cyan]{spn_sz}[/] SPNs"
                  + (" (pretty_j1939)" if has_pj else " (built-in)"))

    # Active nodes
    sa_table = data.get("sa_table", [])
    if sa_table:
        console.print(f"\n  [bold cyan]Nodes ({len(sa_table)})[/]")
        t = Table(show_header=True, header_style="bold", border_style="dim", expand=False)
        t.add_column("SA",     style="yellow", no_wrap=True)
        t.add_column("Name",   style="white")
        t.add_column("Frames", justify="right", style="cyan")
        t.add_column("Last seen", justify="right", style="dim")
        for node in sa_table:
            age_s = node.get("last_seen_s", 0)
            age   = f"{age_s:.0f}s ago" if age_s < 60 else f"{age_s/60:.1f}m ago"
            t.add_row(node["sa_hex"], node["sa_name"],
                      f"{node['frame_count']:,}", age)
        console.print(t)
    else:
        console.print("\n  [dim]No nodes seen - enable decoder and connect to a J1939 bus.[/]")

    # Recent BAM
    bam = data.get("recent_bam", [])
    if bam:
        console.print(f"\n  [bold cyan]BAM Log ({len(bam)} reassembled)[/]")
        t = Table(show_header=True, header_style="bold", border_style="dim", expand=False)
        t.add_column("PGN",      style="blue",  no_wrap=True)
        t.add_column("Name",     style="white")
        t.add_column("Bytes",    justify="right", style="dim")
        t.add_column("Payload (hex)", style="dim")
        for b in bam:
            payload = b.get("data_hex", "")
            if len(payload) > 40:
                payload = payload[:38] + "…"
            t.add_row(b["pgn_hex"], b["pgn_name"], str(b["length"]), payload)
        console.print(t)

    # DM1 faults
    dm1 = data.get("recent_dm1", [])
    if dm1:
        console.print(f"\n  [bold red]DM1 Active Faults ({len(dm1)})[/]")
        t = Table(show_header=True, header_style="bold", border_style="dim", expand=False)
        t.add_column("SPN",       style="yellow", no_wrap=True)
        t.add_column("Component", style="white")
        t.add_column("FMI", no_wrap=True)
        t.add_column("OC",  justify="right", style="dim")
        t.add_column("Lamps", style="red")

        _FMI = {
            0: "Above normal", 1: "Below normal", 2: "Erratic/intermittent",
            3: "Voltage high", 4: "Voltage low",  5: "Open circuit",
            6: "Short to GND", 7: "Mech. fault",  12: "Bad component",
            31: "Condition exists",
        }
        for f in dm1:
            fmi_txt = f"{f['fmi']} - {_FMI.get(f['fmi'], 'See SAE J1939-73')}"
            lamps   = [k for k, v in f.get("lamps", {}).items() if v == "Active"]
            lamp_str= ", ".join(lamps) if lamps else "None"
            t.add_row(str(f["spn"]),
                      f.get("spn_name") or f"SPN {f['spn']}",
                      fmi_txt,
                      str(f["oc"]),
                      lamp_str)
        console.print(t)
    else:
        console.print("\n  [dim]No active DM1 faults.[/]")

    console.print()


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    app()


if __name__ == "__main__":
    main()