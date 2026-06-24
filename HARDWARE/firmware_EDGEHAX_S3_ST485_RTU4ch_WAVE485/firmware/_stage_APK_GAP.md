# FloodGuard APK GAP

Date: 2026-06-23
Owner: Codex

## Scope

This file tracks APK/UI-side closure of the double-sensor monitoring and verified config-update flow. This copy is kept in `www/` with the built web bundle.

## Status Summary

- Sensor/alert dashboard field alignment: DONE
- Confirmed vs suspected alert visibility: DONE
- RTU status and relay visibility: DONE
- Verified cloud config-update workflow: DONE
- Local LAN config save alignment: DONE
- APK web bundle rebuild into `www`: DONE
- Native Android rebuild/signing: NOT RUN

## Implemented APK Changes

- Updated TypeScript contracts for the richer firmware/backend state:
  - `sensor_mode`
  - `sensor_confirmation_wait_sec`
  - `current_config_version`
  - `last_ack_status`
  - `last_verification_status`
  - `last_verification_message`
  - `verified_at`
  - `state`
  - richer alert-state telemetry fields
- Dashboard updates:
  - shows `RS485 US Sensor` and `Switch Type Sensor` wording
  - shows confirmed / suspected / disabled alert state
  - shows alert reason and pending alert level
  - shows real MQTT connected state, local IP, API server, RTU status, and RTU relay states
  - shows sensor confirmation wait time and current sensor input mode
- Config page updates:
  - always fetches current firmware config before sending changes
  - always sends `reboot_after_config_update: true` for the cloud config path
  - polls backend verification state after save/push
  - only shows success after post-reboot verification
  - shows explicit progress states such as sending, rebooting, and fetching updated settings
  - keeps local LAN save available with the current local admin password
- Rebuilt the production web bundle into `APK/www`.

## Verification

- `npm run build`: PASS
- Updated generated bundle written to `www/`

## Residual Notes

- Native Capacitor/Gradle APK generation was not run in this pass.
- The built `www/` bundle is ready for the next Android packaging step when needed.
