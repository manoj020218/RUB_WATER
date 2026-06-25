# FloodGuard VPS Backend GAP

Date: 2026-06-24
Owner: Codex

## Scope

This file tracks backend-side closure of the double-sensor alert contract and the production config-verification flow used by the firmware and APK.

## Status Summary

- Canonical `floodguard/...` MQTT handling with legacy compatibility: DONE
- Identity resolution by `hardware_id`, MQTT route, or logical `device_id`: DONE
- Replacement-device rebind workflow with same logical device ID: DONE
- Outbound MQTT/config routing via immutable route ID: DONE
- Rich telemetry/event ingestion for alert-state APK fields: DONE
- Config push payload alignment with firmware aliases: DONE
- Reboot-aware config ACK and verification state machine: DONE
- Post-boot config comparison and audit logging: DONE
- Dashboard/config response normalization for APK: DONE
- Action sheet persistence, versioning, push, and sync state handling: DONE
- Alert-action event logging and history persistence: DONE
- Public app-release metadata and downloadable APK publish: DONE
- Local automated tests: DONE
- VPS deployment and remote automated tests: DONE
- Live backend service restart: DONE

## Implemented Backend Changes

- Added telemetry/event persistence for:
  - `alert_level`
  - `alert_status`
  - `alert_source`
  - `alert_reason`
  - `pending_alert_level`
  - `sensor_mode`
  - `sensor_confirmation_wait_sec`
  - `current_config_version`
- Added device identity persistence and alias handling for:
  - `hardware_id`
  - `mqtt_route_id`
  - `mqtt_topic_base`
  - `last_reported_device_id`
  - `device_id_history`
  - `hardware_history`
- Added inbound identity reconciliation across MQTT and HTTP:
  - resolve by `hardware_id`
  - resolve by MQTT topic route ID
  - resolve by logical `device_id`
  - automatic device rename handling when the device label changes locally
  - guarded hardware rebind for replacement hardware
- Added automatic replacement lifecycle handling:
  - new hardware bound to an existing logical device enters `PENDING_VERIFICATION`
  - verified reported config promotes the replacement back to `ACTIVE`
- Reworked OTA pending/report endpoints so a device polling by `hardware_id` still matches jobs queued by the logical `device_id`.
- Reworked outbound MQTT publish routing so config pushes follow the current immutable route even after a device ID rename.
- Added hardware identity exposure to dashboard / monitoring / admin device responses for APK and support tooling.
- Added config response state for the APK verification workflow:
  - `state`
  - `last_ack_status`
  - `last_verification_status`
  - `last_verification_message`
  - `verified_at`
  - `pending_command_id`
  - `device_reported`
  - `device_reported_at`
- Added reboot-aware config lifecycle:
  - `PENDING`
  - `REBOOT_PENDING`
  - `VERIFY_PENDING`
  - `VERIFIED`
  - `FAILED`
- Added boot-report and telemetry-driven verification against the requested config after device reboot.
- Added audit events for:
  - `DEVICE_CONFIG_UPDATE_REQUESTED`
  - `DEVICE_CONFIG_UPDATE_VERIFIED`
  - `DEVICE_CONFIG_UPDATE_FAILED`
  - `SENSOR_MODE_CHANGED`
  - `NO_SENSOR_MODE_ACTIVE`
  - `DEVICE_BOOTED_CONFIG_REPORT`
- Restored compatibility for legacy event names such as `DANGER_CONFIRMED` while still supporting the richer new alert model.
- Added suspected-alert notification variants for orange and danger cases.
- Added device action-sheet persistence and sync flow:
  - current per-device action sheet record
  - history records for old/new config snapshots
  - pending vs synced vs failed state tracking
  - vendor-super-admin Red all-off override enforcement
- Added action-sheet admin/device API routes for:
  - fetch current sheet
  - save sheet
  - push sheet to MCU
  - list history
  - device sync report
- Added persistent alert-action log creation from firmware events with:
  - site/location
  - device
  - alert level and status
  - action-sheet version
  - relay actions applied
  - trigger source and timestamps
- Updated release manifest served at `/api/app-release/mobile` and published the new Android package URL.

## Verification

- Local `npm test`: PASS
- VPS `npm test`: PASS
- VPS service restart: PASS
- Public health check from VPS:
  - `https://api.floodguard.iotsoft.in/health`: HTTP 200 / `status: UP`
- Public app release endpoint from VPS:
  - `https://api.floodguard.iotsoft.in/api/app-release/mobile`: PASS

## Residual Notes

- Deployment was done by syncing the changed backend source directly to the VPS project path and restarting `floodguard-api`.
- A timestamped backup was created on the VPS before overwriting the backend:
  - `/root/projects/floodguard/backups/backend_action_sheet_20260624_1315.tgz`
