"""
canviz/cli.py
-------------
Entry point registered as the `canviz` console script.

Usage examples:
  canviz                                     # auto-detect gs_usb
  canviz --interface gs_usb                  # explicit gs_usb (Candlelight firmware)
  canviz --interface slcan --channel COM3    # slcan (COM port device)
  canviz --interface virtual                 # virtual bus (no hardware, dev/CI)
  canviz --interface socketcan --channel can0  # Raspberry Pi / Linux
  canviz --port 8080 --no-browser            # headless / Docker
"""

import argparse
import logging
import sys
import webbrowser
import threading
import time

import uvicorn

from canviz.config import settings


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="canviz",
        description="CANvas — open-source browser-based CAN bus analyzer",
    )
    parser.add_argument(
        "--interface",
        default="gs_usb",
        choices=["gs_usb", "slcan", "socketcan", "virtual"],
        help="CAN interface to use (default: gs_usb — Candlelight firmware, no reflash needed)",
    )
    parser.add_argument(
        "--channel",
        default="",
        help="Channel for slcan (e.g. COM3) or socketcan (e.g. can0). Not needed for gs_usb.",
    )
    parser.add_argument(
        "--index",
        default=0,
        type=int,
        help="Device index for gs_usb when multiple devices are attached (default: 0)",
    )
    parser.add_argument(
        "--bitrate",
        default=500_000,
        type=int,
        help="CAN bus bitrate in bps (default: 500000)",
    )
    parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="Host to bind (default: 127.0.0.1)",
    )
    parser.add_argument(
        "--port",
        default=8080,
        type=int,
        help="Port to listen on (default: 8080)",
    )
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="Do not auto-open the browser (useful for headless / Docker)",
    )
    parser.add_argument(
        "--log-level",
        default="info",
        choices=["debug", "info", "warning", "error"],
    )

    args = parser.parse_args()

    # Seed the settings singleton so /status reflects CLI args before any
    # /connect call arrives (the frontend reads /status on load)
    settings.interface = args.interface
    settings.channel   = args.channel
    settings.index     = args.index
    settings.bitrate   = args.bitrate
    settings.host      = args.host
    settings.port      = args.port

    logging.basicConfig(
        level=getattr(logging, args.log_level.upper()),
        format="%(asctime)s [%(name)s] %(levelname)s — %(message)s",
    )

    url = f"http://{args.host}:{args.port}"
    print(f"\n  CANvas  →  {url}")
    print(f"  Interface : {args.interface}", end="")
    if args.channel:
        print(f"  channel={args.channel}", end="")
    if args.interface == "gs_usb":
        print(f"  index={args.index}", end="")
    print(f"  bitrate={args.bitrate}\n")

    if not args.no_browser:
        # Open the browser half a second after the server starts
        def _open():
            time.sleep(0.8)
            webbrowser.open(url)
        threading.Thread(target=_open, daemon=True).start()

    uvicorn.run(
        "canviz.server:app",
        host=args.host,
        port=args.port,
        log_level=args.log_level,
    )


if __name__ == "__main__":
    main()
