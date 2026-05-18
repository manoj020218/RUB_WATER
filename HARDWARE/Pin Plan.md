# Pin Plan

## 1) Controller Technical Baseline
- MCU board: `ESP32-S3-WROOM-1` development board (dual USB type)
- Firmware target: `esp32-s3-devkitc-1`
- Firmware profile: `FLOODGUARD-S3-01`
- Active logic used in firmware:
  - Relay outputs: `LOW = ON`, `HIGH = OFF` (low-level trigger board)
  - RF trigger outputs: `LOW = ACTIVE`, `HIGH = IDLE`
  - Level switch inputs: `INPUT_PULLUP`, so `LOW = switch closed`

## 2) Confirmed GPIO Allocation

### A) RS485 Ultrasonic Sensor Interface
- `GPIO16` -> RS485 module `RO` (UART RX to ESP32)
- `GPIO17` -> RS485 module `DI` (UART TX from ESP32)
- `GPIO18` -> RS485 module `DE/RE` (direction control)

Notes:
- `DE` and `RE` are tied together on most MAX485 modules.
- Common ground (`GND`) between ESP32 and RS485 module is mandatory.

### B) Water Level Confirmation Inputs
- `GPIO4` -> Level-1 switch input (`300mm crossed`)
- `GPIO5` -> Level-2 switch input (`500mm crossed`)

Notes:
- Switch type expected: `NO/COM`.
- Recommended wiring:
  - `COM` -> `GND`
  - `NO` -> corresponding GPIO
- Because of `INPUT_PULLUP`, closed contact reads `LOW` and is treated as active.

### C) Relay Board (Low-Level Trigger Type, 4 Channels)
- `GPIO6` -> Relay CH1 (`SIREN`)
- `GPIO7` -> Relay CH2 (`BEACON`)
- `GPIO8` -> Relay CH3 (`VOICE`)
- `GPIO9` -> Relay CH4 (`BARRIER / FUTURE`)

Notes:
- Board type assumed: low-level trigger relay module.
- Keep relay board power separate as needed (often 5V), but share `GND` with ESP32 logic ground.

### D) RF Remote Activation Outputs (Low-Level Trigger)
- `GPIO13` -> RF trigger output 1 (`ENTRY`)
- `GPIO14` -> RF trigger output 2 (`EXIT`)

Notes:
- Firmware drives these pins `LOW` when active.
- Use transistor/opto isolation if RF module input requirements are not 3.3V-safe.

### E) Future SIM800 Backup GSM (UART Reserve)
- `GPIO11` -> SIM800 `RX` (ESP TX)
- `GPIO12` -> SIM800 `TX` (ESP RX)

Notes:
- SIM800 is planned for backup path if main 4G router path fails.
- Power design for SIM800 must support high current bursts and clean grounding.

## 3) Reserved/Important Design Rules
- Avoid reassigning boot strapping pins for this plan (`GPIO0`, `GPIO3`, `GPIO45`, `GPIO46`).
- Keep one shared ground reference across ESP32, RS485, relay input logic, RF input logic, and future SIM800 logic.
- Current firmware pin map source is centralized in:
  - `HARDWARE/firmware/src/device_profile.h`
  - `HARDWARE/firmware/src/config_manager.cpp`

## 4) Future Multi-Product Reuse
- For additional IoT products, clone this pattern and only change product profile defaults:
  - `PRODUCT_PID`
  - pin constants
  - OTA channel/path/host config
- OTA host baseline is already designed for migration through DNS:
  - `flash.iotsoft.in`
