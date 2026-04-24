"""
canviz/config.py
----------------
Holds the active connection config and exposes a settings object
the rest of the app can import.  Config is intentionally mutable
at runtime so the frontend settings panel can change it without
restarting the process.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Literal


InterfaceType = Literal["gs_usb", "slcan", "virtual", "socketcan", "pcan", "kvaser"]


@dataclass
class CANConfig:
    # Which python-can interface to use
    interface: InterfaceType = "gs_usb"

    # gs_usb: device index (0 for first/only device)
    index: int = 0

    # slcan / socketcan: channel string e.g. "COM3" or "can0"
    channel: str = ""

    # Bitrate in bps — must match the bus being sniffed
    bitrate: int = 500_000

    # Host / port the HTTP + WS server listens on
    host: str = "127.0.0.1"
    port: int = 8080

    def as_dict(self) -> dict:
        return {
            "interface": self.interface,
            "index": self.index,
            "channel": self.channel,
            "bitrate": self.bitrate,
        }


# Singleton — import this everywhere
settings = CANConfig()
