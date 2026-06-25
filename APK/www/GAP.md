# FloodGuard APK GAP

Date: 2026-06-24
Owner: Codex

## Scope

This file tracks APK/UI-side closure of the double-sensor monitoring and verified config-update flow. This copy is kept in `www/` with the built web bundle.

## Status Summary

- Sensor/alert dashboard field alignment: DONE
- Hardware identity and MQTT route visibility: DONE
- Confirmed vs suspected alert visibility: DONE
- RTU status and relay visibility: DONE
- Verified cloud config-update workflow: DONE
- Local LAN config save alignment: DONE
- Alert action-sheet editor, sync state, and history visibility: DONE
- APK web bundle rebuild into `www`: DONE
- Native Android rebuild/signing: DONE
- VPS-downloadable APK publish: DONE

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
  - shows both logical `device_id` and immutable `hardware_id`
  - shows the active MQTT route ID used by the device
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
- Action-sheet page updates inside Config view:
  - shows desired version, MCU version, last sync time, sync source, and sync message
  - edits Orange and Red relay rules for R1 Siren / R2 Flash / R3 Voice Trigger
  - supports save and push workflows through VPS API
  - shows sync history and enabled relay-rule counts
  - exposes vendor-super-admin Red all-off override only to the vendor super-admin role
- Rebuilt the production web bundle into `APK/www`.
- Install and location management views now surface hardware identity / route data to make field replacement and device-ID changes diagnosable without local shell access.

## Verification

- `npm run build`: PASS
- Updated generated bundle written to `www/`
- `npm run cap:sync`: PASS
- `gradlew.bat assembleRelease`: PASS
- Native APK generated:
  - `APK/FloodGuard-v1.0.5-release.apk`
  - versionCode `6`
  - versionName `1.0.5`

## Residual Notes

- VPS release metadata now points to:
  - `https://api.floodguard.iotsoft.in/downloads/floodguard/android/FloodGuard-v1.0.5-release.apk`
