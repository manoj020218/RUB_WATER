# ESP32-C3 Smart Dual-Level Water Switch Module

Secondary sensor module for FloodGuard.  
Converts a DYP-A01CNYUB-2.1 TTL ultrasonic sensor into two configurable relay outputs (Alert & Danger) that plug directly into the ESP32-S3 main panel as dry contacts.

---

> ## ⚠️ APPROVED HARDWARE — DO NOT SUBSTITUTE
>
> **This firmware is tested and approved ONLY for the `C3-SUPERMINI-V1601` board.**
>
> Do NOT flash this firmware onto any other ESP32-C3 variant (DevKitM-1, DevKitC-02, XIAO C3, etc.).  
> Other boards may have different GPIO assignments, LED polarity, USB/UART wiring, or flash layout that will cause incorrect behaviour or hardware damage.
>
> **Approved MCU board: `C3-SUPERMINI-V1601`**

---

## Hardware

| Component | Part | Notes |
|-----------|------|-------|
| MCU | **C3-SUPERMINI-V1601** | Only approved board — see warning above |
| Sensor | DYP-A01CNYUB-2.1 UART auto-mode waterproof ultrasonic | |
| Relay module | Dual-channel, active-LOW (most common boards) | |
| Status LED | Onboard blue LED on GPIO 8 (active-HIGH) | Built into C3-SUPERMINI-V1601 |

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

**Board required: C3-SUPERMINI-V1601** — connect via USB-C cable.

```bash
# Install PlatformIO CLI (or use VS Code PlatformIO extension)
pip install platformio

# Build
pio run -e esp32-c3-devkitm-1

# Flash — auto-detects port, or specify manually
pio run -e esp32-c3-devkitm-1 -t upload
pio run -e esp32-c3-devkitm-1 -t upload --upload-port COM14   # example port

# Monitor serial
pio device monitor --baud 115200
```

For flashing multiple boards in sequence, use the `flash_c3.bat` script in this folder — it builds once and loops, prompting you to plug in the next board each time.

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

## Thermal Management

The C3-SUPERMINI-V1601 is installed in a **sealed outdoor enclosure** where heat cannot escape by convection. Without mitigation the ESP32-C3 CPU and radio generate enough sustained heat to reduce long-term flash and capacitor reliability. The firmware applies five complementary layers — none of them affect alarm accuracy.

| Layer | Setting | Why it is safe |
|-------|---------|----------------|
| **CPU frequency** | 160 MHz → 80 MHz | All tasks (sensor UART, HTTP, relay state machine) complete with headroom at 80 MHz. Halves dynamic CPU power. |
| **Auto CPU light sleep** | Idles to 40 MHz; CPU halts during `delay()` | CPU wakes in < 1 ms on any interrupt (WiFi packet, UART byte, timer). WiFi AP hardware runs independently — beacon, HTTP responses, and relay GPIO are unaffected. Sensor UART FIFO buffers data between reads. At 1 s sensor interval + 50 ms loop delay the CPU is active < 5 % of the time. |
| **WiFi TX power** | 20 dBm → 8.5 dBm (~7 mW) | Device operates < 5 m from the technician's phone. 8.5 dBm gives ~15–20 m range in open air — far more than needed. Saves ≈ 40 % of RF transmit power. |
| **BLE advertising stops after 5 min** | `BLE_ADV_TIMEOUT_MS = 300 000 ms` | BLE is only needed at install time so the technician can find the device name in a BLE scanner. Once installed, continuous BLE advertising is wasted radio energy. Web UI, relays, and WiFi are unaffected. Reboot the device to re-advertise. |
| **Loop delay** | 10 ms → 50 ms awake / 200 ms WiFi-sleeping | Loop runs at 20 Hz instead of 100 Hz. Relay timer error: ±50 ms on a 60 s trigger delay = 0.08 % — completely negligible for flood control. When WiFi is already off (idle timeout), 200 ms is more than enough to detect a 3-second BOOT button hold. |
| **WiFi off after 30 min idle** | `WIFI_IDLE_TIMEOUT_MS = 1 800 000 ms` | If no browser has an active session for 30 minutes, the AP turns off entirely. Hold BOOT 3 s to wake via restart. |
| **Configurable sensor interval** | Default 1 s, range 100 ms – 180 s | Fewer ultrasonic reads = fewer UART transactions = fewer CPU wake-ups. Adjustable from the web UI without reflashing. |

### Performance impact summary

| What you care about | Impact of thermal measures |
|---------------------|---------------------------|
| Relay trigger timing | Governed by `trigger_delay_s` (default 60 s). Loop at 50 ms adds ≤ 50 ms timing jitter = 0.08 % error. |
| Sensor read accuracy | Interval respected to ± 50 ms. For a water-level sensor this is invisible. |
| Web UI response | ≤ 50 ms added latency before an HTTP request is processed. Imperceptible to a human. |
| BLE device discovery | Available for the first 5 minutes after each power-on. Enough for any installation workflow. |

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
