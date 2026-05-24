# ESP32-C3 Smart Dual-Level Water Switch Module

Secondary sensor module for FloodGuard.  
Converts a DYP-A01CNYUB-2.1 TTL ultrasonic sensor into two configurable relay outputs (Alert & Danger) that plug directly into the ESP32-S3 main panel as dry contacts.

---

## Hardware

| Component | Part |
|-----------|------|
| MCU | ESP32-C3 (any dev board with GPIO 4, 5, 8, 20, 21) |
| Sensor | DYP-A01CNYUB-2.1 UART auto-mode waterproof ultrasonic |
| Relay module | Dual-channel, active-LOW (most common boards) |
| Status LED | Onboard blue LED on GPIO 8 (active-HIGH) |

---

## Wiring

### Sensor → ESP32-C3

DYP-A01CNYUB-2.1 TX is 3.3 V TTL — no level shift needed for most ESP32-C3 boards.  
If your sensor TX is 5 V, add a voltage divider (1 kΩ + 2 kΩ) on the RX pin.

```
Sensor VCC  → 5 V (or 3.3 V per sensor datasheet)
Sensor GND  → GND
Sensor TX   → GPIO 20 (ESP32-C3 UART1 RX)
Sensor RX   → GPIO 21 (ESP32-C3 UART1 TX) — optional in auto mode

Voltage divider if sensor TX is 5 V TTL:
  Sensor TX → 1 kΩ → GPIO 20
                          │
                         2 kΩ
                          │
                         GND
```

### Relay Module → ESP32-C3

```
Relay IN1  → GPIO 4  (Level 1 / Alert)
Relay IN2  → GPIO 5  (Level 2 / Danger)
Relay VCC  → 5 V or 3.3 V (per relay board)
Relay GND  → GND
```

Relay NC/NO contacts → ESP32-S3 main panel Level 1 / Level 2 dry-contact inputs.

### Status LED

```
GPIO 8 → 330 Ω → LED anode
LED cathode → GND
(ESP32-C3 DevKitM-1 has an onboard blue LED on GPIO 8 — no external LED needed)
```

---

## LED Behaviour

| Condition | LED |
|-----------|-----|
| Relay 2 (Danger) active | Fast blink 10 Hz (100 ms period) |
| Relay 1 (Alert) active | Slow blink 0.5 Hz (1000 ms period) |
| Config / zero saved | Solid ON for 30 seconds, then OFF |
| Idle / no alarm | OFF |

---

## Build & Flash

```bash
# Install PlatformIO CLI (or use VS Code PlatformIO extension)
pip install platformio

# Build
pio run -e esp32-c3-devkitm-1

# Flash (USB-C)
pio run -e esp32-c3-devkitm-1 -t upload

# Monitor serial
pio device monitor --baud 115200
```

---

## First-Time Setup

1. Power the device.
2. A Wi-Fi network named **FgSensXXXXXX** appears (X = last 3 MAC bytes).
3. Connect to that network (no password).
4. Open `http://192.168.4.1` in your browser.
5. Login password: **Hanuman#2026**
6. Point sensor at dry ground → click **Set Current Value as Zero**.
7. Set Level 1 and Level 2 thresholds → click **Save Thresholds**.
8. Settings are stored in NVS and survive power cycles.

---

## Default Values

| Parameter | Default |
|-----------|---------|
| Level 1 alert | 200 mm |
| Level 2 danger | 400 mm |
| Trigger delay | 60 s |
| Clear delay | 300 s |
| Relay 1 hysteresis | 30 mm |
| Relay 2 hysteresis | 50 mm |
| HTTP password | `Hanuman#2026` |

---

## Relay Logic

```
Relay ON  → water level >= threshold  continuously for trigger_delay (60 s)
Relay OFF → water level <  (threshold - hysteresis)  continuously for clear_delay (300 s)
Sensor FAULT → relay state is frozen (no false triggers)
```

---

## API Reference

All endpoints require the session cookie (`sess=<token>`) set after `/login`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/status` | JSON snapshot of all readings and config |
| POST | `/api/config` | `{"level1_threshold_mm":200,"level2_threshold_mm":400}` |
| POST | `/api/set-zero` | Saves current raw distance as zero reference |
| POST | `/api/reboot` | Reboots the device |
| POST | `/update` | Multipart firmware .bin upload (OTA) |

### Example status response

```json
{
  "device_name": "FgSensA1B2C3",
  "ble_id": "FgSensA1B2C3",
  "raw_distance_mm": 1000,
  "zero_distance_mm": 1200,
  "water_level_mm": 200,
  "level1_threshold_mm": 200,
  "level2_threshold_mm": 400,
  "relay1": true,
  "relay2": false,
  "sensor_status": "OK",
  "uptime_seconds": 12345,
  "config_version": 2
}
```

---

## OTA Firmware Update

1. Build new firmware: `pio run` → binary at `.pio/build/esp32-c3-devkitm-1/firmware.bin`
2. Open config page → **Firmware Update** section.
3. Select the `.bin` file and click **Upload Firmware**.
4. Progress bar fills; device reboots automatically on success.

---

## BLE

Device advertises its name (`FgSensXXXXXX`) over BLE for easy identification.  
BLE is advertisement-only — configuration is HTTP-only for now.

---

## Integration with ESP32-S3 Main Controller

```
C3 Relay 1 COM+NO ──→ S3 Level 1 dry-contact input  (Alert confirmation)
C3 Relay 2 COM+NO ──→ S3 Level 2 dry-contact input  (Danger confirmation)
```

No firmware change needed on the S3 side — the C3 module behaves identically to the original switch-type sensor.
