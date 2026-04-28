"""
canviz/models.py
----------------
Pydantic models used across REST endpoints and WebSocket messages.
Keeping them in one place avoids circular imports.
"""

from __future__ import annotations
from typing import Optional, Union
from pydantic import BaseModel


class CANFrame(BaseModel):
    """A single CAN frame as it travels over the WebSocket."""
    id: str                        # Hex string e.g. "0x1FF"
    dlc: int                       # Data length code (0-8)
    data: list[int]                # Raw bytes as ints
    timestamp: float               # Seconds since bus open
    is_extended_id: bool = False
    is_fd: bool = False            # True for CAN FD frames (Phase 4)
    channel: int = 0
    signals: dict[str, float] = {}  # Populated if a DBC is loaded


class ConnectionStatus(BaseModel):
    connected: bool
    interface: str
    channel: str
    bitrate: int
    index: int
    error: Optional[str] = None


class ConnectRequest(BaseModel):
    interface: str = "gs_usb"
    # channel is a string for slcan/socketcan (e.g. "COM3", "can0")
    # and an int for gs_usb (device index).
    # Accept both; bus.py passes it as `index` for gs_usb.
    channel: Union[str, int] = ""
    bitrate: int = 500_000
    index: int = 0
    serial_baudrate: int = 2000000  # slcan only - USB-serial link speed, separate from CAN bitrate


class SendFrameRequest(BaseModel):
    id: int                        # Arbitration ID as integer
    data: list[int]                # Up to 8 bytes
    is_extended_id: bool = False


class DBCInfo(BaseModel):
    message_count: int
    messages: list[dict]           # name, id, signals[]