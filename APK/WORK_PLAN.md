# FloodGuard APK Work Plan and Current Progress

Document purpose: this file is no longer only a basic APK to-do list. It is now the current app delivery status plus the integration contract between APK, firmware, MQTT, and VPS so future changes do not break the working system.

Last updated: 2026-06-06
Current signed release target: `1.0.1`
Current Android build code: `2`
Primary package id: `in.jenix.floodguard`

## 1. Current Delivery Status

### 1.1 Overall App Status

| Area | Status | Notes |
|---|---|---|
| Capacitor Android app | Done | Real Android app is active, not only mockup/PWA |
| Responsive mobile UI | Done | Multi-screen app implemented in `www/index.html`, `www/app.css`, `www/app.js` |
| VPS authentication | Done | JWT login, refresh, logout, revoke-session handling |
| Live monitoring UI | Done | Location list, live dashboard, vessel fill, relay state, heartbeat, offline/stale indicators |
| Command actions | Done | Mute, dry-run, force-clear with role checks and feedback |
| Device install flow | Done | Vendor install screen, BLE provisioning, cloud bind flow, local status checks |
| Device config flow | Done | Read, edit, push config, history, local LAN config save |
| Lifecycle management | Done | Faulty, under replacement, recommission, history |
| Complaints module | Done | Raise, view, status handling |
| Reports export | Done | Audit report filters and CSV export |
| User management | Done | Create users, filter users, access control, reset password |
| Vendor management | Done | Vendor listing and creation in app |
| FCM integration | Done | Firebase config, foreground/background notification handling |
| Version visibility in app | Done | Login and Settings show current version and release date |
| VPS-hosted app update check | Done | Settings page can check latest APK from VPS |
| Signed release APK | Done | Fresh signed release built as `1.0.1` / build `2` |
| Play Store pipeline | Pending | Current release channel is VPS-hosted APK, not Play Store |

### 1.2 Screens and Functional Modules Completed

| Screen / Module | Status | Notes |
|---|---|---|
| Login | Done | API base URL, login, revoked access/session-expiry handling |
| Locations | Done | Location cards, online state, bind/unbind flows, admin helpers |
| Live Dashboard | Done | Water level, distance, incident state, relay state, sensor status |
| Controls | Done | Alarm mute, dry run, force clear |
| Install | Done | BLE onboarding, Wi-Fi provisioning, local/cloud verification, bind flow |
| Device Config | Done | Thresholds, calibration values, cloud push, local LAN save |
| Audit | Done | Timeline view |
| Complaints | Done | Complaint raise and history |
| Users | Done | Create/filter/manage users |
| Vendors | Done | Vendor management for vendor super admin |
| Reports | Done | Filtered audit export |
| Settings | Done | Password change, version info, release tracking, update check |

## 2. Major App Work Completed Beyond the Original Plan

The original file was only a high-level target list. The actual app now includes these delivered items:

| Work Item | Status | Notes |
|---|---|---|
| BLE provisioning UI for FloodGuard hardware | Done | App talks directly to ESP32-S3 over BLE during install |
| Local LAN fallback checks | Done | App reads local `/status` and uses local config save path |
| Device claim and provision-profile flow | Done | App works with VPS device binding and provisioning APIs |
| Device lifecycle operations | Done | Operational status is managed from app |
| Complaint workflow | Done | Not part of original basic APK plan |
| Reports export | Done | Not part of original basic APK plan |
| Vendor management | Done | Not part of original basic APK plan |
| Password management | Done | Change/reset support |
| Session revoke handling | Done | Super admin revoke flow forces logout on next request |
| FCM push token registration | Done | App sends/updates FCM token to backend |
| Release tracking in app | Done | Current version visible to user |
| VPS APK update channel | Done | App can check latest version from backend and open APK download |

## 3. Integration Topology

```text
FloodGuard APK
  |
  | 1) BLE during first-time install
  v
ESP32-S3 Firmware
  |
  | 2) Wi-Fi + MQTT primary uplink
  v
MQTT Broker / VPS
  |
  | 3) HTTP APIs + JWT + FCM + audit + reports
  v
FloodGuard VPS Backend
  |
  | 4) App release manifest + hosted APK download
  v
FloodGuard APK update channel
```

Important architectural rule:

- The APK does not talk to MQTT directly.
- The APK talks to firmware directly only for BLE provisioning and some local LAN functions.
- Runtime monitoring and controls are done through VPS HTTP APIs.
- Firmware talks to MQTT directly and uses HTTP fallback when MQTT is unavailable.

## 4. App to Firmware Connection Contract

### 4.1 BLE Provisioning Contract

| Item | Current Contract | Must Stay Compatible |
|---|---|---|
| BLE service UUID | `0000ff00-0000-1000-8000-00805f9b34fb` | Yes |
| BLE characteristic UUID | `0000ff01-0000-1000-8000-00805f9b34fb` | Yes |
| BLE scan name prefix expected by app | `JXFG` in provisioning standard, app code scans FloodGuard BLE devices by configured prefix logic | Keep aligned between firmware and app |
| Core BLE command | `hello` | Yes |
| Wi-Fi scan command | `scan_wifi` | Yes |
| Provision command | `set_wifi` / `provision_wifi` / short alias `w` | Yes |
| Voltage config commands | `voltage_config_get`, `voltage_config_set` and ADC aliases | Yes |

### 4.2 Local LAN / Device HTTP Contract

| Purpose | Firmware Route / Contract | APK Usage |
|---|---|---|
| Device live status | `GET /status` | App checks whether local device is reachable and cloud-connected |
| Cloud provision/local cloud config | `GET /cloud?pin=...` and `POST /cloud?pin=...` | App saves VPS URL, MQTT host, provision key locally when needed |
| Local admin PIN | Default `654321` | App shows local PIN field in config screen |
| mDNS/local mode | Device serves local web/config endpoints after Wi-Fi join | App uses local reachability for install and config fallback |

### 4.3 What Firmware Changes Must Not Break

| If Firmware Changes | Keep This Stable |
|---|---|
| BLE stack is rewritten | Same service UUID, characteristic UUID, and JSON command names |
| Provisioning logic changes | App must still be able to request Wi-Fi scan and send Wi-Fi credentials |
| Local web server changes | `/status` and `/cloud` behavior must remain available or APK must be updated together |
| Config payload shape changes | Device config response and ACK path must stay aligned with APK config screen |
| Device naming changes | BLE/device ID mapping must still allow installers to identify and bind correct device |

## 5. Firmware to MQTT / VPS Connection Contract

### 5.1 MQTT Topic Contract

The current firmware code uses `rub/{deviceId}/...` topics. This is the active contract in `HARDWARE/firmware/src/mqtt_client.cpp` and in the VPS MQTT bridge.

| Direction | Topic | Purpose |
|---|---|---|
| Firmware -> MQTT | `rub/{deviceId}/telemetry` | Live telemetry payload |
| Firmware -> MQTT | `rub/{deviceId}/event` | State/event payloads |
| Firmware -> MQTT | `rub/{deviceId}/heartbeat` | Online heartbeat |
| Firmware -> MQTT | `rub/{deviceId}/command_ack` | Command acknowledgement |
| Firmware -> MQTT | `rub/{deviceId}/config_ack` | Config acknowledgement |
| VPS -> Firmware | `rub/{deviceId}/command` | Remote commands |
| VPS -> Firmware | `rub/{deviceId}/config` | Remote config push |
| VPS -> Firmware | `rub/{deviceId}/ota` | OTA commands |

### 5.2 MQTT Parsing Rule in VPS

| Item | Current Rule |
|---|---|
| Topic format | Exactly 3 segments |
| Topic parser | `{base}/{deviceId}/{channel}` |
| Topic base | `rub` |
| VPS subscriptions | `rub/+/telemetry`, `rub/+/event`, `rub/+/heartbeat`, `rub/+/command_ack` |

If MQTT base or topic shape changes, VPS backend and firmware must be updated together. The APK itself does not consume MQTT directly, but app live data depends on these topics reaching VPS correctly.

### 5.3 HTTP Fallback Contract Used by Firmware

| Firmware Fallback API | Purpose |
|---|---|
| `POST /api/device/telemetry` | Telemetry when MQTT publish is unavailable |
| `POST /api/device/event` | Event fallback |
| `POST /api/device/command_ack` | Command ACK fallback |
| `GET /api/device/:deviceId/commands/pending` | Pending command fetch |
| `GET /api/device/:deviceId/config` | Device config fetch |
| `GET /api/device/:deviceId/firmware/latest` | Firmware metadata |
| `POST /api/device/register` | Provision/register device |

## 6. APK to VPS API Contract

The APK runtime app primarily depends on VPS HTTP APIs. These are the main active contracts that must remain stable or be versioned carefully.

### 6.1 Auth and Session APIs

| API | Used For |
|---|---|
| `POST /api/auth/login` | Login |
| `POST /api/auth/refresh` | Silent token refresh |
| `GET /api/auth/me` | Session restore |
| `POST /api/auth/logout` | Logout |
| `POST /api/auth/change-password` | User password change |
| `POST /api/auth/reset-password` | Admin reset password |
| `PUT /api/auth/fcm-token` | Push token registration |

### 6.2 Core App Data APIs

| API | Used For |
|---|---|
| `GET /api/locations` | Location list |
| `GET /api/locations/:locationId/dashboard` | Live dashboard |
| `GET /api/incidents` | Incident list/state |
| `GET /api/audit-logs` | Audit timeline |

### 6.3 Command APIs

| API | Used For |
|---|---|
| `POST /api/commands/mute` | Alarm mute |
| `POST /api/commands/dry-run` | Dry-run trigger |
| `POST /api/commands/force-clear` | Manual incident force clear |

### 6.4 Device Provision / Config / Lifecycle APIs

| API | Used For |
|---|---|
| `POST /api/devices/:deviceId/claim` | Bind/register device to location |
| `POST /api/devices/:deviceId/provision-profile` | Cloud provisioning profile |
| `GET /api/devices/:deviceId/config` | Load config |
| `PUT /api/devices/:deviceId/config` | Save config |
| `POST /api/devices/:deviceId/config/push` | Push config to device |
| `GET /api/devices/:deviceId/config/history` | Config history |
| `GET /api/devices/:deviceId/lifecycle` | Lifecycle state |
| `PATCH /api/devices/:deviceId/lifecycle` | Lifecycle transition |
| `GET /api/devices/:deviceId/lifecycle/history` | Lifecycle history |

### 6.5 Admin / Complaints / Reports / Vendor APIs

| API Group | Used For |
|---|---|
| `/api/admin/users` | User creation and access revoke/grant |
| `/api/complaints/...` | Complaint workflow |
| `/api/reports/...` | Reports and exports |
| `/api/vendor-mgmt/...` | Vendor management |

## 7. APK Release Tracking and Update Pipeline

### 7.1 Current Release Tracking Contract

| Item | Current Value |
|---|---|
| APK visible version | `1.0.1` |
| Android build code | `2` |
| In-app release date label | `06 Jun 2026` |
| Public manifest API | `GET /api/app-release/mobile` |
| Public APK download base | `/downloads/floodguard/android/` |

### 7.2 VPS Update Channel Contract

| Component | Current Contract |
|---|---|
| Release manifest file | `VPS/backend/app-release.json` |
| Manifest route | `GET /api/app-release/mobile` |
| APK hosting path | `VPS/backend/downloads/floodguard/android/` |
| Current hosted APK name | `FloodGuard-v1.0.1-release.apk` |

### 7.3 Release Process to Follow

| Step | Action |
|---|---|
| 1 | Update app version and Android build code |
| 2 | Build signed release APK |
| 3 | Upload APK to VPS downloads folder |
| 4 | Update `app-release.json` with version, build code, date, notes |
| 5 | Restart `floodguard-api` |
| 6 | Verify `https://api.floodguard.iotsoft.in/api/app-release/mobile` |
| 7 | Verify public APK URL returns `200` |

## 8. Compatibility Rules for Future Engineers

### 8.1 If You Change Firmware

- Keep BLE UUIDs and provisioning JSON commands aligned with APK install flow.
- Keep `/status` and `/cloud` routes stable unless APK is updated together.
- Keep MQTT topic base `rub/{deviceId}/...` stable unless VPS is changed together.
- Keep command ACK and config ACK behavior stable.

### 8.2 If You Change MQTT

- Do not change topic segment count or base from `rub` without updating firmware and VPS together.
- APK runtime does not use MQTT directly, but live dashboard and command visibility depend on MQTT data reaching VPS.
- If MQTT auth model changes, firmware provisioning/profile generation must also change.

### 8.3 If You Change VPS

- Preserve auth APIs, dashboard APIs, config APIs, and app-release manifest API.
- Preserve device fallback APIs used by firmware.
- Preserve app-release manifest shape or ship APK changes together.
- Preserve FCM token update and notification path if push should continue working.

## 9. Remaining / Optional Work

| Item | Priority | Notes |
|---|---|---|
| Play Store publishing flow | Medium | Current distribution is VPS APK |
| Forced update policy | Medium | Backend manifest already supports `forceUpdate` field |
| Automatic APK install helper flow | Low | Current app opens download URL; manual install still expected |
| Deeper release notes/history screen | Low | Current app shows latest version and notes only |
| BLE naming standard cleanup | Medium | Firmware and provisioning docs should stay aligned on final name convention |

## 10. Reference Files

| File | Why It Matters |
|---|---|
| `APK/www/app.js` | Main app runtime logic |
| `APK/www/index.html` | Screen structure |
| `APK/android/app/build.gradle` | Android version code and version name |
| `HARDWARE/firmware/src/mqtt_client.cpp` | MQTT topic contract |
| `HARDWARE/firmware/src/http_fallback.cpp` | Firmware fallback APIs |
| `HARDWARE/firmware/src/ble_provisioning.cpp` | BLE provisioning contract |
| `HARDWARE/firmware/src/local_config_server.cpp` | Local `/status` and `/cloud` routes |
| `VPS/backend/src/routes/index.js` | Main API mount map |
| `VPS/backend/src/routes/deviceRoutes.js` | Firmware-facing routes |
| `VPS/backend/src/routes/deviceConfigRoutes.js` | App config/lifecycle routes |
| `VPS/backend/src/mqtt/mqttBridge.js` | MQTT subscription contract |
| `VPS/backend/src/mqtt/topicParser.js` | Topic shape contract |
| `VPS/backend/app-release.json` | APK release manifest |

