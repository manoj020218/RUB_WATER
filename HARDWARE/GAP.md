# FloodGuard Hardware GAP

Date: 2026-06-23
Owner: Codex

## Scope

This file tracks the firmware-side closure of the `double sensor.txt` requirements, excluding pump removal per the current project direction.

## Status Summary

- Dual-sensor confirmation/suspected alert logic: DONE
- `BOTH_ACTIVE` / `DYP_ONLY` / `SWITCH_ONLY` / `NO_SENSOR` compatibility: DONE
- Sensor confirmation wait setting and 5-minute default: DONE
- RTU trigger logic based on final alert decision: DONE
- Boot-time config report and versioned config verification support: DONE
- Local WebUI / local JSON config compatibility with VPS/APK flow: DONE
- Immutable `hardware_id` with editable `device_id` split: DONE
- MQTT / VPS OTA / HTTP fallback stability after device ID change: DONE
- Deferred publish / fallback payload truncation hardening: DONE
- Production firmware build verification: DONE
- Physical flash / field validation: NOT RUN
- Manual VPS OTA execution: READY, AWAITING TARGET DEVICE

## Implemented Firmware Changes

- Reworked the flood state machine to support:
  - confirmed orange
  - suspected orange
  - confirmed danger
  - suspected danger
  - single-sensor confirmed modes
  - no-sensor disabled mode
- Added persistent config revision handling and boot config reporting for VPS-side post-reboot verification.
- Added telemetry/event fields required for long-term APK/VPS clarity:
  - `sensor_mode`
  - `sensor_logic_mode`
  - `alert_level`
  - `alert_status`
  - `alert_source`
  - `alert_reason`
  - `pending_alert_level`
  - `sensor_confirmation_wait_sec`
  - `current_config_version`
- Added acceptance of both legacy and spec-compatible config aliases:
  - `sensor_mode`
  - `sensor_logic_mode`
  - `sensor_confirmation_wait_sec`
  - `mismatch_duration_seconds`
  - `DYP_ONLY` / `RS485_ONLY`
  - `BOTH_ACTIVE` / `DUAL`
- Added immutable `hardware_id` generation from the board MAC and surfaced it through:
  - local `/identity`
  - local `/api/status`
  - telemetry
  - heartbeat
  - boot/config report events
- Reworked MQTT startup to:
  - prefer `hardware_id` as the authenticated route
  - fall back to the legacy `device_id` route for backward compatibility
  - subscribe to both stable and legacy command/config topics during migration
- Reworked VPS OTA polling/reporting to use stable `hardware_id` routing while still carrying the logical `device_id`.
- Reworked HTTP fallback to post through identity-safe generic device endpoints with `x-hardware-id`.
- Increased deferred MQTT / HTTP fallback / internal offline queue payload capacity so:
  - config ACK messages are not truncated
  - full telemetry JSON is preserved during MQTT outages
  - boot/config report events survive fallback paths intact
- Updated local WebUI sensor labels to the field-facing wording:
  - `RS485 US Sensor`
  - `Switch Type Sensor`
  - `No Sensor Connected`
- Updated local `/config` JSON response to return reboot scheduling and current config version so the APK can verify post-update state.

## Verification

- `pio run -e floodguard_edgehax_s3_st485_wave485`: PASS
- Final firmware size:
  - Flash: 1754965 bytes
  - RAM: 85016 bytes
- OTA package staged on VPS:
  - `/var/www/floodguard-ota/floodguard_edgehax_s3_st485_wave485_0.1.0_20260623.bin`
  - SHA-256: `e0d1562cb76c31aecf1c47520fab699fc43afeef9e308a99747824b83d26752a`

## Residual Notes

- No device was flashed from this workspace yet.
- No field soak test was run yet.
- OTA package is ready from the built `firmware.bin`, but the live OTA queue should be created only after the target device ID is confirmed.
