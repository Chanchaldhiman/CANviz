## Which Interface Do I Use?

Not sure which interface to select? Follow these two steps.

---

### Step 1 - Check Device Manager on Windows

Plug in your adapter, then open **Device Manager** (`Win + X → Device Manager`).

**Look under two places:**

- **Universal Serial Bus devices** or **libusb-win32 devices** → your adapter shows as
  `WinUSB Device`, `Candlelight`, or similar - **no COM port**. Use **gs_usb**.

- **Ports (COM & LPT)** → your adapter shows as `COMx` (e.g. COM3, COM8).
  Go to Step 2.

> On Linux/Mac, gs_usb devices appear as `/dev/canX` via SocketCAN.
> COM port devices appear as `/dev/ttyUSBx` or `/dev/ttyACMx`.

---

### Step 2 - Identify your COM port adapter

Run this script with your adapter plugged in (change `PORT` to your COM port):

```python
import serial, time

PORT = "COM8"  # change to your port

for baud in [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600, 2000000]:
    try:
        s = serial.Serial(PORT, baudrate=baud, timeout=0.5)
        time.sleep(0.1)
        s.write(b"V\r")
        time.sleep(0.1)
        resp = s.read(32)
        s.close()
        if resp:
            print(f"{baud}: {resp}")
    except Exception as e:
        print(f"{baud}: error - {e}")
```

**Reading the result:**

| Response at the working baud rate | Interface to use |
|-----------------------------------|-----------------|
| Starts with `\xaa` (e.g. `b'\xaa\xc8...'`) | **seeedstudio** |
| Readable ASCII (e.g. `b'V1010\r'`) | **slcan** |
| All `\xff` at every baud rate | Adapter may need a driver - check manufacturer |

---

### Known devices quick reference

| Device | Where it appears | Interface |
|--------|-----------------|-----------|
| FYSETC UCAN (STM32F072) | USB devices - no COM port | gs_usb |
| CANable 2.0 Pro (Candlelight firmware) | USB devices - no COM port | gs_usb |
| CANable 1.0 (Candlelight firmware) | USB devices - no COM port | gs_usb |
| CANable 1.0 (slcan firmware) | COM port | slcan |
| GY USB-CAN Analyzer | COM port | seeedstudio |
| Seeed Studio USB-CAN Analyzer | COM port | seeedstudio |
| Cheap "USB CAN Analyzer" from Amazon/AliExpress | COM port | seeedstudio (most likely) |
| PEAK PCAN-USB | CAN-Hardware in Device Manager | pcan |
| Kvaser | CAN-Hardware in Device Manager | kvaser |
| No hardware | - | virtual |

> **CANable 2.0 clones** - CANable 2.0 *Pro* ships with Candlelight firmware (gs_usb).
> Cheaper clones may ship with slcan firmware instead. Check Device Manager -
> if it shows a COM port, use slcan.

---

### Still not sure?

Open an issue on GitHub with:
- The device name / Amazon listing name / Web Link
- Output of the identification script above

We will identify it and add it to the table.