# FloodGuard S3 — ST485 4CH + Waveshare RS485 Firmware Notes

**Firmware folder:** `firmware_EDGEHAX_S3_ST485_RTU4ch_WAVE485/firmware`  
**Active build flag:** `ST485_RTU4CH_WAVE485_MODE`  
**Version:** 0.2.0  
**MCU board:** Edgehax ESP32-S3-WROOM-1 N16R8 (16 MB flash, 8 MB OPI PSRAM)

This document is the single source of truth for anyone working on this firmware. Read it before touching any file.

---

## 1. What This Firmware Does

The ESP32-S3 ("S3 main panel") is the FloodGuard central controller. It:

1. Reads a DYP-A01 ultrasonic water-level sensor (UART1, GPIO21)
2. Runs a flood state machine (SAFE → ALERT → DANGER)
3. On alarm: sends Modbus RTU FC5 commands over RS485 to **two ST485-C10-05-4CH relay boards** — one per zone (left bus = zone A, right bus = zone B), each located up to 500 m away
4. Confirms the relays physically operated by reading NC dry-contact feedback via FC2
5. Publishes telemetry and alarms to the cloud via MQTT over WiFi

---

## 2. Hardware

### 2.1 S3 Main Board

| Part | Detail |
|------|--------|
| MCU | Edgehax ESP32-S3-WROOM-1 N16R8 |
| Approved board ID | `4d_systems_esp32s3_gen4_r8n16` (PlatformIO) |
| Flash | 16 MB (partition: `partitions_16mb.csv`) |
| PSRAM | 8 MB OPI — **GPIO33-37 are occupied, never use as IO** |

### 2.2 RS485 Modules (S3 side)

**Waveshare TTL to RS485 (B)**  
Reference: https://www.waveshare.com/wiki/TTL_TO_RS485_(B)

- **Auto-direction** module — no DE/RE pin needed. The module detects TX activity and switches direction automatically.
- Connect only: TXD, RXD, GND, 3.3 V (or 5 V). Leave DE/RE unconnected.
- Has a solder jumper for 120 Ω line termination. **Enable the termination jumper on both end modules** (S3 side).
- One module per bus (left bus, right bus).

### 2.3 Remote Relay Boards

**ST485-C10-05-4CH Modbus RTU Relay Board**  
GitHub reference: `ST485-C10-XX-1CH-X-RTU-Modbus-Relay-main`

- 4 relay outputs (R1–R4), 4 digital inputs (IN1–IN4)
- Modbus RTU slave, factory default slave ID = **1**
- Protocol: FC5 (Write Single Coil) for relay control; FC1 (Read Coils) for status; FC2 (Read Discrete Inputs) for digital inputs
- Needs **external 120 Ω termination resistor** between A+ and B- at the far end (the board has no built-in termination jumper)
- Two boards deployed: one at end of left bus, one at end of right bus

### 2.4 Cable

- **Cat6**, 500 m per bus
- 120 Ω termination at both ends (Waveshare jumper at S3 end; external resistor at ST485 end)

---

## 3. Pin Assignments

### RS485 Bus Pins (UART2, remapped per transaction)

| Bus | RX | TX | RTS |
|-----|----|----|-----|
| Left (zone A) | GPIO15 | GPIO2 | –1 (auto-direction, no pin needed) |
| Right (zone B) | GPIO38 | GPIO39 | –1 (auto-direction, no pin needed) |

**Why RTS = -1:** The Waveshare TTL-to-RS485 (B) is an auto-direction module. Setting RTS = -1 in the firmware disables the DE/RE toggle logic entirely. The module handles direction switching internally. Defined in `device_profile.h` at the bottom:

```cpp
#undef PIN_LEFT_RS485_RTS
#define PIN_LEFT_RS485_RTS   (-1)
#undef PIN_RIGHT_RS485_RTS
#define PIN_RIGHT_RS485_RTS  (-1)
```

**Why UART2 is remapped per transaction:** There is only one UART2 peripheral. `rs485_rtu_master.cpp` calls `rtuSerial.end()` + `rtuSerial.begin(newRx, newTx)` before each transaction to switch between left and right bus. This adds ~5 ms overhead per bus switch but is correct and reliable.

**GPIO33-37 are forbidden** — occupied by OPI PSRAM on N16R8. The `rtuPinsOk()` function in `rs485_rtu_master.cpp` enforces this at runtime.

### Other Pins (unchanged from base firmware)

| Function | GPIO |
|----------|------|
| DYP sensor RX | 21 |
| Confirm Level 1 input | 4 |
| Confirm Level 2 input | 5 |
| Local relay: siren | 6 |
| Local relay: flash | 7 |
| Main battery ADC | 1 |
| Config button | 48 |
| LED orange | 40 |
| LED white | 41 |
| LED green | 42 |

---

## 4. Modbus RTU Protocol

### 4.1 Slave IDs

Both ST485 boards use slave ID **1** (factory default).

**Why there is no address collision:** Each bus (left, right) is electrically separate — dedicated UART2 remap, different Cat6 cables. The S3 talks to each board on its own wire, never simultaneously. Having the same slave ID on both boards is safe.

If you ever need to change the slave ID: send a Modbus write command to the ST485 board to reprogram it (see ST485 datasheet), then update `RTU_SLAVE_ID_LEFT_BOX` / `RTU_SLAVE_ID_RIGHT_BOX` in `device_profile.h`.

### 4.2 Function Codes Used

| FC | Name | Used for |
|----|------|----------|
| FC1 (0x01) | Read Coils | Read relay output state (dashboard display) |
| FC2 (0x02) | Read Discrete Inputs | Read IN1–IN4 physical state (confirmation + battery) |
| FC5 (0x05) | Write Single Coil | Turn relays ON or OFF |

### 4.3 ST485 Coil Addresses (FC5 / FC1)

| Coil address | Relay | Assigned function |
|---|---|---|
| 0 | R1 | Siren |
| 1 | R2 | Flash light |
| 2 | R3 | Voice announcement |
| 3 | R4 | Boom barrier (reserved, always OFF) |

FC5 ON value: `0xFF00`. OFF value: `0x0000`. Standard Modbus.

### 4.4 ST485 Discrete Input Addresses (FC2)

| DI address | Input | Wired to |
|---|---|---|
| 0 | IN1 | NC contact of R1 (siren relay feedback) |
| 1 | IN2 | NC contact of R2 (flash relay feedback) |
| 2 | IN3 | NC contact of R3 (voice relay feedback) |
| 3 | IN4 | LM393 voltage comparator output (battery low detection) |

---

## 5. NC Feedback Wiring — Critical Logic

**DO NOT change this without updating the confirmation logic in `remote_box_manager.cpp`.**

The relay boards at the remote site have their NC (Normally Closed) contacts wired back to IN1–IN3:

```
12V ──── NC contact of relay ──── IN1 (or IN2, IN3)
                                    │
                                   GND (via pull-down or internal)
```

| Relay state | NC contact | IN voltage | DI bit value |
|---|---|---|---|
| Relay **OFF** (coil de-energised) | NC **closed** | 12V → IN = HIGH | **1** |
| Relay **ON** (coil energised) | NC **open** | 0V → IN = LOW | **0** |

**Consequence for confirmation logic:**

- After commanding relay **ON**: expect DI bit = **0** (NC opened)
- After commanding relay **OFF**: expect DI bit = **1** (NC closed)

This is implemented in `processConfirmation()`:

```cpp
bool sirenOk = cs.wantSiren ? ((diBits & 0x01U) == 0)   // ON → expect bit=0
                             : ((diBits & 0x01U) != 0);  // OFF → expect bit=1
```

---

## 6. IN4 — Battery Low Detection (LM393)

**Assumed wiring (confirm with hardware team before changing):**

LM393 open-collector output with pull-up resistor → IN4:

- Battery voltage (via divider) on IN+ (non-inverting input)
- Reference threshold voltage on IN- (inverting input)
- Pull-up resistor on LM393 output → 12V

| Battery state | LM393 IN+ vs IN- | Output | IN4 value |
|---|---|---|---|
| Battery OK | IN+ > IN- | HIGH (pull-up) | **1** |
| Battery critically low | IN+ < IN- | LOW (open-collector pulls down) | **0** |

**Firmware reads it as:** `di_batteryLow = true` when `(diBuf[0] & 0x08) == 0` (IN4 bit = 0).

If your LM393 is wired with inverted inputs (threshold on IN+, battery on IN-), then IN4 logic is reversed. Fix it in `pollST485Box()` in `remote_box_manager.cpp`:
```cpp
status.di_batteryLow = ST485::batteryLow(diBuf[0]);
// Change ST485::batteryLow to check bit=1 instead of bit=0 if wiring is inverted.
```

---

## 7. Relay Output Mapping

| Relay | Function | Follows |
|---|---|---|
| R1 | Siren | Flood alarm state (DANGER or ALERT per config) |
| R2 | Flash light | Flood alarm state |
| R3 | Voice announcement | **Mirrors R1 (siren)** — always same state |
| R4 | Boom barrier | Reserved — always **OFF** |

**Why R3 mirrors R1:** The voice announcement plays the same duration as the siren. Hardcoded in `sendCommands()`:
```cpp
const bool voiceOn = sirenOn;  // R3 follows siren
```
To make R3 independent in the future: add `bool voiceOn` as a separate pending command in `RemoteBoxManager`.

**Why R4 is always OFF:** Boom barrier integration is planned but not yet approved. Changing R4 requires:
1. Physical barrier hardware installed and wired
2. Approval from RUB project owner
3. Update `sendCommands()` to pass `boomOn = true` on DANGER

---

## 8. RTU State Machine

Each remote box (left and right) independently tracks a health state in `RemoteBoxStatus::rtuState`:

```
                  ┌─────────────────┐
     first poll   │                 │  IN4=LOW
     success  ───►│    ONLINE       │──────────► LOW_BATTERY
                  │                 │◄──────────
                  └────────┬────────┘  IN4=HIGH
                           │ comm lost
                           ▼
                  ┌─────────────────┐
                  │   COMM_LOST     │
                  │                 │
                  └─────────────────┘

                  ┌─────────────────┐
                  │  LOW_BATTERY    │  comm lost after low battery
                  │                 │──────────► LVD_TRIPPED
                  └─────────────────┘
                  
                  ┌─────────────────┐
                  │  LVD_TRIPPED    │  comm returns + battery OK
                  │                 │──────────► ONLINE
                  └─────────────────┘
```

**LVD_TRIPPED** means: the remote box lost comms *after* its battery was already reporting low. The LVD (Low Voltage Disconnect) relay on the remote battery system likely cut power. This is expected behaviour — the S3 does not treat LVD_TRIPPED as a hardware fault, but reports it distinctly so the cloud can distinguish "communication problem" from "remote site lost power after battery depletion."

State is in-memory only (not persisted to NVS). On S3 reboot, all boxes start as COMM_LOST until first successful poll.

---

## 9. Relay Confirmation State Machine

After every `sendCommands()` call (FC5 writes), the firmware arms a non-blocking confirmation check using `ConfirmState` (one per bus).

```
sendCommands() called
        │
        ▼
  FC5 writes R1-R4
  cs.pending = true
  cs.checkAtMs = now + 3000 ms
        │
        ▼  (3 seconds later, in loop())
  processConfirmation() → reads FC2 DI
        │
   ┌────┴────┐
   │ OK?     │
   │ (bits   │
   │  match) │
   YES       NO
   │         │
   ▼         ▼
  Done    retry: re-send FC5
  clear   cs.checkAtMs = now + 5000 ms
  faulty  cs.retried = true
  flags        │
               ▼  (5 seconds later)
          processConfirmation() → reads FC2 DI
               │
          ┌────┴────┐
          │ OK?     │
          YES       NO
          │         │
          ▼         ▼
         Done    mark RELAY_FAULTY
         clear   (sirenFaulty / flashFaulty / voiceFaulty = true)
         flags   report to cloud
```

**Why non-blocking:** 3 s + 5 s delays cannot block the main loop (would trigger watchdog, freeze MQTT, etc.). The `ConfirmState` struct holds the timer and retry flag between `loop()` calls.

**RELAY_FAULTY is sticky** — it stays true until the next successful confirmation clears it. The cloud dashboard shows this as a hardware fault alarm at the remote site.

---

## 10. Key Source Files

| File | Role |
|------|------|
| `device_profile.h` | All pin assignments and hardware constants. ST485 slave ID overrides at the bottom under `#ifdef ST485_RTU4CH_WAVE485_MODE`. |
| `rs485_rtu_master.h/cpp` | Low-level Modbus RTU: FC1, FC2, FC3, FC5, FC6, FC16. UART2 remapped per transaction. Timing constants at top of .cpp. |
| `remote_box_manager.h/cpp` | High-level remote relay logic: poll, command, confirm. All ST485 mode code is inside `#ifdef ST485_RTU4CH_WAVE485_MODE` blocks. |
| `flood_state_machine.h/cpp` | SAFE/ALERT/DANGER state machine driven by water level. Calls `RemoteBoxManager::setSirenFlash()`. |
| `config_manager.h/cpp` | NVS-persisted device config (WiFi, thresholds, calibration). |
| `mqtt_manager.h/cpp` | Cloud telemetry and alarm publishing. Reads `RemoteBoxManager::leftStatus()` / `rightStatus()` for RTU health reporting. |
| `platformio.ini` | Build environments. See section 11. |

---

## 11. Build Environments

| Environment name | When to use |
|---|---|
| `floodguard_edgehax_s3_st485_wave485` | **Production flash** — BLE provisioning on first boot, no hardcoded WiFi |
| `floodguard_edgehax_s3_st485_wave485_dev` | **Bench / dev** — WiFi hardcoded (`jenix123` / `Kherli@321`), CDC off |

```bash
# Production flash
pio run -e floodguard_edgehax_s3_st485_wave485 -t upload

# Dev bench flash
pio run -e floodguard_edgehax_s3_st485_wave485_dev -t upload

# Serial monitor
pio device monitor --baud 115200
```

**DO NOT flash `_dev` to field devices** — the hardcoded WiFi credentials make it join the bench network instead of provisioning at the site.

---

## 12. Adding New Features — Rules for Developers

### Changing relay mapping

Edit only `sendCommands()` in `remote_box_manager.cpp`, inside `#ifdef ST485_RTU4CH_WAVE485_MODE`. Update `ConfirmState::wantVoice` / `wantBoom` to match.

### Adding a new DI input

1. Add a new constant to `namespace ST485` in `remote_box_manager.cpp`
2. Read the bit in `pollST485Box()` after the FC2 read
3. Add a corresponding field to `RemoteBoxStatus` in `remote_box_manager.h`

### Changing slave ID at the remote board

The ST485 board can be reprogrammed via Modbus (see ST485 datasheet, holding register for slave ID). After reprogramming:
- Update `RTU_SLAVE_ID_LEFT_BOX` or `RTU_SLAVE_ID_RIGHT_BOX` in `device_profile.h` (inside `#ifdef ST485_RTU4CH_WAVE485_MODE` block at the bottom)
- Rebuild and reflash

### Changing confirmation timing

In `remote_box_manager.cpp`, `sendCommands()` ST485 block:
- `millis() + 3000UL` — first check delay (3 s)  

In `processConfirmation()`:
- `millis() + 5000UL` — retry check delay (5 s)

### Supporting a third bus or a different slave module

The `Rs485RtuMaster` uses UART2 and supports only `RtuBus::LEFT` and `RtuBus::RIGHT`. Adding a third bus would require a dedicated UART or a Modbus multiplexer. Do not attempt to share the bus between different slave types without a full protocol review.

---

## 13. 120 Ω Termination Checklist

| Location | How to enable |
|---|---|
| S3 side — Waveshare module (left bus) | Solder the termination jumper on the Waveshare TTL-to-RS485 (B) board |
| S3 side — Waveshare module (right bus) | Same — separate module, same procedure |
| Remote site — ST485 board (left bus) | Solder a 120 Ω resistor between the A+ and B- terminals on the ST485 board |
| Remote site — ST485 board (right bus) | Same |

Termination is required at **both ends** of each 500 m cable. Missing termination causes reflections at 9600 baud over Cat6 — intermittent CRC errors, not a hard failure. Symptom: occasional `[RTU] RX: 0 bytes (timeout)` or `partial` in serial log.

---

## 14. Known Limitations / Future Work

| Item | Status |
|------|--------|
| R4 boom barrier | Reserved. Always OFF. Enable when hardware is installed. |
| Baud rate sweep for cable length estimation | Not yet implemented. Plan: sweep 9600→115200 and record highest reliable baud — cable attenuation limits max baud at 500 m. |
| IN4 LM393 polarity | Assumed: LOW = battery critical. **Verify with hardware team before production deployment.** |
| RTU state persisted across S3 reboot | Not implemented. All boxes restart as COMM_LOST on S3 reboot and re-detect on first poll. |
| FC2 read failure during confirmation | Treated as comm lost — confirmation aborted silently. Consider adding a separate CONFIRM_TIMEOUT fault state. |
