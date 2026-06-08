# FloodGuard S3 — ST485 4CH + Waveshare RS485 Firmware Notes

**Firmware folder:** `firmware_EDGEHAX_S3_ST485_RTU4ch_WAVE485/firmware`  
**Firmware name:** `EH-S3-WSTTL-ST485-RL-MAX485-DYP-L1L2-LVT`  
**Active build flag:** `ST485_RTU4CH_WAVE485_MODE`  
**Version:** 0.2.0  &nbsp;|&nbsp; **Release date:** 2026-06-08  
**MCU board:** Edgehax ESP32-S3-WROOM-1 N16R8 (16 MB flash, 8 MB OPI PSRAM)

This document is the single source of truth for anyone working on this firmware. Read it before touching any file.

---

## 1. Firmware Name Decoded

`EH-S3-WSTTL-ST485-RL-MAX485-DYP-L1L2-LVT`

| Token | Meaning |
|-------|---------|
| `EH-S3` | Edgehax ESP32-S3 main controller board |
| `WSTTL` | Waveshare TTL-to-RS485 (B) auto-direction modules (for RTU buses) |
| `ST485-RL` | ST485-C10-05-4CH Modbus RTU 4-channel relay boards (remote alarms) |
| `MAX485` | MAX485 auto-direction module (for DYP sensor RS485 cable extension) |
| `DYP` | DYP-A01 ultrasonic water-level sensor |
| `L1L2` | Two alarm levels — Alert (Level 1) and Danger (Level 2) |
| `LVT` | Low Voltage Threshold — remote battery monitoring via LM393 comparator |

---

## 2. What This Firmware Does

The ESP32-S3 ("S3 main panel") is the FloodGuard central controller. It:

1. Reads water level from a DYP-A01 ultrasonic sensor over UART (extended via MAX485 auto modules over RS485 cable)
2. Runs a flood state machine: SAFE → ALERT → DANGER
3. On alarm: sends Modbus RTU FC5 commands over two RS485 buses to ST485-C10-05-4CH relay boards
4. Confirms relays physically operated by reading NC dry-contact feedback via FC2 Discrete Inputs
5. Publishes telemetry and alarms to cloud via MQTT over WiFi

---

## 3. Hardware

### 3.1 S3 Main Board

| Part | Detail |
|------|--------|
| MCU | Edgehax ESP32-S3-WROOM-1 N16R8 |
| PlatformIO board ID | `4d_systems_esp32s3_gen4_r8n16` |
| Flash | 16 MB (partition: `partitions_16mb.csv`) |
| PSRAM | 8 MB OPI — **GPIO33–37 are occupied, NEVER use as IO** |

### 3.2 Full Hardware Architecture

```
                         ┌─────────────────────────────────────────┐
                         │           ESP32-S3 (Edgehax)             │
DYP-A01 sensor           │                                          │
  [flood point]          │  UART1 GPIO21 ◄──MAX485 auto◄──[RS485]──►MAX485 auto │
                         │                                          │
  Siren/Flash/Voice      │  UART2 left ──►Waveshare(B)──►[RS485 ~100m]──►ST485-4CH [Zone A]
  2–3m from ST485 board  │                                          │
                         │  UART2 right ──►Waveshare(B)──►[RS485 ~100m]──►ST485-4CH [Zone B]
  LM393 battery low      │                                          │
  12V battery system     └─────────────────────────────────────────┘
```

**Key point — DYP via MAX485:** The DYP sensor is at the flood measurement point, connected to the S3 via RS485 cable using MAX485 auto-direction modules at both ends. From the firmware's perspective, it is still just UART1 on GPIO21 — the MAX485 modules are transparent hardware. No firmware change is needed to switch from direct TTL to MAX485-extended wiring; only the hardware wiring changes.

### 3.3 RS485 Modules — RTS = -1 Means NO Direction Pin

**Both the Waveshare TTL-to-RS485 (B) and the MAX485 auto-direction variant are auto-direction modules.** They detect TX activity internally and switch between transmit and receive automatically. No DE/RE pin needs to be driven by the MCU.

`PIN_LEFT_RS485_RTS = -1`, `PIN_RIGHT_RS485_RTS = -1` does NOT mean "using RTS." It is the firmware's way of saying "this bus has no direction-control pin at all." The code in `rs485_rtu_master.cpp` checks `if (rtsPin >= 0)` before touching any GPIO. With `-1`, that block is completely skipped for both buses.

### 3.4 Remote Relay Boards — ST485-C10-05-4CH

- 4 relay outputs (R1–R4), 4 digital inputs (IN1–IN4)
- Modbus RTU slave, factory default slave ID = **1**
- Protocol: FC5 for relay control, FC1 for relay readback, FC2 for digital inputs
- Needs **external 120 Ω termination resistor** soldered between A+ and B- terminals at the far end

### 3.5 Cable

- **Cat6**, initial deployment ~100 m per bus (site technician to confirm actual distance)
- 120 Ω termination at **both ends** of each cable (see Section 13)

---

## 4. Pin Assignments

### RS485 Bus Pins (UART2, remapped per transaction)

| Bus | RX | TX | RTS | Note |
|-----|----|----|-----|------|
| Left (Zone A) | GPIO15 | GPIO2 | -1 | No direction pin — Waveshare auto |
| Right (Zone B) | GPIO38 | GPIO39 | -1 | No direction pin — Waveshare auto |

**Why UART2 is remapped per transaction:** Only one UART2 peripheral exists. `rs485_rtu_master.cpp` calls `rtuSerial.end()` + `rtuSerial.begin(newRx, newTx)` before each transaction to switch between buses. Adds ~5 ms overhead but is reliable.

**GPIO33–37 are forbidden** — occupied by OPI PSRAM on N16R8. `rtuPinsOk()` in `rs485_rtu_master.cpp` enforces this at runtime and logs a warning if violated.

### Other Pins

| Function | GPIO |
|----------|------|
| DYP sensor RX (via MAX485) | 21 |
| DYP sensor TX | -1 (sensor auto-TX, S3 never transmits) |
| Confirm Level 1 (dry contact input) | 4 |
| Confirm Level 2 (dry contact input) | 5 |
| Local relay: siren | 6 |
| Local relay: flash | 7 |
| Main battery ADC | 1 |
| Config button | 48 |
| LED orange | 40 |
| LED white | 41 |
| LED green | 42 |

---

## 5. Modbus RTU Protocol

### 5.1 Slave IDs

Both ST485 boards use slave ID **1** (factory default).

No address collision because each bus is electrically separate (dedicated UART2 remap, different Cat6 cables). The S3 communicates with each board on its own wire, never simultaneously.

To change the slave ID: send a Modbus write to the ST485 board (see ST485 datasheet), then update `RTU_SLAVE_ID_LEFT_BOX` / `RTU_SLAVE_ID_RIGHT_BOX` in `device_profile.h` under `#ifdef ST485_RTU4CH_WAVE485_MODE`.

### 5.2 Function Codes Used

| FC | Name | Purpose |
|----|------|---------|
| FC1 (0x01) | Read Coils | Read relay output state from RTU (dashboard display) |
| FC2 (0x02) | Read Discrete Inputs | Read IN1–IN4 physical state (NC feedback + battery low) |
| FC5 (0x05) | Write Single Coil | Turn relays ON or OFF |

### 5.3 ST485 Coil Addresses (FC5 / FC1)

| Coil addr | Relay | Function |
|-----------|-------|----------|
| 0 | R1 | Siren |
| 1 | R2 | Flash light |
| 2 | R3 | Voice announcement |
| 3 | R4 | Boom barrier — **reserved, always OFF** (see Section 9) |

FC5 ON value: `0xFF00`. OFF value: `0x0000`.

### 5.4 ST485 Discrete Input Addresses (FC2)

| DI addr | Input | Wired to |
|---------|-------|----------|
| 0 | IN1 | NC contact of R1 (siren relay feedback) |
| 1 | IN2 | NC contact of R2 (flash relay feedback) |
| 2 | IN3 | NC contact of R3 (voice relay feedback) |
| 3 | IN4 | LM393 comparator output (battery low detection) — see Section 8 |

---

## 6. NC Feedback Wiring — 12V Positive Switching

**Use 12V positive switching. Do NOT switch the GND.**

### Correct wiring

```
+12V PSU ──── NC contact of relay ──── IN terminal of ST485
                                              │
                                    (ST485 internal pull-down to GND)
```

| Relay state | NC contact | Voltage at IN | DI bit |
|---|---|---|---|
| Relay **OFF** (idle) | NC **closed** | +12V | **1** |
| Relay **ON** (operated) | NC **open** | 0V (pull-down) | **0** |

### Why 12V switching and not GND switching

- ST485 digital inputs are optocoupled, positive-logic (voltage = active). Switching +12V gives clean defined levels.
- GND switching leaves one side of the opto permanently at 12V with only a floating return — undefined behaviour with cable capacitance.
- Short cable (2–3 m from relay to ST485 board) means no voltage drop concern.

### Firmware consequence — DO NOT change without updating code

After commanding relay **ON**: firmware expects DI bit = **0** (NC opened)  
After commanding relay **OFF**: firmware expects DI bit = **1** (NC closed)

This is implemented in `processConfirmation()` in `remote_box_manager.cpp`:
```cpp
bool sirenOk = cs.wantSiren ? ((diBits & 0x01U) == 0)   // commanded ON → expect bit=0
                             : ((diBits & 0x01U) != 0);  // commanded OFF → expect bit=1
```
If you ever change to GND switching or invert the wiring, flip both conditions.

---

## 7. Relay Output Mapping

| Relay | Function | Logic |
|-------|----------|-------|
| R1 | Siren | ON during alarm (ALERT or DANGER per config) |
| R2 | Flash light | ON during alarm |
| R3 | Voice announcement | **Always mirrors R1** — same ON/OFF as siren |
| R4 | Boom barrier | **Always OFF** — reserved for future hardware (see Section 9) |

R3 mirrors R1 because the voice announcement plays for the same duration as the siren. Hardcoded in `sendCommands()`:
```cpp
const bool voiceOn = sirenOn;  // R3 follows siren
```

---

## 8. IN4 — Battery Low (LM393 Comparator)

**Hardware not yet on site. This section will be confirmed when LM393 arrives.**

Assumed wiring (standard LM393 open-collector with pull-up):
- Battery voltage (via resistor divider) → IN+ (non-inverting input)
- Reference threshold voltage → IN- (inverting input)
- Pull-up resistor (e.g. 10 kΩ) on LM393 output → 12V → IN4 terminal of ST485

| Battery state | LM393 output | IN4 value |
|---|---|---|
| Battery OK (IN+ > IN-) | HIGH (pull-up active) | **1** |
| Battery critically low (IN+ < IN-) | LOW (open-collector pulls down) | **0** |

Firmware reads: `di_batteryLow = true` when IN4 bit = 0.

**If your LM393 is wired with inputs swapped** (threshold on IN+, battery on IN-), IN4 logic is inverted. Fix in `pollST485Box()` in `remote_box_manager.cpp`:
```cpp
// Change this line:
status.di_batteryLow = ST485::batteryLow(diBuf[0]);  // current: bit=0 → low
// To this if wiring is inverted:
status.di_batteryLow = (diBuf[0] & 0x08U) != 0;     // bit=1 → low
```

---

## 9. R4 Boom Barrier — Reserved

R4 is the 4th relay on the ST485 board. It is wired to a boom barrier (vehicle gate) at the site. The barrier hardware has **not yet been approved or installed**. R4 is always commanded OFF in the current firmware.

**When the client activates boom barrier:**

1. Install and wire the boom barrier hardware to relay R4 contacts
2. Change one line in `sendCommands()` inside `#ifdef ST485_RTU4CH_WAVE485_MODE` in `remote_box_manager.cpp`:
   ```cpp
   // Current (always off):
   if (!writeST485Outputs(bus, slaveId, sirenOn, flashOn, voiceOn, false)) {
   // Change last arg to true on DANGER:
   if (!writeST485Outputs(bus, slaveId, sirenOn, flashOn, voiceOn, fsm.state == FloodState::DANGER)) {
   ```
3. Rebuild firmware (bump version + date in `platformio.ini`)
4. Deploy via OTA (see Section 11) — no physical access needed

---

## 10. RTU State Machine

Each remote box (left and right) independently tracks a health state in `RemoteBoxStatus::rtuState`:

```
               First poll success
     Start ──────────────────────► ONLINE ◄──── comm returns + batt OK
     (COMM_LOST)                      │
                                      │ IN4=LOW (battery critical)
                                      ▼
                                 LOW_BATTERY
                                      │
                                      │ comm lost
                                      ▼
                                 LVD_TRIPPED   (LVD relay cut power, expected)
                                 
     ONLINE ────── comm lost ────► COMM_LOST
```

**LVD_TRIPPED** = comms lost *after* the battery was already reporting low. The LVD (Low Voltage Disconnect) relay cut 12V to protect the battery. This is expected — not a hardware fault. The cloud shows it distinctly from a genuine comm failure.

State is in-memory only (not NVS-persisted). All boxes restart as COMM_LOST on S3 reboot.

---

## 11. OTA Firmware Update

### Local web UI OTA — Available Now

1. Build new firmware: `pio run -e floodguard_edgehax_s3_st485_wave485`
2. Binary at: `.pio/build/floodguard_edgehax_s3_st485_wave485/firmware.bin`
3. Connect to S3 WiFi → open web UI → navigate to **OTA** tab
4. Select the `.bin` file → click **Upload & Flash** → device reboots automatically

**OTA is blocked** while alarm (ALERT/DANGER) or pump is active. Wait for safe state or reboot the device first.

### Cloud OTA — Not Yet Implemented

`OtaManager::loop()` is currently empty (stub only). The cloud OTA URL (`flash.iotsoft.in`) and channel (`stable`) are defined in `device_profile.h` but not connected to any polling logic. Cloud push OTA is a future task.

---

## 12. Key Source Files

| File | Role |
|------|------|
| `device_profile.h` | All pin assignments and hardware constants. ST485 slave ID, firmware name/date overrides at the bottom under `#ifdef ST485_RTU4CH_WAVE485_MODE`. |
| `rs485_rtu_master.h/cpp` | Low-level Modbus RTU: FC1, FC2, FC5, FC6, FC16. UART2 remapped per transaction. Timing constants at top of .cpp. |
| `remote_box_manager.h/cpp` | High-level remote relay logic: poll, command, confirm, state machine. All ST485 mode code is inside `#ifdef ST485_RTU4CH_WAVE485_MODE` blocks. |
| `flood_state_machine.h/cpp` | SAFE/ALERT/DANGER state machine driven by water level. Calls `RemoteBoxManager::setSirenFlash()`. |
| `ota_manager.h/cpp` | Handles local web UI firmware upload. Cloud OTA loop is stub — not implemented. |
| `local_webserver.cpp` | Web UI: status page, config, calibration, relay test, OTA upload. |
| `config_manager.h/cpp` | NVS-persisted config (WiFi, thresholds, calibration). |
| `mqtt_manager.h/cpp` | Cloud telemetry and alarm publishing. |
| `platformio.ini` | Build environments — see Section 13. |

---

## 13. Build Environments

| Environment | Use for |
|---|---|
| `floodguard_edgehax_s3_st485_wave485` | **Production flash** — BLE provisioning on first boot |
| `floodguard_edgehax_s3_st485_wave485_dev` | **Bench/dev** — WiFi hardcoded (`jenix123`/`Kherli@321`), no BLE |

```bash
# Production flash
pio run -e floodguard_edgehax_s3_st485_wave485 -t upload

# Dev bench flash
pio run -e floodguard_edgehax_s3_st485_wave485_dev -t upload

# Serial monitor (shows FW name, version, date on boot)
pio device monitor --baud 115200
```

**When releasing a new version:** Update `FIRMWARE_VERSION` and `FIRMWARE_DATE` in `platformio.ini` for both ST485 environments. The web UI and serial log both read these at compile time.

**DO NOT flash `_dev` to field devices** — hardcoded WiFi credentials.

---

## 14. 120 Ω Termination Checklist

Required at **both ends** of each 500 m cable. Missing termination causes reflections — symptom is intermittent `[RTU] RX: 0 bytes (timeout)` in serial log.

| Location | How |
|---|---|
| S3 side — Waveshare left bus module | Enable the solder jumper on the Waveshare TTL-to-RS485 (B) board |
| S3 side — Waveshare right bus module | Same — separate module |
| Remote site — ST485 board left bus | Solder 120 Ω resistor between A+ and B- screw terminals |
| Remote site — ST485 board right bus | Same |

---

## 15. Adding New Features

### Activate boom barrier (R4)
See Section 9 — one line change in `sendCommands()`, then OTA update.

### Change relay mapping
Edit only `sendCommands()` in `remote_box_manager.cpp` inside `#ifdef ST485_RTU4CH_WAVE485_MODE`.
Also update `ConfirmState` fields (`wantSiren`/`wantFlash`/`wantVoice`) if the relay now needs confirmation.

### Add a new DI input
1. Add constant to `namespace ST485` in `remote_box_manager.cpp`
2. Read the new bit in `pollST485Box()` after the FC2 call
3. Add a field to `RemoteBoxStatus` in `remote_box_manager.h`

### Change slave ID at the remote board
Program the ST485 board via Modbus (see ST485 datasheet), then update `RTU_SLAVE_ID_LEFT_BOX` / `RTU_SLAVE_ID_RIGHT_BOX` in `device_profile.h` and rebuild.

### Change confirmation timing
In `sendCommands()`: `millis() + 3000UL` = first check after 3 s  
In `processConfirmation()`: `millis() + 5000UL` = retry check after 5 s

---

## 16. Known Limitations / Future Work

| Item | Status |
|------|--------|
| R4 boom barrier | Always OFF. Enable when hardware is installed — see Section 9 for exact change. OTA update possible; no site visit needed. |
| Cloud OTA | `OtaManager::loop()` is a stub. URL (`flash.iotsoft.in`) defined but not connected. Needs implementation. |
| IN4 LM393 polarity | Assumed LOW = battery critical. **Must verify with hardware team when LM393 board arrives on site.** |
| Baud rate sweep | Not implemented. Planned: sweep 9600→115200 to estimate cable length from highest reliable baud. |
| RTU state across S3 reboot | Not NVS-persisted. All boxes restart as COMM_LOST and re-detect on first poll (~30 s after boot). |
| Cable distance | Initial deployment ~100 m. Site technician to confirm actual distance. No firmware change needed for distance — only baud rate matters, and 9600 baud works reliably up to 500 m on Cat6. |
