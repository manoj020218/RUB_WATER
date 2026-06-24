# FloodGuard VPS Backend GAP

Date: 2026-06-23
Owner: Codex

## Scope

This file tracks backend-side closure of the double-sensor alert contract and the production config-verification flow used by the firmware and APK.

## Status Summary

- Canonical `floodguard/...` MQTT handling with legacy compatibility: DONE
- Rich telemetry/event ingestion for alert-state APK fields: DONE
- Config push payload alignment with firmware aliases: DONE
- Reboot-aware config ACK and verification state machine: DONE
- Post-boot config comparison and audit logging: DONE
- Dashboard/config response normalization for APK: DONE
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

## Verification

- Local `npm test`: PASS
- VPS `npm test`: PASS
- VPS service restart: PASS
- Public health check from VPS:
  - `https://api.floodguard.iotsoft.in/health`: HTTP 200 / `status: UP`

## Residual Notes

- Deployment was done by syncing the changed backend source directly to the VPS project path and restarting `floodguard-api`.
- The APK bundle is updated locally only; no native Android package was deployed from the backend.
