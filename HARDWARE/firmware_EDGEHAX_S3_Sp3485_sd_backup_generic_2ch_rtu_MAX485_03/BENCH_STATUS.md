# FloodGuard Edgehax S3 — Bench Status & Resumption Guide
**Last updated: 2026-06-04**

---

## Board Confirmed Working

| Item | Value |
|------|-------|
| Module | ESP32-S3-WROOM-1 N16R8 |
| Port | COM16 |
| PlatformIO board | `4d_systems_esp32s3_gen4_r8n16` |
| Variant | esp32_s3r8n16 — qio_opi, 16MB flash, 8MB OPI PSRAM |
| Flash env | `pio run -e floodguard_edgehax_s3_dev -t upload` |
| Monitor | `pio device monitor -e floodguard_edgehax_s3_dev` |

---

## What Is Working ✅

- PSRAM 8MB OPI — InternalFlashFifo 197KB allocated in PSRAM
- WiFi connects (dev env hardcoded: SSID=jenix123)
- MQTT connected to `api.floodguard.iotsoft.in`
- Telemetry publishing every 180s → `[TELE] telemetry → MQTT OK`
- LED polarity confirmed: `HIGH = ON` (bench tested)
- All relays + RF outputs OFF at boot
- RTU right bus UART2 GPIO38/39/47 initialized OK
- SD absent → graceful fallback to InternalFlashFifo (retries every 30s)
- DYP-A01 sensor via RS485 path — valid frames, stable distance readings ✅ (2026-06-01)
- L1 confirmation input GPIO4 — INPUT_PULLUP, LOW=active, tested ✅ (2026-06-01)
- L2 confirmation input GPIO5 — INPUT_PULLUP, LOW=active, tested ✅ (2026-06-01)
- FSM ALERT_MISMATCH — correctly fires when L1/L2 active but DYP level=0 ✅ (2026-06-01)

---

## LED Behavior (bench confirmed)

| LED | GPIO | Color | State | Pattern |
|-----|------|-------|-------|---------|
| No DYP sensor connected | 40 | Orange | SENSOR_FAULT | Rapid strobe 100ms |
| No SD card | 41 | White | SD_WARNING | Double blink 5s cycle |
| MQTT + sensor OK | 42 | Green | CLOUD_CONNECTED | Solid |
| Blue fixed | — | Blue | Module power LED | Not firmware controlled |

---

## Known Hardware Conflict — Resolved by Candidate Remapping

**GPIO35/36/37 = OPI PSRAM data lines on N16R8 — CANNOT be used as UART.**
Original spec assigned these to left RS485 bus. Candidate fix applied (see §2 Pending Tasks).

**Candidate left bus: GPIO15 (RX), GPIO2 (TX), GPIO19 (RTS)**
GPIO19 = USB D- intentionally repurposed. Native USB unavailable in field profile.
Firmware PSRAM guard updated to block GPIO33–37 (covers full Octal PSRAM range).

---

## Pending Tasks Before Production

### 1. SD Card Test (tomorrow — need card adapter)

**Problem:** 64GB SDXC card fails SCR handshake at default 20MHz clock.
Error seen: `sdmmc_check_scr: send_scr returned 0xffffffff`

**Fix already applied in `src/sd_fifo.cpp`:**
- Tries 4-bit mode at 4MHz first
- Falls back to 1-bit mode at 4MHz if that fails
- Serial output will say: `[SD] Mounted in 4-bit mode` or `[SD] Mounted in 1-bit mode`

**Before inserting SD card — FORMAT IT FIRST:**
1. Insert 64GB card into PC via adapter
2. Use [SD Card Formatter](https://www.sdcard.org/downloads/formatter/) (official, free) — Quick Format
3. Or: Windows right-click → Format → **FAT32**, allocation size **32768 (32KB)**
4. 64GB cards ship as exFAT — ESP32 SD_MMC only supports FAT32, exFAT will always fail

**Steps after formatting:**
1. Close serial monitor (release COM16)
2. Flash: `pio run -e floodguard_edgehax_s3_dev -t upload`
3. Open monitor: `pio device monitor -e floodguard_edgehax_s3_dev`
4. Insert formatted SD card
5. Check for `[SD] Mounted in 4-bit mode` in serial output
6. Check White LED (GPIO41) goes off after SD mounts

---

### 2. Left RTU Bus — Approved Candidate Mapping (pending bench test)

Original spec GPIO35/36/37 blocked by OPI PSRAM on N16R8.
Only 2 free pads from Edgehax safe list: GPIO2 and GPIO15.
GPIO19 (USB D-) used for RTS — native USB intentionally unavailable in field profile.

| Signal | GPIO | Note |
|--------|------|------|
| Left RX | **GPIO15** | Free, no conflicts |
| Left TX | **GPIO2** | Free, no conflicts |
| Left RTS/DE | **GPIO19** | USB D- repurposed — USB not needed in field |

**Wire the left SmartElex SP3485 breakout as:**
- SP3485 TX-0 → ESP32 **GPIO15** (RX into S3)
- SP3485 RX-1 → ESP32 **GPIO2** (TX from S3)
- SP3485 RTS → ESP32 **GPIO19** (direction control)
- SP3485 VCC → 3.3V, GND → GND
- A/B terminals → J2 RS485 bus to remote left box (slave ID 11)

Right bus: GPIO38 (RX), GPIO39 (TX), GPIO47 (RTS) — unchanged from spec.

**Mapping freezes to FLOODGUARD-S3-EDGEHAX-N16R8-02 only after bench checklist passes.**

---

### 3. DYP-A01 Sensor — CONFIRMED WORKING via RS485 (2026-06-01)

**Final confirmed wiring (do not change):**

```
Sensor box:
  DYP-A01  VCC  (red)    → 5V
  DYP-A01  GND  (black)  → sensor box GND
  DYP-A01  TX   (WHITE)  → MAX485 auto-direction module TTL input
  DYP-A01  RX   (yellow) → FLOATING — do not connect

RS485 cable (3 wires, sensor box → MCU box):
  A  →  A
  B  →  B
  GND → GND   ← MANDATORY — common ground both sides

MCU box — SmartElex SP3485:
  A/B terminals ← from RS485 cable
  RO  (Receiver Output) → ESP32-S3 GPIO21
  RTS → GND (short these two pins together, forces receive-only)
  RX  → floating / not connected
  VCC → 3.3V,  GND → GND
```

**Wire colour truth (bench verified):**
- WHITE = DYP TX (sensor output) — connect this to MAX485
- YELLOW = DYP RX/trigger — leave floating (sensor auto-outputs continuously)

**Firmware:** `src/dyp_sensor.cpp` uses UART2 (`HardwareSerial(2)`) on GPIO21 at 9600 8N1.
300ms intra-frame wait implemented — do not remove.

**Expected monitor output when working:**
```
[DYP_FRAME] FF 04 C0 C3  csum_ok=Y  d=1216mm
[SENSOR] dist=1216mm  lvl=...mm  valid=Y  |  FSM=NORMAL
```

**Common failure modes:**
| Symptom | Cause |
|---------|-------|
| `valid=N`, all `FF FF FF FF` frames | GND wire missing between boxes |
| No frames at all (`avail=0`) | RS485 A/B swapped, or SmartElex RO not on GPIO21 |
| `valid=N`, csum_ok=N with real distances | A/B polarity reversed |
| `valid=N` even with good sensor and GND | Check SmartElex RTS is tied to GND |

---

### 4. Production Flash Prep

Before flashing to field device, update `platformio.ini` production env:
```ini
-DDEVICE_ID_SEED=\"RUB-CTRL-02\"           ; real device ID
-DDEVICE_TOKEN_SEED=\"actual_token_here\"   ; real device token from backend
-DLOCATION_ID_SEED=\"RUB-SITE-01\"
```
Or pass via CLI: `pio run -e floodguard_edgehax_s3 -t upload -DDEVICE_ID_SEED=...`

---

## GPIO Quick Reference

| GPIO | Function | Direction | Notes |
|------|----------|-----------|-------|
| 1 | Battery ADC | IN | Divider ratio 5.0 |
| 4 | Level confirm 1 | IN | INPUT_PULLUP, LOW=active |
| 5 | Level confirm 2 | IN | INPUT_PULLUP, LOW=active |
| 6 | Relay siren | OUT | LOW=ON |
| 7 | Relay flash | OUT | LOW=ON |
| 8 | Relay voice (future) | OUT | LOW=ON |
| 9–14 | SD_MMC D2/D3/CMD/CLK/D0/D1 | — | SDMMC 4-bit |
| 16 | Relay sump pump | OUT | LOW=ON |
| 17 | RF danger siren | OUT | LOW=active |
| 18 | RF sump pump | OUT | LOW=active |
| 21 | DYP RX (UART2) | IN | Via SmartElex SP3485 RO — RS485 path |
| 35 | Left RS485 RX | — | **CONFLICT: OPI PSRAM — disabled** |
| 36 | Left RS485 TX | — | **CONFLICT: OPI PSRAM — disabled** |
| 37 | Left RS485 RTS | — | **CONFLICT: OPI PSRAM — disabled** |
| 38 | Right RS485 RX | IN | UART2, working |
| 39 | Right RS485 TX | OUT | UART2, working |
| 40 | LED Orange | OUT | HIGH=ON |
| 41 | LED White | OUT | HIGH=ON |
| 42 | LED Green | OUT | HIGH=ON |
| 47 | Right RS485 RTS | OUT | DE/RE control |
| 48 | Config button | IN | INPUT_PULLUP, LOW=pressed |

---

## Key Source Files

| File | Purpose |
|------|---------|
| `src/device_profile.h` | All GPIO pin defines, seeds, endpoints |
| `src/main.cpp` | Boot sequence, stack size override |
| `src/sd_fifo.cpp` | SD card mount with 4MHz fallback (updated) |
| `src/status_led.cpp` | All LED blink patterns |
| `src/rs485_rtu_master.cpp` | Modbus RTU with PSRAM pin guard |
| `src/dyp_sensor.cpp` | DYP-A01 UART2 parser — RS485 path via SmartElex SP3485 on GPIO21 |
| `src/telemetry_manager.cpp` | Telemetry JSON + MQTT publish |
| `platformio.ini` | Build envs — dev uses COM16/UART0 |

---

## Resume Command Sequence

```powershell
# From firmware directory:
cd "D:\IOT Device\RUB\FloodGuard\HARDWARE\firmware_EDGEHAX_S3_Sp3485_sd\firmware"

# Flash dev build
pio run -e floodguard_edgehax_s3_dev -t upload

# Monitor (open after flash)
pio device monitor -e floodguard_edgehax_s3_dev
```

---

## Generic RTU Relay Backup (2026-06-02)

This is the backup path if the custom FloodGuard C3 RTU slave is still blocked.

Bench result:
- Right RTU bus on the S3 is proven with a generic external Modbus relay module
- Right bus pins: GPIO38 = RX, GPIO39 = TX, GPIO47 = DE/RE
- Generic relay control and relay status readback both work over RS485

PlatformIO environments added:
- `floodguard_edgehax_s3_generic_relay_2ch_backup`
- `floodguard_edgehax_s3_generic_relay_4ch_backup`

2-channel backup mapping:
- Relay 1 = Siren
- Relay 2 = Flash

4-channel backup mapping:
- Relay 1 = Siren
- Relay 2 = Flash
- Relay 3 = Voice, follows Siren/Danger state
- Relay 4 = Spare, reserved for future Barrier use

Important limits:
- These generic relay modules do not provide battery ADC telemetry
- A 2-channel board cannot provide Voice or Barrier outputs
- The web UI now treats 2CH and 4CH boards separately because they use different Modbus maps

Addressing:
- Default address is usually `255`
- Address read/set is available from `/remote-test`
- Change address only when one relay module is connected on that bus
- Separate left/right buses are fine; both modules can stay `255` if they are on different buses
- If two modules share one RS485 bus, they must have unique addresses

---

## MAX485 Auto-Direction Variant (2026-06-03)

Folder:
- `D:\IOT Device\RUB\FloodGuard\HARDWARE\firmware_EDGEHAX_S3_Sp3485_sd_backup_generic_2ch_rtu_MAX485_03`

Purpose:
- Same generic relay backup logic as the SP3485 backup
- Converted for MAX485 / RS485-to-TTL auto-direction modules
- No manual DE/RE control wire is used

Important change from SP3485 version:
- Do not connect any RTS / DE / RE wire from S3
- This firmware variant overrides both left and right RTS pins to `-1`
- RTU code now skips DE/RE toggling and works in auto-direction mode

S3 right bus wiring with MAX485 module:
- `MAX485 TXD -> GPIO38`  (S3 RX)
- `MAX485 RXD -> GPIO39`  (S3 TX)
- `MAX485 GND -> S3 GND`
- `MAX485 VCC -> module supply`
- `A+ -> RS485 A`
- `B- -> RS485 B`

S3 left bus wiring with MAX485 module:
- `MAX485 TXD -> GPIO15`
- `MAX485 RXD -> GPIO2`
- `MAX485 GND -> S3 GND`
- `A+ -> RS485 A`
- `B- -> RS485 B`

Status at close of work:
- Firmware compile passed for `floodguard_edgehax_s3_generic_relay_2ch_backup` in this MAX485 folder
- This MAX485 variant was not flashed yet
- Planned next step: flash and bench-test tomorrow

Final state at close of work (2026-06-02):
- `COM3` is left flashed with `floodguard_edgehax_s3_generic_relay_2ch_backup`
- Running firmware version: `0.1.1-generic-2ch`
- Login password on S3 web UI: `Hanuman#2026`
- Use `/remote-test` for generic relay address, type, control, and status readback
- The `4CH` backup variant is built and ready, but not flashed

Current automatic runtime scope:
- The backup firmware auto-manages one relay module on the left bus and one relay module on the right bus
- Multiple relay modules on the same RS485 bus are electrically allowed if addresses are unique
- However, current flood runtime logic does not yet orchestrate more than one slave per side
- `/remote-test` can still manually talk to other slave addresses one at a time for bench work

Current source of truth for this backup path:
- Folder: `D:\IOT Device\RUB\FloodGuard\HARDWARE\firmware_EDGEHAX_S3_Sp3485_sd_backup_generic_2ch_rtu_2026_06_02`

---

## MAX485 Bench Continuation (2026-06-04)

Current flashed unit:
- Board on `COM7`
- Build/env: `floodguard_edgehax_s3_generic_relay_2ch_backup`
- Web UI reachable at:
  - `http://192.168.1.207/`
  - `http://fg-main-edgehax-01.local/`
- Login password: `Hanuman#2026`

Current right-side relay bench result:
- Right-side generic relay is working on the MAX485 auto-direction variant
- Confirmed working path:
  - open `/remote-test`
  - module type `2 Relay Module`
  - module address currently tested as `255`
  - manual `Relay 1 ON/OFF` and `Relay 2 ON/OFF` now work
- `Link` can become `OK` again after a fresh successful manual command

Important runtime behavior found during bench:
- The relay auto-OFF was not coming from telemetry
- The OFF command was coming from the main runtime logic in `src/main.cpp`
- In normal flood state, firmware calls `rem.setSirenFlash(false, false)` for remote boxes
- This means a manual relay ON from `/remote-test` will eventually be overridden when the flood state is normal

Manual override behavior now in this MAX485 backup build:
- Manual `/remote-test` actions suspend automatic remote relay control for `15 minutes`
- During that manual-override window, automatic remote OFF commands are not queued
- After the override window expires, normal flood runtime logic resumes
- If the system is still in `NORMAL` state at that time, remote relays will be commanded OFF by design

Why this matters for the DYP sensor connection:
- Once DYP is connected, remote relay behavior should be judged against the actual flood state machine
- Expected production behavior:
  - `NORMAL` state -> remote siren/flash OFF
  - `ALERT/DANGER` path -> remote outputs follow flood logic
- So a relay turning OFF later while the system remains `NORMAL` is expected runtime behavior, not necessarily an RS485 fault

Observed UI/RTU note:
- After an automatic OFF or an RTU timeout, `/remote-test` may show `Link` invalid or `No valid status yet`
- A fresh successful manual command can restore `Link = OK`
- This is a bench observation to revisit later if status-read stability is still important in production

Specific behavior for this generic `2CH` RTU relay module:
- `Read Relay Status` is not a reliable operator action for this module at present
- Even when `Link` is already `OK`, pressing `Read Relay Status` can make `Link` go invalid
- Manual relay commands are currently the reliable path:
  - pressing `Relay 1 ON` immediately updates `Link = OK` and relay status `ON`
  - pressing `Relay 1 OFF` immediately updates `Link = OK` and relay status `OFF`
  - same practical behavior applies to `Relay 2 ON/OFF`
- For field troubleshooting on this module, treat the ON/OFF command itself as the status refresh method
- Practical operator rule:
  - if relay is expected `ON`, pressing the same relay `ON` command again is the current safe way to confirm/update UI state
  - if relay is expected `OFF`, pressing the same relay `OFF` command again is the current safe way to confirm/update UI state
- So for this module family, command-and-refresh works better than explicit status-read polling

Correction to make later after DYP is connected:
- Re-test remote relay behavior with real `DYP + FSM` state transitions
- Confirm that remote OFF in `NORMAL` is acceptable for the final field logic
- If field troubleshooting needs longer manual hold or latch behavior, add an explicit manual-test mode or resume-auto button in `/remote-test`
- If this relay family remains deployed, consider changing the UI later so `Read Relay Status` is hidden, relabeled, or replaced with a safer module-specific refresh action
