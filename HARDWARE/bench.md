# FloodGuard Hardware Bench Notes

---

## Main Unit — Hardware Architecture (2026-06-22)

### Role: Main Control Unit (MCU)

The Edgehax ESP32-S3 board is the **Main Control Unit only**. It does NOT have:
- No pump relay
- No RF output
- No local relay for siren, flash, or voice

All siren / flash / voice relay outputs are **in the RTU boxes only** (remote_left = Left RTU, remote_right = Right RTU). The main unit controls these via RS485 Modbus.

### Main Unit Inputs / Outputs

| I/O | Type | GPIO | Notes |
|---|---|---|---|
| DYP water sensor | UART RX | GPIO21 | Via HW-726 auto-MAX485 module |
| L1 confirm input | Digital IN | GPIO4 | INPUT_PULLUP, LOW = active |
| L2 confirm input | Digital IN | GPIO5 | INPUT_PULLUP, LOW = active |
| INA219 SDA | I2C | GPIO47 | Battery voltage + current monitor |
| INA219 SCL | I2C | GPIO3 | GY-219 breakout, addr 0x40 |
| Left RTU RS485 TX | UART1 TX | GPIO17 | Waveshare auto-direction (no DE/RE) |
| Left RTU RS485 RX | UART1 RX | GPIO18 | Same left header |
| Right RTU RS485 TX | UART2 TX | GPIO39 | Waveshare auto-direction (no DE/RE) |
| Right RTU RS485 RX | UART2 RX | GPIO38 | |
| Status LED orange | Digital OUT | GPIO40 | HIGH = ON |
| Status LED white | Digital OUT | GPIO41 | HIGH = ON |
| Status LED green | Digital OUT | GPIO42 | HIGH = ON |
| CONFIG button | Digital IN | GPIO48 | INPUT_PULLUP, hold 5s to factory reset |
| microSD | SDMMC 4-bit | GPIO9-14 | Offline telemetry FIFO |

**Relay pins GPIO6/7/8 are defined in firmware but nothing is wired to them on the main unit PCB.**

### RTU Boxes (remote_left / remote_right)

Each RTU box has:
- **Siren relay** (R1)
- **Flash relay** (R2)
- **Voice relay** (R3, follows siren)
- Battery monitor (reported via RS485 to main unit)
- RS485 Modbus slave (ST485-C10-05-4CH board)
- Left RTU slave ID: 11 | Right RTU slave ID: 12

### RS485 Notes

- Waveshare TTL-to-RS485 (B) auto-direction modules — no DE/RE pin needed
- Left RTU: dedicated UART1 (GPIO17 TX, GPIO18 RX)
- Right RTU: dedicated UART2 (GPIO39 TX, GPIO38 RX)
- No bus collision — each RTU has its own UART and cable

---

---

## DYP Sensor → HW-726 MAX485 → ESP32-S3 (2026-06-04)

### Objective
Replace the direct DYP TTL wiring on GPIO21 with a proper RS485 path using the HW-726 auto MAX485 module, so the DYP sensor's RS485 differential output is correctly received by the S3.

---

### Hardware Chain

```
DYP Sensor
  └─ built-in MAX485 chip (on sensor board)
       └─ RS485 differential  A+ / B-
            └─ HW-726 module (S3 side)
                 A+ / B-  →  receives RS485
                 RXD pin  →  TTL output to S3
                      └─ S3 GPIO21 (UART2 RX)
```

### HW-726 Module (TTL-to-RS485 auto converter)
- Chip: MAX485 (visible on PCB)
- Direction: **Auto** — no DE/RE pins, no firmware control needed
- TTL side pin order (top to bottom): GND · RXD · TXD · VCC
- RS485 side: A+ · B- · Shield/GND
- Supports 3.3V and 5V

### Wiring (only connections needed)

| HW-726 pin | Connect to |
|---|---|
| VCC | 3.3V |
| GND | GND |
| **RXD** | **S3 GPIO21** ← only signal wire |
| TXD | Not connected (DYP auto-sends, no query needed) |
| A+ | DYP RS485 A+ |
| B- | DYP RS485 B- |

---

### DYP Frame Protocol (confirmed from serial test)

Protocol: **4-byte, auto-send, 9600 8N1**

```
FF  HH  LL  CS
```

- `FF` — fixed start byte
- `HH LL` — distance in mm = `(HH << 8) | LL`
- `CS` — checksum = `(0xFF + HH + LL) & 0xFF`

Verified examples from serial log:
```
FF 08 3A 41  →  2106 mm   CS = (FF+08+3A)&FF = 41 ✓
FF 08 3B 42  →  2107 mm   CS = (FF+08+3B)&FF = 42 ✓
FF 08 3F 46  →  2111 mm   CS = (FF+08+3F)&FF = 46 ✓
FF 01 9B 9B  →   411 mm   CS = (FF+01+9B)&FF = 9B ✓
```

Valid range filter: 280 mm – 2500 mm (set in `dyp_sensor.cpp`).

---

### Code Change

File: `firmware_EDGEHAX_S3_Sp3485_sd_backup_generic_2ch_rtu_MAX485_03/firmware/src/dyp_sensor.cpp`

Function `readFrame()` — no other code touched.

**What changed:** Confirmed correct protocol is 4-byte with checksum.
During investigation, a 3-byte (no checksum) variant was tried briefly, but serial output from the sensor_test build showed the DYP sends a 4th checksum byte after every frame. Reverted to 4-byte with checksum validation — this is the correct and final state.

The `begin()` call was already correct for HW-726:
```cpp
dypSerial.begin(9600, SERIAL_8N1, 21, -1);  // RX=GPIO21, no TX
```
No DE/RE pin init needed — HW-726 handles direction automatically.

---

### Test Firmware

`firmware_rs485_loopback/src/main.cpp` was rewritten as a standalone DYP receive diagnostic (listens on GPIO21, prints raw hex + parsed distance). Flash with:
```
pio run -e esp32-s3-devkitc-1 -t upload --upload-port COMxx
```

---

### Flash Commands (production firmware)

```
# Sensor debug build (SENSOR_TEST_MODE — prints raw frames)
pio run -e floodguard_edgehax_s3_sensor_test -t upload --upload-port COM7

# Production build
pio run -e floodguard_edgehax_s3 -t upload --upload-port COM7
```

---

### Confirmed Working

- HW-726 RX LED blinks → RS485 signal arriving from DYP ✓
- Serial output: consistent `2106 mm` readings, FSM NORMAL ✓
- FSM transitions tested: moved hand near sensor → DANGER_WAITING → back to NORMAL ✓
- Production firmware flashed and running ✓
