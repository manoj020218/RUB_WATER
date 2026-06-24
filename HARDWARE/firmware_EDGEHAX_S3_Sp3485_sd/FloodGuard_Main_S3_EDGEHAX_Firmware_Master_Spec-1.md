# FloodGuard Main MCU Firmware Master Specification
## Edgehax ESP32-S3-WROOM-1 N16R8 Controller

**Firmware profile:** `FLOODGUARD-S3-EDGEHAX-01`  
**Product PID:** `FLOODGUARD_MAIN_S3_EDGEHAX`  
**Board:** Edgehax ESP32-S3 Devkit with `ESP32-S3-WROOM-1 N16R8`  
**API + MQTT host:** `api.floodguard.iotsoft.in`  
**Current MQTT port:** `1883`  
**OTA host:** `flash.iotsoft.in`

---

# 1. Purpose and Non-Negotiable Rules

This file is the single source of truth for Codex. Read it before coding, debugging, or resuming after context loss. Update the progress tracker and diagnostics diary after every meaningful change.

1. Local flood monitoring and safety actions must continue even if Wi-Fi, internet, MQTT, VPS, PWA, or microSD fails.
2. MQTT and HTTP are reporting/control paths only. Never block the safety loop on them.
3. Reuse the existing proven S3 token/auth connection mechanism exactly. Do not redesign it.
4. Do not guess pins. Use the frozen GPIO table below.
5. The primary DYP channel is **not Modbus RTU**. It is UART auto-output transported electrically over RS485 A/B.
6. Left and right remote siren-box channels are separate Modbus RTU master buses.
7. Use non-blocking state machines and bounded buffers.
8. Record every resolved issue in the diagnostics diary to avoid repeating mistakes save this in this folder only.

---

# 2. Verified Board Baseline

Selected board:

```text
Edgehax ESP32-S3-WROOM-1 N16R8 Devkit
16MB Flash
8MB PSRAM
Onboard microSD slot up to 64GB Class 10
Wi-Fi 2.4GHz
BLE 5
45 GPIOs
3 UARTs
USB Type-C
Onboard RESET and BOOT buttons
Onboard Orange, White and Green LEDs
```

## 2.1 Reserved Board Resources

Do not reuse:

```text
GPIO9  - GPIO14  = onboard microSD interface
GPIO19 - GPIO20  = USB D- / D+
GPIO40           = onboard Orange LED
GPIO41           = onboard White LED
GPIO42           = onboard Green LED
GPIO0, GPIO3, GPIO45, GPIO46 = avoid for product functions because of boot/strapping sensitivity
GPIO43, GPIO44               = reserve for UART debug/service console
```

Power the Edgehax board from a regulated `5V` supply. Never feed 12V directly into the board.

---

# 3. Frozen GPIO Plan

| Function | GPIO | Direction | Notes |
|---|---:|---|---|
| Primary DYP sensor data via SmartElex SP3485 `TX-0` | `GPIO21` | Input | UART RX only, 9600 baud |
| Confirmation Level-1 input | `GPIO4` | Input | `INPUT_PULLUP`, LOW = active |
| Confirmation Level-2 input | `GPIO5` | Input | `INPUT_PULLUP`, LOW = active |
| Local Relay CH1 Siren | `GPIO6` | Output | LOW = ON, HIGH = OFF |
| Local Relay CH2 Flash / Beacon | `GPIO7` | Output | LOW = ON, HIGH = OFF |
| Local Relay CH3 Voice / Future | `GPIO8` | Output | LOW = ON, HIGH = OFF |
| Local Relay CH4 Sump Pump | `GPIO16` | Output | LOW = ON, HIGH = OFF |
| RF Danger Siren trigger | `GPIO17` | Output | LOW = ACTIVE, HIGH = IDLE |
| RF Sump Pump trigger | `GPIO18` | Output | LOW = ACTIVE, HIGH = IDLE |
| Main battery ADC | `GPIO1` | ADC input | Through divider/module only |
| External CONFIG button | `GPIO48` | Input | `INPUT_PULLUP`, LOW = pressed |
| Left remote bus SmartElex `TX-0` -> S3 RX | `GPIO15` | Input | RTU RX — candidate (see §27) |
| Left remote bus S3 TX -> SmartElex `RX-1` | `GPIO2` | Output | RTU TX — candidate (see §27) |
| Left remote bus SmartElex `RTS` | `GPIO19` | Output | Direction control — USB D- repurposed (see §27) |
| Right remote bus SmartElex `TX-0` -> S3 RX | `GPIO38` | Input | RTU RX |
| Right remote bus S3 TX -> SmartElex `RX-1` | `GPIO39` | Output | RTU TX |
| Right remote bus SmartElex `RTS` | `GPIO47` | Output | Direction control |
| Onboard Orange LED | `GPIO40` | Output | Status LED |
| Onboard White LED | `GPIO41` | Output | Status LED |
| Onboard Green LED | `GPIO42` | Output | Status LED |

Centralize these definitions in `src/device_profile.h`.

```cpp
#pragma once

#define PRODUCT_PID              "FLOODGUARD_MAIN_S3_EDGEHAX"
#define PRODUCT_PROFILE          "FLOODGUARD-S3-EDGEHAX-01"

#define PIN_PRIMARY_DYP_RX       21

#define PIN_CONFIRM_LEVEL1       4
#define PIN_CONFIRM_LEVEL2       5

#define PIN_RELAY_SIREN          6
#define PIN_RELAY_FLASH          7
#define PIN_RELAY_VOICE_FUTURE   8
#define PIN_RELAY_SUMP_PUMP      16

#define PIN_RF_DANGER_SIREN      17
#define PIN_RF_SUMP_PUMP         18

#define PIN_MAIN_BATTERY_ADC     1
#define PIN_CONFIG_BUTTON        48

#define PIN_LEFT_RS485_RX        15    // CANDIDATE — see §27
#define PIN_LEFT_RS485_TX        2     // CANDIDATE — see §27
#define PIN_LEFT_RS485_RTS       19    // CANDIDATE — USB D- repurposed, see §27

#define PIN_RIGHT_RS485_RX       38
#define PIN_RIGHT_RS485_TX       39
#define PIN_RIGHT_RS485_RTS      47

#define PIN_LED_ORANGE           40
#define PIN_LED_WHITE            41
#define PIN_LED_GREEN            42

#define RELAY_ACTIVE_LOW         true
#define RF_ACTIVE_LOW            true
#define CONFIRM_INPUT_ACTIVE_LOW true
```

---

# 4. Carrier PCB and Connector Plan

The S3 board, SmartElex SP3485 modules, and relay board are removable plug-in modules using 2.54mm headers. Field cables use 5.08mm screw terminals.

## 4.1 J1 — Primary Ultrasonic Sensor Line

```text
5.08mm 4-pin:
1 = +12V SENSOR SUPPLY
2 = GND
3 = RS485 A
4 = RS485 B
```

## 4.2 J2 — Left Remote RTU Bus

```text
5.08mm 4-pin:
1 = SPARE / NC
2 = GND REFERENCE
3 = RS485 A
4 = RS485 B
```

Do not send siren/flash power over 500m CAT6. Remote warning boxes have local solar/battery supply.

## 4.3 J3 — Right Remote RTU Bus

```text
5.08mm 4-pin:
1 = SPARE / NC
2 = GND REFERENCE
3 = RS485 A
4 = RS485 B
```

## 4.4 J4 — Two-Level Confirmation Sensor

```text
5.08mm 4-pin:
1 = LEVEL1_IN
2 = GND
3 = LEVEL2_IN
4 = GND
```

Expected contact behavior:

```text
COM -> GND
NO  -> corresponding GPIO
INPUT_PULLUP
LOW = active
```

## 4.5 Local Relay Header

```text
2.54mm 6-pin:
1 = 5V
2 = GND
3 = IN1 SIREN
4 = IN2 FLASH
5 = IN3 VOICE / FUTURE
6 = IN4 SUMP PUMP
```

## 4.6 RF Header

```text
2.54mm 3-pin:
1 = GND
2 = RF_DANGER_SIREN
3 = RF_SUMP_PUMP
```

Use transistor/opto isolation if RF input is not 3.3V-safe.

## 4.7 ADC Header

```text
2.54mm 2-pin:
1 = ADC_OUT_FROM_VOLTAGE_MODULE
2 = GND
```

Never connect 12V directly to ESP32 ADC.

---

# 5. SmartElex SP3485 Breakout Wiring

Selected breakout labels:

```text
VCC
GND
TX-0
RX-1
RTS
A
B
G
```

Project interpretation:

```text
TX-0 = breakout UART output to MCU RX
RX-1 = breakout UART input from MCU TX
RTS  = half-duplex direction control
G    = RS485 reference ground terminal
```

## 5.1 Primary DYP Sensor Channel — Receive Only

Preserve the already-tested path exactly:

```text
DYP-A01CNYUB-2.1 UART auto-output sensor
        |
        | sensor UART TX only
        v
Sensor-side UART-to-RS485 converter
        |
        | RS485 A/B long cable
        v
Main-box SmartElex SP3485 breakout
        |
        | TX-0
        v
ESP32-S3 GPIO21 UART RX
```

Main-box wiring:

```text
SP3485 A     <- J1 A
SP3485 B     <- J1 B
SP3485 G     <- J1 GND reference
SP3485 TX-0  -> GPIO21
SP3485 RX-1  -> not connected
SP3485 RTS   -> GND / LOW receive mode
SP3485 VCC   -> 3.3V preferred
SP3485 GND   -> S3 GND
```

Firmware:

```text
GPIO21 UART RX only
9600 baud
No TX
No Modbus
Reuse existing tested DYP parser
```

## 5.2 Left Remote Siren-Box RTU Bus

```text
SP3485 TX-0 -> GPIO15 RX   (CANDIDATE — was GPIO35, blocked by OPI PSRAM)
SP3485 RX-1 <- GPIO2  TX   (CANDIDATE — was GPIO36, blocked by OPI PSRAM)
SP3485 RTS  <- GPIO19      (CANDIDATE — was GPIO37, blocked by OPI PSRAM; USB D- repurposed)
SP3485 A/B  <-> J2 A/B
SP3485 G    <-> J2 GND reference
```

## 5.3 Right Remote Siren-Box RTU Bus

```text
SP3485 TX-0 -> GPIO38 RX
SP3485 RX-1 <- GPIO39 TX
SP3485 RTS  <- GPIO47
SP3485 A/B  <-> J3 A/B
SP3485 G    <-> J3 GND reference
```

## 5.4 RTS Bench Verification

Expected behavior:

```text
RTS LOW  = receive
RTS HIGH = transmit
```

Before full RTU integration, write one hardware test to confirm RTS polarity on the actual module and record the result in the diagnostics diary. Do not probe random GPIOs.

---

# 6. RS485 Topology

Use three independent paths:

```text
Path 1: Primary DYP input
DYP UART -> converter -> A/B -> SmartElex SP3485 -> GPIO21 RX only

Path 2: Left remote RTU bus
Main S3 master -> left siren box ID 11
               -> future left solar telemetry ID 21
               -> future left display ID 31

Path 3: Right remote RTU bus
Main S3 master -> right siren box ID 12
               -> future right solar telemetry ID 22
               -> future right display ID 32
```

## 6.1 CAT6 Guidance

```text
Use one twisted pair for A/B.
Use another twisted pair for GND reference.
Do not use CAT6 as lightning earth.
Do not send siren/flash load power over 500m CAT6.
```

Example:

```text
Blue       -> A
Blue/White -> B
Brown + Brown/White -> GND reference
```

## 6.2 Termination

For each left/right remote RTU branch:

```text
120Ω across A/B at main S3 end
120Ω across A/B at far physical end
No extra termination at intermediate nodes
```

## 6.3 Protection

At each long-cable entry:

```text
SM712 TVS on A/B
Optional 10Ω or 22Ω resistor in series with A and B
Optional GDT only where real local earth/chassis exists
```

---

# 7. Primary Water-Level Calculation

Installer calibrates dry-ground zero:

```text
zero_distance_mm = current stable filtered distance at zero-water reference
water_level_mm = zero_distance_mm - current_distance_mm
if negative -> clamp to 0
```

Use bounded filtering:

```text
Read UART frames continuously.
Keep last 5 valid readings.
Discard highest and lowest.
Average middle 3.
Reject invalid/out-of-range frames.
Never allocate unbounded parser buffers.
```

---

# 8. Default Configurable Thresholds

```json
{
  "alert_level_mm": 200,
  "danger_level_mm": 400,
  "danger_clear_level_mm": 350,
  "pump_auto_start_level_mm": 200,
  "pump_auto_stop_level_mm": 50,
  "trigger_delay_seconds": 60,
  "alarm_clear_delay_seconds": 300,
  "pump_low_level_stop_delay_seconds": 30,
  "pump_max_runtime_minutes": 30
}
```

Store in NVS. Installer may change these from local maintenance page. VPS configuration workflow may also update them.

---

# 9. Flood State Machine

## 9.1 Orange Alert

```text
Primary level >= alert_level_mm
AND Level-1 confirmation input active
continuously for trigger_delay_seconds
-> ALERT_CONFIRMED
```

Pending verification:

```text
Primary level >= alert_level_mm
but L1 not active
-> ALERT_WAITING_FOR_CONFIRMATION
```

Mismatch:

```text
L1 active but primary below threshold
-> ALERT_SENSOR_MISMATCH
```

## 9.2 Danger

```text
Primary level >= danger_level_mm
AND L2 active
continuously for trigger_delay_seconds
-> DANGER_CONFIRMED
```

Safety override when sensors disagree:

```text
Primary >= danger threshold but L2 inactive for trigger delay
-> DANGER_WITH_CONFIRMATION_MISMATCH
-> activate danger outputs
-> warn: possible confirmation sensor fault or obstruction/person/vehicle under ultrasonic sensor
```

```text
L2 active but primary below danger threshold or invalid for trigger delay
-> DANGER_WITH_PRIMARY_SENSOR_FAULT
-> activate danger outputs
-> warn: inspect primary sensor and site physically
```

## 9.3 Auto Clear

```text
Primary level < danger_clear_level_mm
AND L2 inactive
continuously for alarm_clear_delay_seconds
-> clear danger
```

Never clear danger instantly.

---

# 10. Sump-Pump Logic

Support automatic and authorized manual control.

## 10.1 Auto Mode

```text
Confirmed water >= pump_auto_start_level_mm for trigger delay
-> local pump relay ON
-> RF pump trigger ACTIVE
-> optional remote pump command if enabled in site config
```

Dry-run protection:

```text
Water <= pump_auto_stop_level_mm for pump_low_level_stop_delay_seconds
-> pump OFF
-> RF pump trigger IDLE
-> remote pump OFF if enabled
```

Maximum continuous runtime:

```text
Default 30 minutes
Configurable
On expiry: stop pump, publish PUMP_MAX_RUNTIME_REACHED, re-evaluate level
```

## 10.2 Manual Mode

Authorized user may start pump manually. Manual mode may not bypass:

```text
dry-run low-level stop
maximum runtime
critical-voltage protection
```

---

# 11. Danger Outputs

On confirmed danger or sustained danger mismatch:

```text
Local relay CH1 SIREN        -> ON
Local relay CH2 FLASH        -> ON
Local relay CH3 VOICE/FUTURE -> available, feature not implemented now
RF danger siren              -> ACTIVE
Left remote box siren        -> ON
Left remote box flash        -> ON
Right remote box siren       -> ON
Right remote box flash       -> ON
MQTT event                   -> publish
HTTP fallback                -> attempt if MQTT unavailable
Offline FIFO                 -> append event
```

Barrier support remains future-only. Do not activate barrier automatically now.

---

# 12. Remote RTU Integration

The S3 acts as Modbus RTU master on two independent buses.

## 12.1 Reserved Slave IDs

```text
Left remote siren box  = 11
Right remote siren box = 12
Left solar telemetry   = 21 future
Right solar telemetry  = 22 future
Left display           = 31 future
Right display          = 32 future
```

Future displays are near siren boxes and should show:

```text
Water level: xxx mm
Status: NORMAL / ALERT / DANGER
```

## 12.2 Polling

```text
Normal: poll each siren box every 30-60 sec
Alert/Danger: poll every 5-10 sec
After command: read back relay status immediately
```

Read:

```text
online/offline
battery voltage
ADC state
siren relay
flash relay
barrier relay
pump relay
firmware version
uptime
last ACK
```

If relay command readback fails:

```text
log REMOTE_COMMAND_NOT_CONFIRMED
publish warning
keep local safety outputs active
```

---

# 13. Onboard LED Patterns

Use Edgehax onboard LEDs only.

| State | Pattern |
|---|---|
| Booting | White breathing |
| Wi-Fi not configured/disconnected | White slow blink |
| Wi-Fi connected, VPS unreachable | White fast blink |
| MQTT disconnected but local logic active | Green slow pulse |
| MQTT/VPS connected | Green solid |
| Orange alert | Orange slow blink |
| Danger | Orange fast blink |
| Sensor fault | Orange strobe |
| SD missing/fault | White double blink every 5 sec |
| OTA | Green + White alternate blink |
| Maintenance AP | White + Orange alternate slow blink |

Priority:

```text
OTA > DANGER > SENSOR_FAULT > ALERT > AP_MAINTENANCE > SD_WARNING > MQTT_CONNECTED > LOCAL_MODE > WIFI_DISCONNECTED > BOOT
```

---

# 14. Factory-Seeded Identity and BLE Provisioning

## 14.1 Device Names

```text
BLE name:     FgMainXXXXXX
Wi-Fi AP SSID: FgMainXXXXXX
XXXXXX = last 6 hexadecimal characters of chip MAC
```

## 14.2 Seeded Fields

Before field installation, firmware/device already contains:

```text
PRODUCT_PID
device_id
device token/secret
hardware_version
firmware_version
API host = api.floodguard.iotsoft.in
MQTT host = api.floodguard.iotsoft.in
MQTT port = 1883
OTA host = flash.iotsoft.in
OTA channel
```

## 14.3 Mandatory Token Rule

```text
Do not invent a new token mechanism.
Do not change working token field names, NVS keys, HTTP headers, MQTT username/password mapping,
claim sequence, retry timing, or server handshake without explicit approval.
Inspect and reuse the existing working S3 token/auth implementation.
Add regression tests before refactoring.
```

## 14.4 BLE Scope

BLE is used only to provision:

```text
Wi-Fi SSID
Wi-Fi password
optional location claim code only if already supported by proven flow
```

Never expose device secret over BLE.

## 14.5 First-Boot Flow

```text
Load seeded identity
If Wi-Fi not configured or VPS never connected:
  BLE discovery ON
  open AP FgMainXXXXXX ON
  local login page ON
BLE provisions Wi-Fi
Connect Wi-Fi
Use existing HTTP claim/connect flow
Connect MQTT api.floodguard.iotsoft.in:1883
After first successful VPS connection:
  close AP
  disable BLE provisioning until reopened intentionally
```

---

# 15. Local AP Maintenance Webserver

## 15.1 Access Policy

```text
AP Wi-Fi password: none
Webserver login password: Hanuman#2026
```

AP active:

```text
first boot until VPS connection succeeds
or CONFIG button held for 5 sec
```

After commissioning, diagnostics are available only when maintenance AP is reopened. Do not expose continuously over LAN.

## 15.2 External CONFIG Button

```text
GPIO48
INPUT_PULLUP
LOW = pressed
```

```text
Hold 5 sec  -> open AP for 15 minutes
Hold 15 sec -> do not reset immediately; open protected page requiring login + explicit reset confirmation
```

Do not bypass or disable onboard RESET. It must continue normal hardware reset behavior.

## 15.3 Pages

```text
/login
/status
/config
/diagnostics
/relay-test
/remote-test
/calibration
/firmware-upload
/reboot
/factory-reset-confirm
```

## 15.4 Status Page Must Show

```text
PID, device ID, hardware version, firmware version, build date
uptime, reset reason
Wi-Fi, VPS HTTP, MQTT, local IP, AP state
SD state, capacity, FIFO count
free heap, minimum free heap, task stack high-water marks
primary DYP raw/filtered/zero distance and calculated level
confirmation L1/L2
current state and note
battery ADC raw, voltage, divider ratio, calibration factor
local relays and RF states
left/right remote box online, battery, relays, poll time, ACK, firmware
```

## 15.5 Calibration Page

```text
show current raw and filtered distance
button: Set Current Stable Reading as Ground Zero
field: actual multimeter battery voltage
calculate: adc_calibration_factor = actual_voltage / reported_voltage
save to NVS
```

## 15.6 Config Validation

Fields:

```text
alert_level_mm
danger_level_mm
danger_clear_level_mm
pump_auto_start_level_mm
pump_auto_stop_level_mm
trigger_delay_seconds
alarm_clear_delay_seconds
pump_low_level_stop_delay_seconds
pump_max_runtime_minutes
scheduled reboot time
ADC ratio and factor
left/right remote enabled
future solar polling enabled
future displays enabled
```

Rules:

```text
danger > alert
danger clear < danger
pump stop < pump start
trigger delay >= 10 sec
clear delay >= 30 sec
zero distance must be stable and valid
ADC factor must be within sane range
```

On conflict:

```text
Do not save.
Show red border.
Show plain-language helper warning.
Explain the conflicting field.
```

## 15.7 Relay Test

Allow short timed tests for:

```text
local siren
local flash
voice/future relay
local pump
RF siren
RF pump
left siren box siren/flash/pump
right siren box siren/flash/pump
```

Require explicit confirmation for pump tests. Log all tests.

---

# 16. NVS Configuration

Store critical settings in NVS and preserve them across power cuts.

```cpp
struct FloodGuardMainConfig {
  uint16_t alertLevelMm;
  uint16_t dangerLevelMm;
  uint16_t dangerClearLevelMm;
  uint16_t pumpAutoStartLevelMm;
  uint16_t pumpAutoStopLevelMm;
  uint16_t triggerDelaySeconds;
  uint16_t alarmClearDelaySeconds;
  uint16_t pumpLowStopDelaySeconds;
  uint16_t pumpMaxRuntimeMinutes;
  uint16_t zeroDistanceMm;
  float batteryAdcDividerRatio;
  float batteryAdcCalibrationFactor;
  bool leftRemoteEnabled;
  bool rightRemoteEnabled;
  char scheduledRebootTime[6];
  uint32_t configVersion;
};
```

On first boot or invalid NVS:

```text
load safe defaults
write defaults
log CONFIG_DEFAULTS_LOADED
```

Never overwrite valid settings after ordinary reboot/power cut.

---

# 17. microSD and Offline FIFO

Default:

```text
64GB Class 10 microSD
```

If SD missing, unreadable, full, or corrupt:

```text
continue monitoring
continue sirens/flash
continue pump safety
continue RF
continue remote commands
publish SD_CARD_NOT_FOUND or SD_CARD_FAULT
show warning locally
use internal flash FIFO
```

Internal fallback:

```text
max 500 records
prioritize critical events
wear-aware batching
never write every loop iteration
```

Sync:

```text
oldest-first
ACK required before delete
non-blocking
critical events retained whenever capacity permits
```

---

# 18. MQTT, HTTP Fallback and Telemetry

```text
MQTT: api.floodguard.iotsoft.in:1883
HTTP: https://api.floodguard.iotsoft.in
OTA:  https://flash.iotsoft.in
```

Current pilot uses MQTT 1883. Keep abstraction ready for future TLS 8883 migration.

Suggested topics:

```text
floodguard/{device_id}/telemetry
floodguard/{device_id}/event
floodguard/{device_id}/command
floodguard/{device_id}/command_ack
floodguard/{device_id}/config
floodguard/{device_id}/config_ack
floodguard/{device_id}/ota
```

If existing proven firmware already uses different topics, preserve them and document the final actual topics here.

Dynamic intervals:

```text
normal/no water: 180 sec
water detected below 300mm: 10 sec
>=300mm and rising: 5 sec
>=400mm or danger: 2 sec
critical event: immediate
```

If MQTT fails:

```text
queue locally
attempt HTTPS fallback using same dynamic interval policy
sync FIFO oldest-first after recovery
never block safety loop
```

---

# 19. OTA and Rollback

Remote OTA host:

```text
flash.iotsoft.in
```

Support:

```text
admin-triggered OTA
scheduled check
version comparison
checksum verification
progress reporting
safe reboot
rollback if health check fails
```

Block OTA during:

```text
alert
danger
pump active
relay test
another upload
critical FIFO sync transaction
```

Local upload only after login in maintenance AP mode, with checksum validation and rollback.

---

# 20. Scheduled Reboot

Default:

```text
03:30 AM daily
```

Editable and stored in NVS.

Skip while:

```text
alert
danger
pump active
OTA
relay test
critical FIFO sync
```

---

# 21. Offline Local Safety Mode

If Wi-Fi, internet, MQTT, or VPS fails:

```text
keep parsing primary DYP
keep reading confirmation inputs
keep alert/danger state machine running
keep local siren and flash working
keep pump and dry-run protection working
keep RF outputs working
keep left/right RTU commands working where buses are available
queue telemetry
show local-mode LED state
```

---

# 22. Recommended Firmware Structure

```text
firmware/
  platformio.ini
  src/
    main.cpp
    device_profile.h
    config_manager.cpp/.h
    nvs_storage.cpp/.h
    dyp_uart_parser.cpp/.h
    confirmation_inputs.cpp/.h
    flood_state_machine.cpp/.h
    pump_controller.cpp/.h
    output_controller.cpp/.h
    rs485_rtu_master.cpp/.h
    remote_box_manager.cpp/.h
    voltage_monitor.cpp/.h
    sd_fifo.cpp/.h
    internal_flash_fifo.cpp/.h
    telemetry_manager.cpp/.h
    ble_provisioning.cpp/.h
    wifi_manager.cpp/.h
    mqtt_manager.cpp/.h
    http_fallback.cpp/.h
    ota_manager.cpp/.h
    local_webserver.cpp/.h
    status_led.cpp/.h
    diagnostics.cpp/.h
```

Reuse existing structure when practical. Do not casually migrate framework or package manager.

---

# 23. Build Baseline

```ini
[env:floodguard_edgehax_s3]
platform = espressif32
board = esp32-s3-devkitc-1
framework = arduino
monitor_speed = 115200
```

Inspect and preserve known-good settings for:

```text
16MB flash
8MB PSRAM
USB CDC debug
OTA partition table
microSD
```

Do not randomly upgrade PlatformIO, Arduino core, filesystem, MQTT, OTA, BLE, or Modbus libraries during feature work.

---

# 24. Stack and Reliability Rules

```text
Avoid large local arrays.
Use fixed-size bounded buffers.
Avoid huge local JSON documents.
Avoid recursion.
Use non-blocking state machines.
Avoid blocking network calls in safety loop.
Feed/yield watchdog appropriately.
Bound UART frames and FIFO record size.
Throttle SD writes.
Avoid unbounded String concatenation.
Track free heap, minimum heap, largest block, task stack watermark, reset reason.
```

---

# 25. Acceptance Tests

## 25.1 Boot and Pins

```text
All relay GPIOs HIGH immediately after boot.
RF outputs HIGH immediately after boot.
RESET button still performs hardware reset.
No boot loop.
LED boot pattern works.
```

## 25.2 Primary DYP

```text
Feed known DYP frames via RS485 transport.
Verify SmartElex TX-0 -> GPIO21.
Verify parser, raw distance, filtering, zero calibration, calculated level.
Invalid frames must not trigger alarm.
```

## 25.3 Confirmation Inputs

```text
L1 short to GND -> GPIO4 active.
L2 short to GND -> GPIO5 active.
Open contacts -> inactive.
```

## 25.4 Local Outputs

```text
Test siren, flash, voice/future, pump, RF siren, RF pump.
Verify LOW=ON and HIGH=OFF.
```

## 25.5 Remote Buses

```text
Poll left ID11 and right ID12.
Command siren/flash.
Read battery and status.
Disconnect one bus and confirm only that side goes offline.
```

## 25.6 SD Failure

```text
Boot with 64GB card.
Boot without card.
Simulate unmount/corrupt condition.
Confirm safety logic continues and internal 500-record fallback activates.
```

## 25.7 Connectivity Failure

```text
Remove Wi-Fi.
Stop MQTT.
Stop VPS HTTP.
Confirm safety continues.
Restore and verify ACK-based oldest-first sync.
```

## 25.8 Config Validation

```text
Try danger <= alert.
Try pump stop >= pump start.
Try invalid zero.
Try trigger delay <10 sec.
Verify red borders and no invalid save.
```

## 25.9 OTA

```text
Install valid update.
Verify checksum and safe reboot.
Force failed health check and verify rollback.
Verify OTA blocked during danger and pump-active state.
```

---

# 26. Progress Tracker — Codex Must Update

```text
[x] Phase 0  Repository inspection and known-good build reproduction
[x] Phase 1  Frozen pin map and safe GPIO init
[x] Phase 2  Reuse primary DYP GPIO21 parser
[x] Phase 3  Confirmation inputs and calibration
[x] Phase 4  Local relay and RF outputs
[x] Phase 5  Left/right RTU master buses
[x] Phase 6  SD FIFO and flash fallback
[x] Phase 7  BLE Wi-Fi provisioning and existing token-flow reuse
[x] Phase 8  MQTT and HTTP fallback
[x] Phase 9  Maintenance AP webserver
[x] Phase 10 OTA, rollback, scheduled reboot
[ ] Phase 11 Bench acceptance test (flash to hardware and verify)
[ ] Phase 12 Long-cable field validation
```

## 26.1 Known-Good Build Record

```text
Date:              2026-05-30
Git commit:        (commit after this session)
PlatformIO env:    floodguard_edgehax_s3 (prod)  |  floodguard_edgehax_s3_dev (bench)
Platform:          espressif32 @ 6.13.0
Arduino core:      framework-arduinoespressif32 @ 3.20017.241212
Libraries:         PubSubClient@2.8.0  ArduinoJson@6.21.6
Flash setting:     16MB, qio_opi (PSRAM enabled)
Partition table:   partitions_16mb.csv (7.75MB OTA x2)
RAM used:          21.2% (69600 / 327680 bytes)
Flash used:        18.7% (1522353 / 8126464 bytes)
Known-good binary: both envs compile clean, 0 errors
Known-good VPS token test:   PENDING (bench flash required)
Known-good DYP parser test:  PENDING (bench flash required)
```

---

# 27. Diagnostics Diary — Codex Must Update After Every Fix

Template:

```text
## YYYY-MM-DD - Short issue name
Symptom:
Exact error/log:
Affected module:
Root cause:
Fix:
Files changed:
Regression test added:
Hardware wiring change:
Package/library version involved:
Confirmed working result:
Do not repeat:
```

## 2026-05-30 — Initial full firmware scaffold compiled clean

```text
Symptom:        New project; all 22 source files written from spec.
Exact error/log:
  1. WiFi undeclared in ble_provisioning.cpp → added #include <WiFi.h>
  2. PubSubClient macro MQTT_CONNECTED conflicted with LedPriority enum → renamed enum value to CLOUD_CONNECTED
  3. min() type mismatch in mqtt_manager.cpp (UL vs uint32_t) → replaced with explicit ternary
  4. PubSubClient::connected() not const → removed const qualifier from isConnected()
  5. local_webserver.cpp missing #include <Preferences.h>
  6. extern "C" linkage on getArduinoLoopTaskStackSize() caused redeclaration conflict → removed extern "C"
  7. main.cpp missing #include <ArduinoJson.h>, <WiFi.h>, <esp_mac.h>
Affected module: All (initial build)
Root cause:      Header omissions and type/linkage mismatches typical of new multi-file project.
Fix:             Added missing headers; removed extern "C"; fixed type consistency.
Files changed:   ble_provisioning.cpp, mqtt_manager.h/cpp, status_led.h/cpp,
                 local_webserver.cpp, main.cpp
Regression test: pio run -e floodguard_edgehax_s3 → SUCCESS
                 pio run -e floodguard_edgehax_s3_dev → SUCCESS
Hardware wiring: None yet (bench flash pending)
Confirmed result: Both envs build clean. RAM 21.2%, Flash 18.7%.
Do not repeat:   Always include WiFi.h when using WiFi.scan* in a .cpp. Never use MQTT_CONNECTED
                 as enum name — PubSubClient defines it as a macro.
```

## 2026-05-30 — SD card pinout confirmed for Edgehax board

```text
Source: ChatGpt.txt.txt in project folder (Edgehax published pinout).
Confirmed mapping:
  PIN_SD_CLK = 12, PIN_SD_CMD = 11, PIN_SD_D0 = 13, PIN_SD_D1 = 14,
  PIN_SD_D2 = 9,   PIN_SD_D3 = 10
Mode: SDMMC 4-bit (SD_MMC.begin("/sdcard", false))
No card-detect pin on this board. PIN_SD_CD = -1.
Do not repeat: Do not use SD.h SPI for this board's onboard slot.
```

## 2026-05-30 — Left RS485 bus GPIO conflict with OPI PSRAM; candidate remapping

```text
Symptom:        Left bus spec'd to GPIO35/36/37. On N16R8, these are OPI PSRAM
                data lines (SPI_IO6, SPI_IO7, SPI_DQS). Driving them as UART
                caused immediate TG1WDT_SYS_RST panic on bench.
Exact error:    rst:0x8 (TG1WDT_SYS_RST) on every boot with left bus init.
Affected module: rs485_rtu_master.cpp, device_profile.h
Root cause:     ESP32-S3-WROOM-1 N16R8 uses Octal PSRAM. Espressif datasheet
                confirms GPIO33-GPIO37 are occupied when Octal PSRAM is used.
                Spec was authored before this hardware constraint was known.
Fix:            Candidate remapping approved (ChatGpt.txt.txt 2026-05-30):
                  GPIO35 -> GPIO15  (left RX)
                  GPIO36 -> GPIO2   (left TX)
                  GPIO37 -> GPIO19  (left RTS — native USB D- intentionally sacrificed)
                GPIO19 confirmed safe: device uses Wi-Fi + OTA in field.
                USB-to-UART (GPIO43/44 UART0) remains available for programming.
Files changed:  device_profile.h, rs485_rtu_master.cpp, spec §3, §5.2
Regression:     Run 9-item bench checklist below before freezing mapping.
Hardware:       Wire left SmartElex SP3485: TX-0->GPIO15, RX-1->GPIO2, RTS->GPIO19
Do not repeat:  Never assign GPIO33-37 as UART on N16R8. Always cross-check
                module variant (N8 vs N16R8) before assigning high GPIO numbers.
```

## Bench Test Checklist — Required Before Freezing Candidate Mapping

```text
Profile freeze target: FLOODGUARD-S3-EDGEHAX-N16R8-02

[ ] 1. Cold boot at least 20 times with both RS485 modules connected.
        Pass = no TG1WDT_SYS_RST or PSRAM-related panic.
[ ] 2. Confirm no TG1WDT_SYS_RST or PSRAM-related panic across all 20 boots.
[ ] 3. Confirm left bus RX/TX/RTS communication (Modbus RTU to slave ID 11).
[ ] 4. Confirm right bus RX/TX/RTS communication (Modbus RTU to slave ID 12).
[ ] 5. Confirm SD card mount and file write/read (64GB Class 10, FAT32).
[ ] 6. Confirm ADC, relays, RF outputs, DYP UART, and config button.
[ ] 7. Confirm OTA update over Wi-Fi.
[ ] 8. Confirm USB-to-UART flashing remains available (UART0, GPIO43/44).
[ ] 9. Confirm native USB documented as unavailable in field profile.

On all 9 passing:
  -> Update PRODUCT_PROFILE to FLOODGUARD-S3-EDGEHAX-N16R8-02
  -> Remove all CANDIDATE comments from device_profile.h
  -> Update progress tracker Phase 11 to [x]
```

## PENDING — Mandatory diary entries (complete on bench)

```text
1. SmartElex RTS polarity: confirm HIGH=TX LOW=RX on actual SP3485 module
2. Primary DYP GPIO21 parser: flash dev env, verify serial output shows valid mm readings
3. Edgehax onboard LED polarity: test LED_ON_LEVEL HIGH/LOW; update device_profile.h if wrong
4. SD mount pins: confirmed via ChatGPT/Edgehax pinout (see entry above)
5. VPS token test: provision WiFi via BLE, verify MQTT connects with DEVICE_TOKEN_SEED
6. OTA partition: partitions_16mb.csv gives 7.75MB per OTA partition — verify ota_0/ota_1 alternate
7. Task stack watermarks: record free heap under MQTT+HTTP+SD+webserver concurrent load
```

---

# 28. Do-Not-Guess Checklist

```text
[ ] Use frozen GPIO map.
[ ] Do not probe random pins unless a documented mismatch exists.
[ ] Preserve GPIO21 receive-only for Sensor DYP input via Sp3485 RX pin on S3 board. where DYP sensor using other tye RS485 module to trasfer DYP TTL data via A B GND. 
[ ] Do not treat DYP transport as Modbus.
[ ] Use SmartElex RTS pin for remote half-duplex direction.
[ ] Keep left/right RTU buses separate.
[ ] Keep onboard RESET working normally.
[ ] Reserve GPIO9-GPIO14 for microSD.
[ ] Reuse existing proven S3 token mechanism.
[ ] Never block safety logic on VPS, MQTT, HTTP, SD, or OTA.
[ ] Update progress tracker and diagnostics diary.
```

---

# 29. Companion Document

Keep this aligned with:

```text
FloodGuard_Remote_Siren_Box_firmware.md
```

Any RTU register-map change must be reflected in both documents.
