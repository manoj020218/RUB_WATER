# Identity Rename Fix Handoff

Date: 2026-07-01
Scope: Firmware + VPS backend only. APK and PWA were not changed for this task.

## Problem

Changing the editable device name in the local web UI caused MQTT/VPS identity mismatch.

Observed case:
- local device name changed to `RUB43-1-AJ`
- hardware id is `FGHW-441BF695A450`
- historical VPS device record is still `FG-MAIN-EH-01`

This caused two separate issues:

1. Firmware-side issue
- MQTT fallback auth could still depend on editable `device_id`
- renaming the local device could change broker auth behavior

2. Backend-side issue
- MQTT ingest was overwriting reported `device_id` with resolved record `_id`
- backend could not see the renamed device id from the payload
- VPS record stayed on old logical id

## Fix Applied

### 1. Backend rename sync fix

File:
- `D:\IOT Device\RUB\FloodGuard\VPS\backend\src\mqtt\messageRouter.js`

What changed:
- preserve the device-reported `device_id`
- keep backend-resolved record id separately as `resolved_device_id`

Result:
- when the device reports a new logical `device_id`, backend identity reconciliation can rename the record

Live deployment status:
- this backend patch was already copied to VPS and verified live

### 2. Firmware MQTT identity lock fix

Files:
- `src/mqtt_manager.h`
- `src/mqtt_manager.cpp`
- `src/main.cpp`
- `src/local_webserver.cpp`
- `src/device_profile.h`

What changed:
- added a separate locked fallback auth id for MQTT
- `device_id` remains editable label only
- MQTT now prefers:
  1. `hardware_id`
  2. locked `auth_id`
  3. `device_id` only as last-resort compatibility fallback
- `auth_id` is stored in NVS once under namespace `fgid`
- local rename no longer changes fallback broker auth identity
- local identity page and `/api/status` now expose:
  - `mqtt_auth_id`
  - current `mqtt_route_id`

Result:
- future device-name changes should not affect MQTT login or route stability

## Build Output

Environment:
- `floodguard_edgehax_s3_st485_wave485`

Built binary:
- `D:\IOT Device\RUB\FloodGuard\HARDWARE\firmware_EDGEHAX_S3_ST485_RTU4ch_WAVE485\firmware\.pio\build\floodguard_edgehax_s3_st485_wave485\firmware.bin`

Build verification:
- `pio run -e floodguard_edgehax_s3_st485_wave485`
- status: `SUCCESS`

Binary details:
- size: `1787936`
- sha256: `b0eb6cf909bde2cf3ce22a119ede6823ea5f8e99e65d1a2677d9e38e22c5956c`

## VPS Rollout Status

Uploaded firmware URL:
- `https://api.floodguard.iotsoft.in/downloads/floodguard/firmware/FloodGuard-0.2.1-identity-lock.bin`

Remote file path:
- `/root/projects/floodguard/repo/VPS/backend/downloads/floodguard/firmware/FloodGuard-0.2.1-identity-lock.bin`

HTTP check:
- returned `HTTP/1.1 200 OK`

Queued OTA job:
- job id: `ota_RUB43-1-AJ_20260701_identity_fix`
- device id in job: `FG-MAIN-EH-01`
- hardware id in job: `FGHW-441BF695A450`
- route id in job: `FGHW-441BF695A450`
- version: `0.2.1-identity-lock`
- status: `queued`
- delivery_count: `0`
- report_count: `0`

Meaning:
- the field device has not polled VPS OTA yet
- the new firmware is staged, but not installed

## Live Device State At Pause Time

As checked on 2026-07-01:

### RUB43 shipped unit
- VPS record id: `FG-MAIN-EH-01`
- hardware id: `FGHW-441BF695A450`
- location: `RUB43/1-AJMER`
- last seen: `2026-07-01T12:03:24.737Z`
- last heartbeat: `2026-07-01T12:03:24.737Z`
- last reported device id: `FG-MAIN-EH-01`
- last local ip: `192.168.1.159`
- last ssid: `JENIX_BFAC`
- last wifi connected: `true`
- last mqtt connected: `true`

Important:
- VPS still has not seen the renamed logical id `RUB43-1-AJ`
- therefore the rename fix has not yet been exercised by the live device

### RUB42 unit
- VPS record id: `RUB42-AJ`
- hardware id: `FGHW-9C139EBA1600`
- location: `RUB42 - AJMER`
- last seen: `2026-06-30T11:56:11.880Z`
- last heartbeat: `2026-06-30T11:56:11.880Z`

## What To Check After 15 Days

1. Check whether the RUB43 device is back online.
- confirm fresh `last_seen`
- confirm fresh `last_heartbeat`

2. Check whether the queued OTA job was delivered.
- same job id: `ota_RUB43-1-AJ_20260701_identity_fix`
- verify `delivery_count`
- verify `report_count`
- verify final `status`

3. Check whether backend device record renamed automatically.
- expected final logical device id: `RUB43-1-AJ`
- expected hardware id: `FGHW-441BF695A450`
- expected route id should remain hardware-based:
  - `FGHW-441BF695A450`

4. Check whether reported identity became correct.
- `last_reported_device_id` should become `RUB43-1-AJ`

5. If OTA was not delivered but device is reachable on LAN, use direct local flash or local OTA.

## Expected Final Healthy State

After the fix is actually installed on the device:
- local rename changes only `device_id`
- MQTT auth remains stable
- MQTT route remains stable
- backend sees renamed `device_id`
- backend renames logical record if no conflict exists

## Files Changed For This Fix

Firmware:
- `src/mqtt_manager.h`
- `src/mqtt_manager.cpp`
- `src/main.cpp`
- `src/local_webserver.cpp`
- `src/device_profile.h`

Backend:
- `D:\IOT Device\RUB\FloodGuard\VPS\backend\src\mqtt\messageRouter.js`

