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

from canviz.server import app
from canviz.bus import bus_manager
from canviz.ws_broadcaster import broadcaster
from canviz.dbc_store import dbc_store

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

    # signals is a list of dicts: [{"name": "RPM", "value": 100.0, ...}, ...]
    names = [s["name"] for s in signals]
    assert "RPM" in names
    assert "Temp" in names

    rpm  = next(s for s in signals if s["name"] == "RPM")
    temp = next(s for s in signals if s["name"] == "Temp")
    assert rpm["value"]  == pytest.approx(100.0)
    assert temp["value"] == pytest.approx(50.0)


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


# ── DBC encode / decode (Send Frame integration) ─────────────────────────────

SEND_DBC = b"""
VERSION ""

NS_ :

BS_:

BU_: ECU

BO_ 256 EngineSpeed: 8 ECU
 SG_ RPM : 0|16@1+ (0.5,0) [0|8000] "rpm" Vector__XXX
 SG_ Temp : 16|8@1+ (1,-40) [0|150] "degC" Vector__XXX

BO_ 2566844926 GearStatus: 8 ECU
 SG_ Gear : 0|3@1+ (1,0) [0|7] "" Vector__XXX

BO_ 300 Muxed: 8 ECU
 SG_ Mux M : 0|8@1+ (1,0) [0|255] "" Vector__XXX
 SG_ A m0 : 8|8@1+ (1,0) [0|255] "" Vector__XXX
 SG_ B m1 : 8|16@1+ (0.1,0) [0|1000] "V" Vector__XXX

BA_DEF_ BO_ "GenMsgCycleTime" INT 0 10000;
BA_DEF_ SG_ "GenSigStartValue" INT 0 100000;
BA_DEF_DEF_ "GenMsgCycleTime" 0;
BA_DEF_DEF_ "GenSigStartValue" 0;
BA_ "GenMsgCycleTime" BO_ 256 20;
BA_ "GenSigStartValue" SG_ 256 RPM 1600;
VAL_ 2566844926 Gear 0 "P" 1 "R" 2 "N" 3 "D" ;
"""


async def _load_send_dbc(client):
    r = await client.post(
        "/dbc/load", files={"file": ("send.dbc", SEND_DBC, "application/octet-stream")},
    )
    assert r.status_code == 200


async def test_dbc_messages_detail(client):
    await _load_send_dbc(client)
    msgs = {m["name"]: m for m in (await client.get("/dbc/messages")).json()["messages"]}

    eng = msgs["EngineSpeed"]
    assert eng["is_extended"] is False
    assert eng["cycle_time"] == 20
    rpm = next(s for s in eng["signals"] if s["name"] == "RPM")
    assert rpm["scale"] == 0.5
    assert rpm["initial"] == 800  # GenSigStartValue 1600 raw * 0.5

    gear = msgs["GearStatus"]
    assert gear["is_extended"] is True
    assert int(gear["id"], 16) == 0x18FEF1FE
    assert gear["signals"][0]["choices"] == {"0": "P", "1": "R", "2": "N", "3": "D"}

    mux = {s["name"]: s for s in msgs["Muxed"]["signals"]}
    assert mux["Mux"]["is_multiplexer"] is True
    assert mux["B"]["multiplexer_ids"] == [1]


async def test_dbc_encode(client):
    await _load_send_dbc(client)
    r = await client.post("/dbc/encode", json={"message": "EngineSpeed",
                                               "signals": {"RPM": 100, "Temp": 50}})
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == 256
    assert body["dlc"] == 8
    assert body["is_extended"] is False
    assert body["data"] == [0xC8, 0x00, 0x5A, 0, 0, 0, 0, 0]


async def test_dbc_encode_uses_initial_values(client):
    await _load_send_dbc(client)
    r = await client.post("/dbc/encode", json={"message": "EngineSpeed", "signals": {}})
    assert r.status_code == 200
    # RPM initial 800 rpm -> raw 1600 = 0x0640; Temp defaults to 0 degC -> raw 40
    assert r.json()["data"][:3] == [0x40, 0x06, 40]


async def test_dbc_encode_multiplexed(client):
    await _load_send_dbc(client)
    r = await client.post("/dbc/encode", json={"message": "Muxed",
                                               "signals": {"Mux": 1, "A": 5, "B": 12.3}})
    assert r.status_code == 200
    body = r.json()
    assert body["data"][:3] == [1, 123, 0]
    assert set(body["signals"]) == {"Mux", "B"}


async def test_dbc_encode_out_of_range_allowed_but_overflow_rejected(client):
    await _load_send_dbc(client)
    # 200 degC exceeds the DBC max (150) but still fits 8 bits -> allowed
    r = await client.post("/dbc/encode", json={"message": "EngineSpeed",
                                               "signals": {"RPM": 0, "Temp": 200}})
    assert r.status_code == 200
    assert r.json()["data"][2] == 240
    # 500 degC does not fit 8 bits -> rejected
    r = await client.post("/dbc/encode", json={"message": "EngineSpeed",
                                               "signals": {"RPM": 0, "Temp": 500}})
    assert r.status_code == 422


async def test_dbc_encode_errors(client):
    r = await client.post("/dbc/encode", json={"message": "EngineSpeed", "signals": {}})
    assert r.status_code == 404  # no DBC loaded
    await _load_send_dbc(client)
    r = await client.post("/dbc/encode", json={"message": "Nope", "signals": {}})
    assert r.status_code == 404


async def test_dbc_decode_endpoint(client):
    await _load_send_dbc(client)
    r = await client.post("/dbc/decode", json={"message": "EngineSpeed",
                                               "data": [0xC8, 0x00, 0x5A, 0, 0, 0, 0, 0]})
    assert r.status_code == 200
    assert r.json()["signals"] == {"RPM": 100.0, "Temp": 50.0}
    # Truncated payload decodes what it can
    r = await client.post("/dbc/decode", json={"message": "EngineSpeed", "data": [0xC8, 0x00]})
    assert r.status_code == 200
    assert r.json()["signals"] == {"RPM": 100.0}
    # Byte out of range
    r = await client.post("/dbc/decode", json={"message": "EngineSpeed", "data": [256]})
    assert r.status_code == 422


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
