"""
tests/test_virtual_bus.py
-------------------------
Phase 1 unit tests — all run on the virtual bus (no hardware required).
Uses pytest-asyncio (auto mode) + httpx AsyncClient.

Run: pytest tests/ -v
"""

import asyncio
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

from canvaz.server import app
from canvaz.bus import bus_manager
from canvaz.ws_broadcaster import broadcaster
from canvaz.dbc_store import dbc_store

# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest_asyncio.fixture(autouse=True)
async def clean_state():
    """
    Reset all singletons between tests.

    Order matters:
      1. Remove callbacks first so no frames arrive during teardown.
      2. Disconnect the bus (stops the reader thread).
      3. Stop the broadcaster (cancels the task, nulls the queue).
      4. Unload DBC (clears in-memory DB).

    broadcaster.stop() is safe to call even when the broadcaster was never
    started — it checks for None before cancelling.
    """
    yield
    bus_manager.remove_frame_callback(broadcaster.on_frame)
    await bus_manager.disconnect()
    await broadcaster.stop()
    dbc_store.unload()


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


# ── Connection tests ──────────────────────────────────────────────────────────

async def test_status_before_connect(client):
    r = await client.get("/status")
    assert r.status_code == 200
    assert r.json()["connected"] is False


async def test_connect_virtual(client):
    r = await client.post("/connect", json={"interface": "virtual"})
    assert r.status_code == 200
    data = r.json()
    assert data["connected"] is True
    assert data["interface"] == "virtual"


async def test_disconnect(client):
    await client.post("/connect", json={"interface": "virtual"})
    r = await client.post("/disconnect")
    assert r.status_code == 200
    assert r.json()["connected"] is False


async def test_connect_bad_interface(client):
    r = await client.post("/connect", json={"interface": "nonexistent"})
    assert r.status_code in (422, 500)


# ── Frame send tests ──────────────────────────────────────────────────────────

async def test_send_without_connect(client):
    r = await client.post("/send", json={"id": 0x100, "data": [1, 2, 3]})
    assert r.status_code == 400


async def test_send_frame_virtual(client):
    await client.post("/connect", json={"interface": "virtual"})
    r = await client.post("/send", json={"id": 0x100, "data": [0xDE, 0xAD, 0xBE, 0xEF]})
    assert r.status_code == 200
    data = r.json()
    assert data["ok"] is True
    assert data["id"] == "0x100"


async def test_send_too_many_bytes(client):
    await client.post("/connect", json={"interface": "virtual"})
    r = await client.post("/send", json={"id": 0x100, "data": [0] * 9})
    assert r.status_code == 400


# ── DBC tests ─────────────────────────────────────────────────────────────────

MINIMAL_DBC = b"""
VERSION ""

NS_ :

BS_:

BU_:

BO_ 256 EngineSpeed: 8 Vector__XXX
 SG_ RPM : 0|16@1+ (0.5,0) [0|8000] "rpm" Vector__XXX
 SG_ Temp : 16|8@1+ (1,-40) [0|150] "degC" Vector__XXX

"""


async def test_dbc_load(client):
    r = await client.post(
        "/dbc/load",
        files={"file": ("test.dbc", MINIMAL_DBC, "application/octet-stream")},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["message_count"] == 1
    assert data["messages"][0]["name"] == "EngineSpeed"


async def test_dbc_messages_empty(client):
    # dbc_store is unloaded by the clean_state fixture after every test,
    # so this always starts with a clean slate
    r = await client.get("/dbc/messages")
    assert r.status_code == 200
    assert r.json()["loaded"] is False


async def test_dbc_decode():
    """Decode a frame directly via dbc_store (no HTTP needed)."""
    dbc_store.load(MINIMAL_DBC, "test.dbc")
    # RPM = 0x00C8 little-endian = 200 raw → 200 * 0.5 = 100.0 rpm
    # Temp byte = 90 raw → 90 - 40 = 50 degC
    data = bytes([0xC8, 0x00, 0x5A, 0x00, 0x00, 0x00, 0x00, 0x00])
    signals = dbc_store.decode(0x100, data)  # 0x100 = 256
    assert "RPM" in signals
    assert signals["RPM"] == pytest.approx(100.0)
    assert "Temp" in signals
    assert signals["Temp"] == pytest.approx(50.0)


async def test_dbc_bad_file(client):
    r = await client.post(
        "/dbc/load",
        files={"file": ("bad.dbc", b"this is not dbc content @@###", "application/octet-stream")},
    )
    assert r.status_code == 422


async def test_dbc_wrong_extension(client):
    r = await client.post(
        "/dbc/load",
        files={"file": ("test.txt", MINIMAL_DBC, "application/octet-stream")},
    )
    assert r.status_code == 400


# ── Log tests ─────────────────────────────────────────────────────────────────

async def test_log_start_requires_connection(client):
    r = await client.post("/log/start")
    assert r.status_code == 400


async def test_log_start_stop(client):
    await client.post("/connect", json={"interface": "virtual"})
    r = await client.post("/log/start")
    assert r.status_code == 200
    assert r.json()["ok"] is True

    await client.post("/send", json={"id": 0x100, "data": [1, 2, 3, 4]})
    await asyncio.sleep(0.1)

    r = await client.post("/log/stop")
    assert r.status_code == 200
    data = r.json()
    assert data["ok"] is True
    assert "asc_file" in data
    assert "csv_file" in data


async def test_log_double_start(client):
    await client.post("/connect", json={"interface": "virtual"})
    await client.post("/log/start")
    r = await client.post("/log/start")
    assert r.status_code == 400
    await client.post("/log/stop")
