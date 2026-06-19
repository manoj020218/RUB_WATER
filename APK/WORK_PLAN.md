# FloodGuard APK Work Plan and Current Progress

Document purpose: this file is no longer only a basic APK to-do list. It is now the current app delivery status plus the integration contract between APK, firmware, MQTT, and VPS so future changes do not break the working system.

Last updated: 2026-06-19
Current signed release target: `1.0.1` (existing signed APK)
Current Android build code: `2`
Primary package id: `in.jenix.floodguard`

## 0. Latest Completed Work Snapshot (2026-06-19)

This section reflects the real current codebase state after the latest APK and backend work. Some older sections below remain useful as reference, but this snapshot is the authoritative status for recent changes.

### 0.1 Completed in This Round

| Work Item | Status | Notes |
|---|---|---|
| Demo role separation | Done | `demo` is no longer treated as a normal global `VENDOR_SUPER_ADMIN`; it now has demo-only scoped visibility |
| Demo location ownership model | Done | Demo can see only locations/devices created by demo until transferred |
| Location + device transfer pipeline | Done | Separate sender/receiver/rights pipeline added so location transfer logic can be reused later |
| Demo transfer restriction | Done | Demo can transfer to existing user or create only `VENDOR_SUPER_ADMIN` during transfer |
| Vendor to department assignment model | Done | Vendor can share location/device to one specific `DEPARTMENT_SUPER_ADMIN` without exposing it to all department admins |
| Department downstream user creation | Done | Department super admin can create subordinate users only within assigned location scope |
| Vendor tab removal from APK | Done | Mistakenly shipped vendor-management UI removed from APK and preserved separately |
| Preserved vendor-management code | Done | Extracted copy saved under `APK/extracted/vendor-management-from-apk/`; VPS-side vendor tool kept separately |
| Same-network Wi-Fi S3 discovery | Done | New APK button scans current subnet via `GET /api/status`, filters `product` starting with `FLOODGUARD`, and supports one-tap local URL selection |
| Android Wi-Fi subnet bridge | Done | Native bridge now returns SSID, IP, gateway, and netmask for LAN scan planning |

### 0.2 Verification Done

| Verification | Status | Notes |
|---|---|---|
| APK JS syntax check | Done | `node --check www/app.js` passed |
| Android native compile check | Done | `gradlew.bat compileDebugJavaWithJavac` passed |
| Demo scoped visibility behavior | Done | Verified in backend smoke flow during transfer-role work |
| Demo transfer behavior | Done | Verified demo loses access after `MOVE` transfer |
| Vendor to department targeted assignment | Done | Verified assigned department user sees location/device, other department users do not |

### 0.3 Important Current Notes

- The latest code changes are in the workspace, but a fresh signed APK has **not** yet been rebuilt after the Wi-Fi discovery addition.
- Vendor management is now treated as a VPS/developer-side tool, not a shipped APK feature.
- The new same-network scan relies on the device local endpoint returning `/api/status` with `device_id`, `product`, `mac`, `firmware`, Wi-Fi state, IP, and MQTT state.

### 0.4 Quick Release Build Command

Use this from `D:\IOT Device\RUB\FloodGuard\APK` to make a signed release APK with the existing keystore setup:

```powershell
npx cap sync android; Set-Location .\android; .\gradlew.bat assembleRelease
```

Output APK:

```text
D:\IOT Device\RUB\FloodGuard\APK\android\app\build\outputs\apk\release\app-release.apk
```

Notes:

- No manual signing step is needed as long as `android\keystore.properties` is present and valid.
- This is the normal release build command. No `clean` is needed for regular app changes.
- If only APK install is needed after build, use the generated `app-release.apk` above.

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
| Transfer pipeline | Done | Sender/receiver/rights location transfer flow with demo/vendor restrictions |
| Same-network Wi-Fi discovery | Done | Install screen can scan current subnet for local FloodGuard S3 devices |
| Vendor management in APK | Removed | APK vendor tab removed; preserved separately for VPS/developer use only |
| FCM integration | Done | Firebase config, foreground/background notification handling |
| Version visibility in app | Done | Login and Settings show current version and release date |
| VPS-hosted app update check | Done | Settings page can check latest APK from VPS |
| Signed release APK | Done | Existing signed release built as `1.0.1` / build `2`; latest code changes are pending rebuild |
| Play Store pipeline | Pending | Current release channel is VPS-hosted APK, not Play Store |

### 1.2 Screens and Functional Modules Completed

| Screen / Module | Status | Notes |
|---|---|---|
| Login | Done | API base URL, login, revoked access/session-expiry handling |
| Locations | Done | Location cards, online state, bind/unbind flows, admin helpers |
| Live Dashboard | Done | Water level, distance, incident state, relay state, sensor status |
| Controls | Done | Alarm mute, dry run, force clear |
| Install | Done | BLE onboarding, Wi-Fi provisioning, local/cloud verification, bind flow, same-network Wi-Fi scan |
| Device Config | Done | Thresholds, calibration values, cloud push, local LAN save |
| Audit | Done | Timeline view |
| Complaints | Done | Complaint raise and history |
| Users | Done | Create/filter/manage users, transfer flow support, role-scoped assignment behavior |
| Vendors | Removed | Vendor tab/code moved out of APK and preserved separately |
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
| Vendor management | Moved out of APK | Preserved separately for VPS/developer-side use; no longer shipped in mobile UI |
| Demo/vendor transfer access model | Done | Added after original APK plan |
| Same-network Wi-Fi discovery | Done | Added after original APK plan |
| Password management | Done | Change/reset support |
| Session revoke handling | Done | Super admin revoke flow forces logout on next request |
| FCM push token registration | Done | App sends/updates FCM token to backend |
| Release tracking in app | Done | Current version visible to user |
| VPS APK update channel | Done | App can check latest version from backend and open APK download |

## 3. Integration Topology

```text
FloodGuard APK
  |
  | 1) BLE during first-time install (JXFG prefix, service 0000ff00...)
  v
ESP32-S3 Firmware (EH-S3-WSTTL-ST485-RL-MAX485-DYP-L1L2-LVT v0.2.0)
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
| BLE device name prefix | `JXFG` + last 6 hex MAC digits (e.g. `JXFGBAF968`) | Yes — firmware fixed 2026-06-08 |
| Core BLE command | `hello` | Yes |
| Wi-Fi scan command | `scan_wifi` | Yes |
| Provision command | `set_wifi` / short alias `w` | Yes |
| Voltage config commands | `voltage_config_get`, `voltage_config_set` | Yes |

**Note:** Before 2026-06-08 the BLE name was `FgMain{MAC}`. It is now `JXFG{MAC}`.
If the app scans by prefix, confirm the app filter is set to `JXFG` (not `FgMain`).

### 4.2 Provisioning Flow (Production Device)

The production firmware (`floodguard_edgehax_s3_st485_wave485` env) contains **no hardcoded WiFi**.
First-boot provisioning sequence:

```
1. Device powers on → no WiFi in NVS
2. BLE starts advertising as JXFG{MAC}
3. App scans BLE → finds device → user enters WiFi credentials
4. App sends {"cmd":"set_wifi","ssid":"...","password":"..."} over BLE
5. Firmware connects WiFi → saves to NVS → replies with IP
6. App gets IP → BLE can stop → device runs full stack
7. mDNS: http://fg-main-edgehax-01.local/  (maintenance WebUI)
```

AP fallback (CONFIG button held 5s): opens `JXFG{MAC}` AP for 15 min for local WebUI access.
Factory reset (CONFIG button held 5s at power-on): clears WiFi NVS → reboots to BLE provisioning.

### 4.3 Local LAN / Device HTTP Contract

| Purpose | Firmware Route | APK Usage |
|---|---|---|
| Device live status | `GET /status` | App checks whether local device is reachable and cloud-connected |
| Local admin PIN | Default `654321` | App shows local PIN field in config screen |
| mDNS hostname | `fg-main-edgehax-01.local` | App uses local reachability for install and config fallback |
| Local WebUI | `http://fg-main-edgehax-01.local/` | All maintenance pages (config, relay test, OTA upload) |

### 4.4 What Firmware Changes Must Not Break

| If Firmware Changes | Keep This Stable |
|---|---|
| BLE stack is rewritten | Same service UUID, characteristic UUID, and JSON command names |
| Provisioning logic changes | App must still be able to request Wi-Fi scan and send Wi-Fi credentials |
| Local web server changes | `/status` and `/cloud` behavior must remain available or APK must be updated together |
| Config payload shape changes | Device config response and ACK path must stay aligned with APK config screen |
| BLE name prefix changes | Update app BLE scan filter to match — currently `JXFG` |

## 5. Active Firmware — Production Delivery

### 5.1 Firmware Identity

| Field | Value |
|---|---|
| Firmware name | `EH-S3-WSTTL-ST485-RL-MAX485-DYP-L1L2-LVT` |
| Version | `0.2.0` |
| Release date | `2026-06-08` |
| PlatformIO env (prod) | `floodguard_edgehax_s3_st485_wave485` |
| PlatformIO env (bench) | `floodguard_edgehax_s3_st485_wave485_dev` — **never flash to field device** |
| Hardware | Edgehax ESP32-S3-WROOM-1 N16R8 |
| Hardware version | `EH-S3-02` |

### 5.2 Hardware Architecture

| Component | Detail |
|---|---|
| MCU | ESP32-S3-WROOM-1 N16R8 (16 MB flash, 8 MB PSRAM) |
| Flood sensor | DYP-A01 ultrasonic (TTL direct, GPIO21 RX, GPIO20 TX) |
| RS485 interface | Waveshare TTL-to-RS485 (B) — auto-direction, no DE/RE |
| Remote relay | ST485-C10-05-4CH Modbus RTU (R1=siren, R2=flash, R3=voice, R4=boom) |
| RS485 bus (right) | GPIO39 TX → Waveshare RXD, GPIO38 RX → Waveshare TXD |
| RS485 slave ID | 1 (both buses) |
| Baud rate | 9600, 8N1 |
| Relay confirmation | NC feedback via DI1–DI3 (IN1–IN3), LM393 via DI4 (IN4) |

### 5.3 Provisioning Method (Production)

- **WiFi:** BLE provisioning only — no hardcoded credentials in production build
- **BLE name:** `JXFG{6-hex-MAC}` (e.g. `JXFGBAF968`)
- **BLE service:** `0000ff00-0000-1000-8000-00805f9b34fb`
- **BLE char:** `0000ff01-0000-1000-8000-00805f9b34fb`
- **AP fallback:** `JXFG{6-hex-MAC}` maintenance AP (CONFIG button 5s)
- **Factory reset:** CONFIG button held at power-on 5s → clears WiFi NVS → BLE mode

### 5.4 Local WebUI Pages (ST485 mode)

| Route | Purpose |
|---|---|
| `/status` | Live sensor, FSM, battery, right bus ST485 status |
| `/config` | Flood thresholds, pump config, reboot schedule |
| `/calibration` | Sensor zero, battery ADC calibration |
| `/relay-test` | LEFT/RIGHT bus selector → R1–R4 individual ON/OFF + local S3 relay test |
| `/remote-test` | Right bus ST485 4CH status + R1–R4 manual control |
| `/diagnostics` | Heap, PSRAM, WiFi RSSI, SD |
| `/firmware-upload` | Local OTA — shows current name/version/date, blocked during alarm/pump |
| `/reboot` | Reboot device |
| `/factory-reset-confirm` | Erase WiFi, reboot to BLE mode |

## 6. Firmware to MQTT / VPS Connection Contract

### 6.1 MQTT Topic Contract

| Direction | Topic | Purpose |
|---|---|---|
| Firmware → MQTT | `rub/{deviceId}/telemetry` | Live telemetry payload |
| Firmware → MQTT | `rub/{deviceId}/event` | State/event payloads |
| Firmware → MQTT | `rub/{deviceId}/heartbeat` | Online heartbeat |
| Firmware → MQTT | `rub/{deviceId}/command_ack` | Command acknowledgement |
| Firmware → MQTT | `rub/{deviceId}/config_ack` | Config acknowledgement |
| VPS → Firmware | `rub/{deviceId}/command` | Remote commands |
| VPS → Firmware | `rub/{deviceId}/config` | Remote config push |
| VPS → Firmware | `rub/{deviceId}/ota` | OTA commands |

### 6.2 MQTT Parsing Rule in VPS

| Item | Current Rule |
|---|---|
| Topic format | Exactly 3 segments |
| Topic parser | `{base}/{deviceId}/{channel}` |
| Topic base | `rub` |
| VPS subscriptions | `rub/+/telemetry`, `rub/+/event`, `rub/+/heartbeat`, `rub/+/command_ack` |

### 6.3 HTTP Fallback Contract Used by Firmware

| Firmware Fallback API | Purpose |
|---|---|
| `POST /api/device/telemetry` | Telemetry when MQTT publish is unavailable |
| `POST /api/device/event` | Event fallback |
| `POST /api/device/command_ack` | Command ACK fallback |
| `GET /api/device/:deviceId/commands/pending` | Pending command fetch |
| `GET /api/device/:deviceId/config` | Device config fetch |
| `GET /api/device/:deviceId/firmware/latest` | Firmware metadata |
| `POST /api/device/register` | Provision/register device |

## 7. APK to VPS API Contract

### 7.1 Auth and Session APIs

| API | Used For |
|---|---|
| `POST /api/auth/login` | Login |
| `POST /api/auth/refresh` | Silent token refresh |
| `GET /api/auth/me` | Session restore |
| `POST /api/auth/logout` | Logout |
| `POST /api/auth/change-password` | User password change |
| `POST /api/auth/reset-password` | Admin reset password |
| `PUT /api/auth/fcm-token` | Push token registration |

### 7.2 Core App Data APIs

| API | Used For |
|---|---|
| `GET /api/locations` | Location list |
| `GET /api/locations/:locationId/dashboard` | Live dashboard |
| `GET /api/incidents` | Incident list/state |
| `GET /api/audit-logs` | Audit timeline |

### 7.3 Command APIs

| API | Used For |
|---|---|
| `POST /api/commands/mute` | Alarm mute |
| `POST /api/commands/dry-run` | Dry-run trigger |
| `POST /api/commands/force-clear` | Manual incident force clear |

### 7.4 Device Provision / Config / Lifecycle APIs

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

### 7.5 Admin / Complaints / Reports / Vendor APIs

| API Group | Used For |
|---|---|
| `/api/admin/users` | User creation and access revoke/grant |
| `/api/complaints/...` | Complaint workflow |
| `/api/reports/...` | Reports and exports |
| `/api/vendor-mgmt/...` | Preserved for VPS/developer-side vendor tool, not current shipped APK UI |

## 8. APK Release Tracking and Update Pipeline

### 8.1 Current Release Tracking Contract

| Item | Current Value |
|---|---|
| APK visible version | `1.0.1` |
| Android build code | `2` |
| In-app release date label | `06 Jun 2026` |
| Public manifest API | `GET /api/app-release/mobile` |
| Public APK download base | `/downloads/floodguard/android/` |

### 8.2 VPS Update Channel Contract

| Component | Current Contract |
|---|---|
| Release manifest file | `VPS/backend/app-release.json` |
| Manifest route | `GET /api/app-release/mobile` |
| APK hosting path | `VPS/backend/downloads/floodguard/android/` |
| Current hosted APK name | `FloodGuard-v1.0.1-release.apk` |

### 8.3 Release Process to Follow

| Step | Action |
|---|---|
| 1 | Update app version and Android build code |
| 2 | Build signed release APK |
| 3 | Upload APK to VPS downloads folder |
| 4 | Update `app-release.json` with version, build code, date, notes |
| 5 | Restart `floodguard-api` |
| 6 | Verify `https://api.floodguard.iotsoft.in/api/app-release/mobile` |
| 7 | Verify public APK URL returns `200` |

## 9. Compatibility Rules for Future Engineers

### 9.1 If You Change Firmware

- Keep BLE UUIDs and provisioning JSON commands aligned with APK install flow.
- BLE device name prefix is `JXFG` — app scan filter must match.
- Production build (`floodguard_edgehax_s3_st485_wave485`) must never have hardcoded WiFi.
- Keep `/status` and `/cloud` routes stable unless APK is updated together.
- Keep MQTT topic base `rub/{deviceId}/...` stable unless VPS is changed together.
- Keep command ACK and config ACK behavior stable.
- Dev bench env (`_dev`) has hardcoded WiFi — never flash to field device.

### 9.2 If You Change MQTT

- Do not change topic segment count or base from `rub` without updating firmware and VPS together.
- APK runtime does not use MQTT directly, but live dashboard and command visibility depend on MQTT data reaching VPS.
- If MQTT auth model changes, firmware provisioning/profile generation must also change.

### 9.3 If You Change VPS

- Preserve auth APIs, dashboard APIs, config APIs, and app-release manifest API.
- Preserve device fallback APIs used by firmware.
- Preserve app-release manifest shape or ship APK changes together.
- Preserve FCM token update and notification path if push should continue working.

## 10. Remaining / Optional Work

| Item | Priority | Notes |
|---|---|---|
| Play Store publishing flow | Medium | Current distribution is VPS APK |
| Forced update policy | Medium | Backend manifest already supports `forceUpdate` field |
| Automatic APK install helper flow | Low | Current app opens download URL; manual install still expected |
| Internet-offline banner in WebUI | Low | Documented in PROVISIONING.md §4; not yet implemented in firmware |
| BLE NOTIFY characteristic | Low | App polls; push events not implemented yet — see PROVISIONING.md §6.1 |
| IN4 LM393 hardware (battery low) | Hardware | LM393 circuit not yet installed; IN4 floating = always reports batt_low |
| R4 boom barrier activation | Future | R4 always OFF in firmware; one-line enable + OTA when hardware arrives |

## 11. Reference Files

| File | Why It Matters |
|---|---|
| `APK/www/app.js` | Main app runtime logic |
| `APK/www/index.html` | Screen structure |
| `APK/android/app/build.gradle` | Android version code and version name |
| `HARDWARE/firmware_EDGEHAX_S3_ST485_RTU4ch_WAVE485/firmware/src/ble_provisioning.cpp` | BLE provisioning contract (JXFG prefix) |
| `HARDWARE/firmware_EDGEHAX_S3_ST485_RTU4ch_WAVE485/firmware/src/mqtt_manager.cpp` | MQTT topic contract |
| `HARDWARE/firmware_EDGEHAX_S3_ST485_RTU4ch_WAVE485/firmware/src/http_fallback.cpp` | Firmware fallback APIs |
| `HARDWARE/firmware_EDGEHAX_S3_ST485_RTU4ch_WAVE485/firmware/src/local_webserver.cpp` | Local WebUI routes |
| `HARDWARE/firmware_EDGEHAX_S3_ST485_RTU4ch_WAVE485/firmware/platformio.ini` | Build environments (prod vs dev bench) |
| `HARDWARE/firmware_EDGEHAX_S3_ST485_RTU4ch_WAVE485/firmware/FIRMWARE_NOTES.md` | Full hardware/software design reference |
| `HARDWARE/PROVISIONING.md` | Provisioning standard (BLE flow, naming, AP fallback) |
| `VPS/backend/src/routes/index.js` | Main API mount map |
| `VPS/backend/src/routes/deviceRoutes.js` | Firmware-facing routes |
| `VPS/backend/src/mqtt/mqttBridge.js` | MQTT subscription contract |
| `VPS/backend/app-release.json` | APK release manifest |
