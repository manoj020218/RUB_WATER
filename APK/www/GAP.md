# FloodGuard APK GAP

Date: 2026-06-27
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
- BLE provisioning hardening without firmware changes: DONE
- Same-network Wi-Fi discovery hardening: DONE
- APK web bundle rebuild into `www`: DONE
- Native Android rebuild/signing: DONE
- VPS-downloadable APK publish: DONE
- Android BLE scan visibility fix for devices visible in nRF Connect only: DONE
- Wi-Fi LAN discovery capped to four subnet attempts: DONE
- Location dropdown ambiguity removal using unique Location ID labels: DONE

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
- Location selectors that previously showed only `location_name` now show `location_id | location_name` in the APK where users choose a site for device registration, complaints, and reports.
- Installer BLE flow hardening:
  - adds BLE preflight before scan
  - uses a two-pass scan ladder instead of one strict filter path
  - primary scan now follows the nRF-style approach: broad scan first, app-side `JXFG` prefix matching, and duplicate advertisements enabled so scan-response names are not missed
  - stops using Android BLE init mode that can hide some scan results from the app
  - opens Android Location settings when system Location is off, because some Android BLE stacks otherwise return no scan results
  - verifies the FloodGuard FF00/FF01 service after connect
  - replaces fixed single-read timing with response polling and typed validation
  - allows open-Wi-Fi provisioning and keeps existing icon components unchanged
- Installer LAN discovery hardening:
  - scans current and fallback subnets in bounded batches
  - stops after four subnet attempts so discovery cannot feel infinite when the device is absent
  - probes candidates with safer timeouts and retry handling
  - deduplicates results by IP and shows richer scan progress text
  - auto-fills the local URL when exactly one FloodGuard device is found

## Verification

- `npm run build`: PASS
- Updated generated bundle written to `www/`
- `npm run cap:sync`: PASS
- `gradlew.bat assembleRelease`: PASS
- Native APK generated:
  - `APK/FloodGuard-v1.0.13-release.apk`
  - versionCode `14`
  - versionName `1.0.13`

## Residual Notes

- VPS release metadata now points to:
  - `https://api.floodguard.iotsoft.in/downloads/floodguard/android/FloodGuard-v1.0.13-release.apk`
