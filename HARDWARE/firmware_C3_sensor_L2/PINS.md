# ESP32-C3 Sensor Module — Field Reference

FloodGuard secondary sensor module (`firmware_C3_sensor_L2`).
Board: ESP32-C3-DevKitM-1 · Sensor: DYP-A01CNYUB-2.1

---

## GPIO Pin Map

| GPIO | Direction | Connected To | Purpose |
|------|-----------|--------------|---------|
| 20 | INPUT | DYP-A01CNYUB-2.1 **TX** | Sensor UART RX — receives distance frames (9600 baud, 3.3 V TTL). Yellow → 1kΩ → GPIO20 |
| 21 | OUTPUT | DYP-A01CNYUB-2.1 **RX** | Sensor UART TX — optional in auto-trigger mode, can be left unconnected |
| 4 | OUTPUT | Relay module **IN1** | Level 1 / Alert relay control (active-LOW) |
| 5 | OUTPUT | Relay module **IN2** | Level 2 / Danger relay control (active-LOW) |
| 8 | OUTPUT | Onboard blue LED | Status indicator (active-HIGH, built-in on DevKitM-1) |
| 9 | INPUT | BOOT button (onboard) | Maintenance recovery — hold on power-up to force SSID visible |

> **Relay logic:** Both relay pins are **active-LOW** — firmware drives the pin LOW to energise the relay coil, HIGH to release it.

---

## Power Wiring

| Pin | Purpose |
|-----|---------|
| 5 V (VIN / VBUS) | Sensor VCC ← **must be 5 V**, not 3.3 V (transducer needs 5 V to fire reliably) |
| 5 V or 3.3 V | Relay module VCC (check relay board datasheet) |
| GND | Common ground for sensor + relay + ESP32 |

> **Voltage divider on sensor TX (only if sensor TX is 5 V TTL):**
> `Sensor TX → 1 kΩ → GPIO 20 → 2 kΩ → GND`
> Most DYP-A01CNYUB-2.1 boards output 3.3 V TTL — no divider needed.

---

## Relay Output Contacts (to ESP32-S3 Main Panel)

| Relay | GPIO | Alarm Level | Dry-Contact Wiring |
|-------|------|-------------|-------------------|
| Relay 1 | 4 | Alert | COM + NO → S3 Level-1 dry-contact input |
| Relay 2 | 5 | Danger | COM + NO → S3 Level-2 dry-contact input |

---

## LED Behaviour (GPIO 8)

| LED Pattern | Meaning |
|-------------|---------|
| 3 fast blinks on power-up | Firmware started successfully |
| Fast blink — 10 Hz (100 ms ON / 100 ms OFF) | Relay 2 (Danger) is **active** |
| Slow blink — 0.5 Hz (500 ms ON / 500 ms OFF) | Relay 1 (Alert) is **active** |
| Solid ON for 30 seconds | Config or zero-calibration just **saved to NVS** |
| OFF | Idle — both relays off, sensor running normally |

Priority (highest first): Danger blink > Alert blink > Config-saved solid > Off.

---

## Relay FSM — How Triggering Works

```
water_level_mm  =  zero_distance_mm  −  raw_sensor_mm   (clamped to 0)

Relay OFF  →  ARMING   : water_level ≥ threshold  (starts timer)
ARMING     →  ON       : level stays above threshold for trigger_delay_s  (default 60 s)
ARMING     →  OFF      : level drops before timer expires
ON         →  CLEARING : water_level < (threshold − hysteresis)  (starts timer)
CLEARING   →  OFF      : level stays below for clear_delay_s  (default 300 s)
CLEARING   →  ON       : level rises again — cancel the clear timer

Sensor FAULT → relay state frozen (no false triggers)
```

| Parameter | Default | Relay 1 | Relay 2 |
|-----------|---------|---------|---------|
| Hysteresis | — | 30 mm | 50 mm |
| Trigger delay | 60 s | same | same |
| Clear delay | 300 s | same | same |

---

## Calibration — Setting Zero Reference

The sensor measures distance (mm) downward to the water/ground surface.
Zero reference = distance when dry. Water level = zero − raw.

**Example:** Zero = 2100 mm. When water rises 400 mm, raw drops to 1700 mm → water_level = 400 mm.

**Rule:** Level 1 and Level 2 thresholds **must be less than** zero_distance_mm.
If threshold ≥ zero, that level can never physically be reached.

**Steps:**
1. Mount sensor in final installed position, pointing at dry ground.
2. Open `http://192.168.4.1` → Calibration card shows live reading (e.g., 2100 mm).
3. Confirm reading is stable → click **Set Current Value as Zero Reference**.
4. Set Level 1 and Level 2 thresholds (must be < zero). Config page shows a hint:
   - Green: "Relay 1 alerts when water rises 200 mm above dry ground (sensor reads ≤ 1900 mm)"
   - If threshold ≥ zero: red warning shown, Save blocked.

---

## First-Time Setup

1. Power the device → 3 LED blinks confirm firmware running.
2. WiFi network **`FgSensXXXXXX`** appears (X = last 3 MAC bytes, e.g. `FgSens5E76A4`).
3. Connect (no password) → open `http://192.168.4.1`.
4. Login password: **`Hanuman#2026`**
5. Calibration card: confirm sensor reading is stable → click **Set Current Value as Zero Reference**.
6. Thresholds card: set Level 1, Level 2, Trigger Delay, Clear Delay → click **Save**.
7. Network Visibility card: click **Hide SSID** → device reboots, SSID disappears from public scans.

---

## SSID Visibility — Hide & Maintenance Recovery

### Hiding the SSID (after installation)

Config page → **Network Visibility** card → click **Hide SSID**.
- Saves `ssid_hidden = 1` to NVS and reboots.
- SSID no longer appears in public WiFi scans.
- Button becomes **Show SSID** when SSID is already hidden.

### Getting back for maintenance (3 methods)

**Method 1 — BLE scan (easiest, no physical access needed)**
- BLE advertisement is always active regardless of SSID state.
- Open any BLE scanner app (e.g., nRF Connect, BLE Scanner).
- Find device named **`FgSensXXXXXX`** — that name is also the WiFi SSID.
- On phone/laptop: connect to WiFi manually by typing the SSID name:
  - Android: WiFi → Add network → enter SSID → no password
  - iOS: WiFi → Other… → enter SSID → no password
  - Windows: WiFi → Manage known networks → Add → enter SSID

**Method 2 — BOOT button (physical access, no app needed)**
- Hold the **BOOT button** (onboard, near USB port) while powering on the device.
- Keep holding until the 3 startup LED blinks complete.
- Device boots with SSID visible for **this session only** — saved config unchanged.
- Connect normally, open config page, make changes.

**Method 3 — Known SSID (if MAC is recorded)**
- SSID is always `FgSens` + last 3 MAC bytes in HEX (uppercase).
- MAC printed on serial monitor at boot: `[WiFi] softAP 'FgSens5E76A4' OK`
- MAC also on the ESP32-C3 chip label or Device Manager (when connected via USB).
- Type SSID manually to connect even when hidden.

---

## Default NVS Values (stored, survive power cycles)

| Parameter | Default | NVS Key | Configurable via UI |
|-----------|---------|---------|---------------------|
| Zero reference distance | 1200 mm | `zero_mm` | Set Zero button |
| Level 1 Alert threshold | 200 mm | `l1_mm` | Yes |
| Level 2 Danger threshold | 400 mm | `l2_mm` | Yes |
| Trigger delay | 60 s | `trig_s` | Yes |
| Clear delay | 300 s | `clr_s` | Yes |
| SSID hidden | 0 (visible) | `ssid_hid` | Yes |
| HTTP login password | `Hanuman#2026` | — (compile-time) | No |
| Relay 1 hysteresis | 30 mm | — (compile-time) | No |
| Relay 2 hysteresis | 50 mm | — (compile-time) | No |

---

## HTTP API Endpoints

All endpoints require session cookie (`sess=<token>`) set after `/login`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Config + live readings page |
| GET/POST | `/login` | Login with password |
| GET | `/logout` | Invalidate session |
| GET | `/api/status` | JSON snapshot of all readings and config |
| POST | `/api/config` | Save thresholds and delays (JSON body) |
| POST | `/api/set-zero` | Save current raw distance as zero reference |
| POST | `/api/ssid-hidden` | Toggle SSID hidden/visible, reboots device |
| POST | `/api/reboot` | Reboot device |
| POST | `/update` | OTA firmware upload (multipart .bin) |

**Example `/api/status` response:**
```json
{
  "device_name": "FgSens5E76A4",
  "ble_id": "FgSens5E76A4",
  "raw_distance_mm": 1700,
  "zero_distance_mm": 2100,
  "water_level_mm": 400,
  "level1_threshold_mm": 200,
  "level2_threshold_mm": 400,
  "trigger_delay_s": 60,
  "clear_delay_s": 300,
  "ssid_hidden": false,
  "relay1": true,
  "relay2": true,
  "sensor_status": "OK",
  "uptime_seconds": 3600,
  "config_version": 5
}
```

---

## Sensor Frame Format (DYP-A01CNYUB-2.1)

```
Byte 0 : 0xFF   start byte
Byte 1 : H      distance high byte
Byte 2 : L      distance low byte
Byte 3 : SUM    (0xFF + H + L) & 0xFF

Distance mm = H × 256 + L
Valid range : 280 mm – 2500 mm
Baud rate   : 9600, 8N1, auto-send mode (~1 frame/second)
Returns 0x0000 when no echo received (target out of range or too close)
```

---

## OTA Firmware Update

1. Build: `pio run -e esp32-c3-devkitm-1` → binary at `.pio/build/esp32-c3-devkitm-1/firmware.bin`
2. Config page → **Firmware Update** section → select `.bin` → click **Upload Firmware**.
3. Progress bar fills → device reboots automatically on success.

---

## BLE

Device always advertises **`FgSensXXXXXX`** over BLE (advertisement-only, no GATT services).
Active even when WiFi SSID is hidden. Use any BLE scanner to identify the device on-site.

## Thermal Management (Outdoor Sealed Enclosure)

### Firmware (already applied)
| Setting | Value | Reason |
|---------|-------|--------|
| CPU frequency | 80 MHz (↓ from 160) | ~40% less dynamic power, significant temp drop |
| WiFi TX power | 11 dBm (↓ from 20) | Short-range AP only — phone is 1–3 m away |

### Hardware (installer's side)

**Most impactful:**
1. **White or light-grey enclosure** — black box in direct sun absorbs 3–4× more heat. White reflects it.
2. **Mount in shade** — even partial shade (parapet, pipe stub) drops enclosure temp 15–20°C vs direct sun.
3. **Aluminium enclosure** — conducts heat from chip to box wall far better than plastic. Whole box becomes a heatsink.
4. **Thermal pad** — 1–2 mm silicone thermal pad between back of ESP32-C3 and inside of metal lid. Costs ₹30–50.

**Secondary:**
5. **Orient vents downward** — hot air rises; downward vents prevent rain ingress while allowing convection.
6. **IP-rated vent plug** (Gore-Tex membrane) — pressure equalisation without water ingress. ₹20–40 on AliExpress.
7. **Leave gap between boards** — don't pack relay module tight against C3; a few mm gap prevents heat stacking.

> ESP32-C3 junction rated to 85°C. With firmware reductions + light-coloured box out of direct sun it stays well within limit. 

To flash multiple boards: double-click flash_c3.bat from HARDWARE/firmware_C3_sensor_L2/

  - First run builds the firmware once (takes ~2 min)
  - Every subsequent board: plug in → press Enter → done in ~90 seconds
  - Type Q to exit when finished

  After each successful flash it prints the full setup checklist so the installer doesn't miss a step. If flashing fails it lists the exact   causes to check.
