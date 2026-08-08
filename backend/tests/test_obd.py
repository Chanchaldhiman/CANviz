"""
tests/test_obd.py
------------------
OBD-II Mode 01 tests. Two layers:

1. Pure decode-function tests (PID_TABLE, support bitmask) - no bus needed.
2. End-to-end transport tests against a fake ECU on a second virtual bus
   instance sharing the same "vcan0" channel as CANviz's own bus_manager.
   python-can's virtual interface fans out in-process by channel name, so
   this validates the actual send -> request -> response -> decode path,
   not just the math.

Run: pytest tests/ -v
"""

import asyncio
import can
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

from canviz.server import app
from canviz.bus import bus_manager
from canviz.ws_broadcaster import broadcaster
from canviz.obd_store import obd_store, PID_TABLE, _decode_support_bitmask

# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest_asyncio.fixture(autouse=True)
async def clean_state():
    yield
    bus_manager.remove_frame_callback(broadcaster.on_frame)
    bus_manager.remove_frame_callback(obd_store.on_frame)
    obd_store.reset()
    await bus_manager.disconnect()
    await broadcaster.stop()


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


# ── Pure decode-function tests (no bus) ──────────────────────────────────────

def test_rpm_decode():
    # ((0x1A * 256) + 0xF8) / 4 = 1726.0 rpm
    assert PID_TABLE[0x0C]["decode"]([0x1A, 0xF8]) == pytest.approx(1726.0)


def test_coolant_temp_decode():
    # 0x5A (90) - 40 = 50 degC
    assert PID_TABLE[0x05]["decode"]([0x5A]) == 50.0


def test_speed_decode():
    assert PID_TABLE[0x0D]["decode"]([0x64]) == 100.0


def test_throttle_pct_decode():
    # 255 -> 100.0%, 0 -> 0.0%
    assert PID_TABLE[0x11]["decode"]([255]) == pytest.approx(100.0)
    assert PID_TABLE[0x11]["decode"]([0]) == pytest.approx(0.0)


def test_fuel_trim_decode_symmetric():
    # 128 raw = 0% trim (centre point)
    assert PID_TABLE[0x06]["decode"]([128]) == pytest.approx(0.0)


def test_timing_advance_decode():
    # 128 raw = 0 degrees (the neutral/midpoint value, same -64 offset pattern as temps)
    assert PID_TABLE[0x0E]["decode"]([128]) == pytest.approx(0.0)
    assert PID_TABLE[0x0E]["decode"]([0]) == pytest.approx(-64.0)
    assert PID_TABLE[0x0E]["decode"]([255]) == pytest.approx(63.5)


def test_evap_vapor_pressure_signed16_negative():
    # 0xFF9C = 65436 unsigned -> -100 signed -> /4 = -25.0 Pa
    # (vacuum readings are the common case for this PID, must decode negative)
    assert PID_TABLE[0x32]["decode"]([0xFF, 0x9C]) == pytest.approx(-25.0)


def test_evap_vapor_pressure_signed16_positive():
    assert PID_TABLE[0x32]["decode"]([0x00, 0x64]) == pytest.approx(25.0)


def test_commanded_equivalence_ratio_stoichiometric():
    # Lambda = 1.0 (stoichiometric) encodes as roughly the midpoint of the 16-bit range
    raw = round(65535 / 2)
    got = PID_TABLE[0x44]["decode"]([(raw >> 8) & 0xFF, raw & 0xFF])
    assert got == pytest.approx(1.0, abs=0.01)


def test_catalyst_temp_decode():
    # (A*256+B)/10 - 40; 0x0FA0 = 4000 -> 400.0 - 40 = 360.0 degC
    assert PID_TABLE[0x3C]["decode"]([0x0F, 0xA0]) == pytest.approx(360.0)


def test_relative_throttle_differs_from_absolute_pid():
    # Same raw byte, same formula -- but these must be genuinely different
    # PIDs (0x11 vs 0x45), not aliases of each other, since that was the
    # whole point of adding 0x45.
    assert 0x11 in PID_TABLE and 0x45 in PID_TABLE
    assert PID_TABLE[0x11]["name"] != PID_TABLE[0x45]["name"]


def test_monitor_status_mil_and_dtc_count():
    from canviz.obd_store import _decode_monitor_status
    assert _decode_monitor_status(bytes([0x83])) == {"mil_on": True, "dtc_count": 3}
    assert _decode_monitor_status(bytes([0x00])) == {"mil_on": False, "dtc_count": 0}
    assert _decode_monitor_status(bytes([0x7F])) == {"mil_on": False, "dtc_count": 127}
    assert _decode_monitor_status(bytes([0xFF])) == {"mil_on": True, "dtc_count": 127}


def test_support_bitmask_decode():
    # Byte0=0xFF -> PIDs base+1..base+8 all supported
    payload = bytes([0xFF, 0x00, 0x00, 0x00])
    supported = _decode_support_bitmask(0x00, payload)
    assert supported == {1, 2, 3, 4, 5, 6, 7, 8}


def test_support_bitmask_decode_partial():
    # Only bit A7 (PID 0x0C, RPM) and bit A3 (PID 0x0D+... let's compute directly)
    # base=0x00: bit7 of byte0 -> pid 1, bit0 of byte0 -> pid 8
    # Set just bit4 of byte0 (0b00010000 = 0x10) -> pid base+4
    payload = bytes([0x10, 0x00, 0x00, 0x00])
    supported = _decode_support_bitmask(0x00, payload)
    assert supported == {4}


# ── End-to-end transport tests (fake ECU on a second virtual bus handle) ────

def _fake_ecu_send_response(pid: int, payload: bytes) -> None:
    """Opens its own handle to the same virtual channel and replies once."""
    ecu_bus = can.Bus(interface="virtual", channel="vcan0", receive_own_messages=False)
    try:
        sf_dl = 2 + len(payload)  # mode + pid + payload bytes
        data = [sf_dl, 0x41, pid, *payload]
        data += [0x00] * (8 - len(data))
        msg = can.Message(arbitration_id=0x7E8, data=bytes(data), is_extended_id=False)
        ecu_bus.send(msg)
    finally:
        ecu_bus.shutdown()


def _fake_ecu_send_response_29bit(pid: int, payload: bytes, response_id: int = 0x18DAF110) -> None:
    """Same as above but replies using 29-bit extended addressing (e.g. Honda)."""
    ecu_bus = can.Bus(interface="virtual", channel="vcan0", receive_own_messages=False)
    try:
        sf_dl = 2 + len(payload)
        data = [sf_dl, 0x41, pid, *payload]
        data += [0x00] * (8 - len(data))
        msg = can.Message(arbitration_id=response_id, data=bytes(data), is_extended_id=True)
        ecu_bus.send(msg)
    finally:
        ecu_bus.shutdown()


async def test_request_pid_end_to_end(client):
    await client.post("/connect", json={"interface": "virtual"})
    bus_manager.add_frame_callback(obd_store.on_frame)

    # Fire the fake ECU response shortly after the request goes out.
    async def responder():
        await asyncio.sleep(0.05)
        _fake_ecu_send_response(0x0C, bytes([0x1A, 0xF8]))  # RPM = 1726.0

    responder_task = asyncio.create_task(responder())
    value = await obd_store._request_pid(0x0C)
    await responder_task

    assert value == pytest.approx(1726.0)


async def test_request_pid_timeout_when_no_ecu(client):
    await client.post("/connect", json={"interface": "virtual"})
    bus_manager.add_frame_callback(obd_store.on_frame)

    with pytest.raises(asyncio.TimeoutError):
        await asyncio.wait_for(obd_store._request_pid(0x0C), timeout=1.5)


async def test_mode_requires_connection(client):
    r = await client.post("/obd/mode", json={"mode": "on"})
    assert r.status_code == 400


async def test_mode_toggle_and_watch(client):
    await client.post("/connect", json={"interface": "virtual"})
    r = await client.post("/obd/mode", json={"mode": "on"})
    assert r.status_code == 200
    assert r.json()["mode"] == "on"

    r = await client.post("/obd/watch", json={"pids": [0x0C, 0x0D, 0x999]})
    assert r.status_code == 200
    # Unknown PID 0x999 silently dropped -- only decodable PIDs are watched
    assert r.json()["watched_pids"] == [0x0C, 0x0D]

    r = await client.post("/obd/mode", json={"mode": "off"})
    assert r.status_code == 200
    assert r.json()["mode"] == "off"


async def test_scan_requires_mode_on(client):
    await client.post("/connect", json={"interface": "virtual"})
    r = await client.post("/obd/scan")
    assert r.status_code == 400


async def test_scan_detects_29bit_addressing_when_11bit_silent(client, monkeypatch):
    """
    Regression test for Honda-style ECUs that only answer 29-bit (extended)
    addressing. Only a 29-bit fake ECU is present -- scan_supported() must
    fall through past the (silent) 11-bit attempt and lock onto 29-bit,
    and on_frame() must not accidentally accept an extended-ID frame while
    still waiting on the 11-bit (standard-ID) probe.
    """
    import canviz.obd_store as obd_module

    monkeypatch.setattr(obd_module, "REQUEST_TIMEOUT_S", 0.15)

    await client.post("/connect", json={"interface": "virtual"})
    bus_manager.add_frame_callback(obd_store.on_frame)

    async def responder():
        await asyncio.sleep(0.17)  # land just after the 11-bit probe times out
        # base_pid=0x00, bit_index=12 (byte1 bit4) -> signals PID 0x0C supported
        _fake_ecu_send_response_29bit(0x00, bytes([0x00, 0x10, 0x00, 0x00]))

    responder_task = asyncio.create_task(responder())
    try:
        supported = await obd_store.scan_supported()
    finally:
        responder_task.cancel()

    assert obd_store.addressing is not None
    assert obd_store.addressing.name == "29-bit"
    assert 0x0C in supported


async def test_scan_fetches_monitor_status_when_supported(client, monkeypatch):
    """
    End-to-end: a fake ECU reports PID 0x01 as supported in its bitmask,
    then answers the follow-up PID 0x01 request with MIL on + 2 DTCs.
    scan_supported() must detect the support flag and populate
    monitor_status without any extra call from the router.
    """
    import canviz.obd_store as obd_module

    monkeypatch.setattr(obd_module, "REQUEST_TIMEOUT_S", 0.2)

    await client.post("/connect", json={"interface": "virtual"})
    bus_manager.add_frame_callback(obd_store.on_frame)

    async def responder():
        loop = asyncio.get_event_loop()
        ecu_bus = can.Bus(interface="virtual", channel="vcan0", receive_own_messages=False)
        try:
            while True:
                # recv() is a blocking call -- run it in the executor so it
                # doesn't freeze the event loop bus_manager itself needs to
                # make progress on (same pattern bus.py's own reader uses).
                msg = await loop.run_in_executor(None, ecu_bus.recv, 1.0)
                if msg is None or msg.arbitration_id != 0x7DF:
                    continue
                data = bytes(msg.data)
                if len(data) < 3 or data[1] != 0x01:
                    continue
                pid = data[2]
                if pid == 0x00:
                    # bit_index=1 (byte0 bit7) -> PID 0x01 supported
                    reply = [0x06, 0x41, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00]
                elif pid == 0x01:
                    reply = [0x03, 0x41, 0x01, 0x82, 0x00, 0x00, 0x00, 0x00]  # MIL on, 2 DTCs
                else:
                    continue
                ecu_bus.send(can.Message(arbitration_id=0x7E8, data=bytes(reply), is_extended_id=False))
        finally:
            ecu_bus.shutdown()

    responder_task = asyncio.create_task(responder())
    try:
        await obd_store.scan_supported()
    finally:
        responder_task.cancel()

    assert obd_store.monitor_status_supported is True
    assert obd_store.monitor_status == {"mil_on": True, "dtc_count": 2}
    """No ECU at all -- must fail cleanly, not hang or raise."""
    import canviz.obd_store as obd_module

    monkeypatch.setattr(obd_module, "REQUEST_TIMEOUT_S", 0.1)

    await client.post("/connect", json={"interface": "virtual"})
    bus_manager.add_frame_callback(obd_store.on_frame)

    supported = await obd_store.scan_supported()

    assert supported == set()
    assert obd_store.addressing is None


async def test_poll_loop_backs_off_without_disabling(client, monkeypatch):
    """
    Regression test for the earlier hard-disable-after-5-failures behaviour:
    the decoder must stay enabled and self-heal, never flip mode back to
    "off" on its own. Constants patched down so this doesn't take 5+ real
    seconds to trigger the backoff path.
    """
    import canviz.obd_store as obd_module

    monkeypatch.setattr(obd_module, "REQUEST_TIMEOUT_S", 0.1)
    monkeypatch.setattr(obd_module, "STALL_THRESHOLD", 3)
    monkeypatch.setattr(obd_module, "STALLED_GAP_S", 0.1)
    monkeypatch.setattr(obd_module, "POLL_GAP_S", 0.02)

    await client.post("/connect", json={"interface": "virtual"})
    await client.post("/obd/mode", json={"mode": "on"})
    await client.post("/obd/watch", json={"pids": [0x0C]})

    # No fake ECU running -- every request times out. Give it enough cycles
    # to cross STALL_THRESHOLD, with margin for scheduler jitter in CI.
    await asyncio.sleep(0.1 * 4 + 0.3)

    assert obd_store.mode == "on", "decoder must not auto-disable on repeated failure"
    assert obd_store.data_stalled is True
    assert obd_store.last_error is not None
    assert "retrying" in obd_store.last_error.lower()

    # Now bring a fake ECU online and confirm it self-heals without any
    # re-enable call from the client.
    async def responder():
        while obd_store.mode == "on" and obd_store.data_stalled:
            _fake_ecu_send_response(0x0C, bytes([0x1A, 0xF8]))
            await asyncio.sleep(0.05)

    responder_task = asyncio.create_task(responder())
    try:
        for _ in range(40):
            if not obd_store.data_stalled:
                break
            await asyncio.sleep(0.05)
    finally:
        responder_task.cancel()

    assert obd_store.mode == "on"
    assert obd_store.data_stalled is False
    assert obd_store.live_values[0x0C]["value"] == pytest.approx(1726.0)
