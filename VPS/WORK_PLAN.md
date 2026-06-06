# FloodGuard VPS Work Plan and Current Progress

Last updated: 2026-06-06

This document is the VPS-side handover and current-state reference. It replaces the original high-level plan with what is actually implemented in the `VPS` code today.

This document is intentionally VPS-only. Hardware is still being finalized, so the hardware sections below describe the current interface contract that the VPS expects, not a final hardware freeze.

## 1. Current Delivery Status

| Area | Status | Current reality |
| --- | --- | --- |
| Core API backend | Implemented and in use | Express app with auth, monitoring, commands, admin, complaints, reports, integration, device APIs |
| Storage layer | Implemented but not final production architecture | In-memory datastore with JSON file persistence, not MongoDB-backed in current code |
| MQTT bridge | Implemented | Subscribes to telemetry, event, heartbeat, command ACK, config ACK |
| HTTP fallback for devices | Implemented | Telemetry/event ingest, pending command fetch, command ACK, config ACK, config fetch, firmware metadata |
| Incident engine | Implemented | Opens, updates, auto-clears, and force-clears incidents |
| Audit logging | Implemented | Command, config, claim/provision, and integration actions are audited |
| Role-based access control | Implemented | Permission matrix enforced in service layer |
| Device config management | Implemented | Read, update, re-push, config history, config ACK flow |
| Device provisioning and claim | Implemented | Claim flow, provision profile issuance, registration by provision key |
| Device lifecycle tracking | Implemented | Lifecycle state and history routes exist |
| Complaints workflow | Implemented | Raise, acknowledge, assign, comment, resolve, close |
| Reports | Implemented | Audit report JSON/API and downloadable output |
| Live updates | Implemented | WebSocket server at `/ws/live` |
| FCM notifications | Implemented | Depends on `firebase-admin` and service account file on VPS |
| Head-office integration | Implemented | Pull API plus outbound webhook push with retry and signature support |
| Mobile APK release tracking | Implemented | VPS-hosted release manifest and downloadable APK |
| Firmware metadata endpoint | Implemented | Device can ask for latest firmware metadata |
| OTA publish pipeline | Not fully implemented on VPS | Metadata exists, but VPS does not currently publish OTA jobs to devices |
| Retention compaction | Implemented | Manual admin-triggered no-water compaction job exists |

## 2. Actual Runtime Architecture

| Component | Current implementation | Key files | Notes |
| --- | --- | --- | --- |
| HTTP server | Node.js + Express | `backend/src/server.js`, `backend/src/app.js` | Loads persisted data, starts API, MQTT, WebSocket, webhook dispatcher |
| Persistence | In-memory arrays + JSON autosave | `backend/src/db/datastore.js`, `backend/src/db/persistence.js` | Auto-saves every 5 seconds to `backend/data/floodguard_db.json` |
| Seeding | Seed demo/reference records when store is empty | `backend/src/db/seed.js` | Useful for development, must be reviewed before final production data policy |
| API routes | Modular Express routers under `/api` | `backend/src/routes/*.js` | User-facing API, device API, integration API, release API |
| Static UI hosting | Express static folders | `backend/src/app.js` | Serves `/dashboard`, `/vendors`, `/downloads` |
| MQTT bridge | MQTT client subscriber | `backend/src/mqtt/mqttBridge.js`, `backend/src/mqtt/messageRouter.js` | Processes device telemetry/event/heartbeat/ACK traffic |
| Live feed | WebSocket broadcast server | `backend/src/services/liveSocketService.js` | WebSocket path is `/ws/live` |
| Notifications | Session-based FCM push | `backend/src/services/notificationService.js`, `backend/src/services/fcmService.js` | Uses FCM token stored per active session |
| Outbound integration | Webhook dispatcher | `backend/src/services/headOfficeIntegrationService.js` | Push mode supports retries and optional signature |

## 3. Storage Reality and Important Warning

The original plan mentioned MongoDB collections. The current code does not use MongoDB for persistence, even though `VPS_SHIFT_CONFIG.json` still contains MongoDB settings.

Current storage model:

| Data type | Current storage behavior |
| --- | --- |
| `users`, `vendors`, `projects`, `locations`, `devices`, `deviceConfigs`, `deviceConfigHistory`, `firmwareVersions`, `appVersions`, `incidents`, `complaints`, `notifications`, `integrationSettings` | Persisted to `backend/data/floodguard_db.json` |
| `telemetry`, `auditLogs`, `commands`, `userSessions`, `integrationDeliveryLogs`, `deviceLifecycleHistory` | In-memory only, intentionally excluded from JSON persistence |

Implications:

- A VPS restart can lose telemetry history, audit logs, pending commands, active sessions, integration delivery logs, and lifecycle history.
- The system auto-saves every 5 seconds, but only for the persisted collections listed above.
- If long-term telemetry, audit, command durability, or compliance retention is required, this must move to a durable database before calling the VPS storage layer production-final.

## 4. Security and Access Model

| Area | Current implementation |
| --- | --- |
| User auth | JWT-based auth with login, refresh, me, logout, password change/reset |
| Session tracking | Per-session records stored in memory; FCM token is tied to session |
| Role model | `VENDOR_SUPER_ADMIN`, `VENDOR_MONITORING_USER`, `DEPARTMENT_SUPER_ADMIN`, `DEPARTMENT_ADMIN`, `LOCATION_ADMIN`, `OPERATOR`, `VIEWER`, `AUDITOR`, `THIRD_PARTY_MONITORING_USER` |
| RBAC enforcement | Checked in services, not only in routes |
| Device ingress auth | `x-api-key` or device token (`x-device-key` / `x-device-token`) |
| Provisioning lock | `x-provision-key` enforced when `requireDeviceProvisionKey=true` |
| Integration auth | Bearer token matched against integration settings |
| CORS | Explicit allowlist from config plus local/mobile dev origins |

Important current config notes:

- `allowDeviceIdAuth` is currently `false`, which is correct for safer device auth.
- `VPS_SHIFT_CONFIG.json` still contains development-looking secrets such as `jwtSecret: CHANGE_THIS_IN_PRODUCTION`; these values must be treated as configuration risk until production secrets are fully managed outside repo defaults.

## 5. Public Runtime Surface

| Path | Purpose |
| --- | --- |
| `/` | Redirects to `/dashboard/FloodGuard_Desktop_UI.html` |
| `/dashboard` | Static FloodGuard desktop/dashboard frontend |
| `/vendors` | Static vendor management frontend |
| `/downloads` | Static APK download hosting |
| `/health` | Service health probe |
| `/ws/live` | Live WebSocket feed |
| `/api/*` | Main backend API surface |

## 6. User and Admin API Surface

All routes below are mounted under `/api`.

| Route group | Main paths | Purpose |
| --- | --- | --- |
| Auth | `/auth/login`, `/auth/refresh`, `/auth/me`, `/auth/logout`, `/auth/change-password`, `/auth/reset-password`, `/auth/fcm-token` | User auth and session/FCM management |
| Monitoring | `/locations`, `/locations/:locationId/dashboard`, `/incidents`, `/audit-logs` | Dashboard data, location status, incidents, audit views |
| Commands | `/commands/mute`, `/commands/dry-run`, `/commands/force-clear` | Operational control commands |
| Device management | `/devices/:deviceId/claim`, `/devices/:deviceId/provision-profile`, `/devices/:deviceId/config`, `/devices/:deviceId/config/push`, `/devices/:deviceId/config/history`, `/devices/:deviceId/lifecycle`, `/devices/:deviceId/lifecycle/history` | Claim/provisioning, config, lifecycle |
| Complaints | `/complaints`, `/complaints/:complaintId`, `/complaints/:complaintId/acknowledge`, `/complaints/:complaintId/assign`, `/complaints/:complaintId/comments`, `/complaints/:complaintId/resolve`, `/complaints/:complaintId/close` | Complaint workflow |
| Reports | `/reports/audit`, `/reports/audit/download/:format` | Audit reporting and export |
| Admin | `/admin/jobs/no-water-compaction`, `/admin/users`, `/admin/locations`, `/admin/devices`, `/admin/device-configs` | Maintenance jobs, user/location/device administration |
| Vendor management | `/vendor-mgmt/projects`, `/vendor-mgmt/vendors` and vendor sub-actions | Project/vendor CRUD and vendor credential control |
| Integration management | `/integration/settings`, `/integration/delivery-logs` | Configure external head-office integration |
| Mobile release | `/app-release/mobile` | APK release/version manifest for the mobile app |

## 7. Device Ingress API Surface

These routes are mounted under `/api/device`.

| Path | Direction | Purpose |
| --- | --- | --- |
| `POST /register` | Device -> VPS | Register device using provision key and receive cloud/device token details |
| `POST /telemetry` | Device -> VPS | HTTP telemetry fallback ingest |
| `POST /event` | Device -> VPS | HTTP event fallback ingest |
| `GET /:deviceId/commands/pending` | Device <- VPS | Device polls for pending commands |
| `POST /commands/:commandId/ack` | Device -> VPS | Command ACK |
| `POST /command_ack` | Device -> VPS | Legacy command ACK path |
| `POST /config_ack` | Device -> VPS | Device config ACK |
| `GET /:deviceId/config` | Device <- VPS | Current config payload |
| `GET /:deviceId/firmware/latest` | Device <- VPS | Firmware metadata lookup |

## 8. Firmware, MQTT, and VPS Contract

This is the most important section for avoiding breakage when firmware changes.

### 8.1 MQTT Topic Contract

Topic parser expects exactly three path segments:

`{topicBase}/{deviceId}/{channel}`

Current `topicBase` from config is `rub`.

| Direction | Topic | VPS behavior |
| --- | --- | --- |
| Device -> VPS | `rub/{deviceId}/telemetry` | Ingest telemetry, update device runtime, open/update danger incident if threshold crossed |
| Device -> VPS | `rub/{deviceId}/event` | Ingest event, update incident/notification/audit state |
| Device -> VPS | `rub/{deviceId}/heartbeat` | Update online/offline heartbeat state |
| Device -> VPS | `rub/{deviceId}/command_ack` | Mark command as acknowledged/executed |
| Device -> VPS | `rub/{deviceId}/config_ack` | Mark config push success/reject and update config state/history |
| VPS -> Device | `rub/{deviceId}/config` | Push config update payload to device |

Important current reality:

- The VPS subscribes to MQTT for ingest and ACK channels.
- The VPS currently publishes config updates over MQTT.
- The VPS does not currently publish regular operational commands such as mute, dry-run, or force-clear over MQTT.
- The firmware may still contain an `ota` topic concept, but the current VPS code does not publish OTA jobs to that topic.

### 8.2 Command Flow Contract

| Command type | Current delivery path | ACK path |
| --- | --- | --- |
| `MUTE_ALARM` | Stored in VPS command queue, device must poll `GET /api/device/:deviceId/commands/pending` | HTTP or MQTT `command_ack` |
| `DRY_RUN` | Stored in VPS command queue, device must poll pending commands | HTTP or MQTT `command_ack` |
| `FORCE_CLEAR` | Stored in VPS command queue, device must poll pending commands | HTTP or MQTT `command_ack` |
| `UPDATE_CONFIG` | Stored in VPS command queue and also published to MQTT topic `rub/{deviceId}/config` | HTTP or MQTT `config_ack` |

This means firmware changes must not assume that all commands arrive through MQTT. Current production logic is mixed:

- Operational commands are pull-based over HTTP.
- Config updates are both queued and MQTT-pushed.

### 8.3 Device Registration and Cloud Profile Contract

When a device registers successfully, the VPS returns:

| Field group | Purpose |
| --- | --- |
| `device_key` / `device_token` | Device-side auth credential |
| `cloud.vps_base_url` / `cloud.api_base_url` / `cloud.health_url` | HTTP endpoints device should use |
| `cloud.mqtt.host` / `cloud.mqtt.port` / `cloud.mqtt.username` / `cloud.mqtt.password` | MQTT connection details |
| `cloud.auth_headers` | Header names expected by VPS |

If firmware registration payloads or returned field names change, this contract must be updated together on both sides.

## 9. How VPS Connects to Firmware, MQTT, and External Systems

| Connection | Current mechanism | Main code path | Must remain stable unless coordinated |
| --- | --- | --- | --- |
| Firmware -> VPS telemetry | MQTT primary, HTTP fallback | `mqtt/messageRouter.js`, `services/deviceService.js`, `/api/device/telemetry` | Payload keys such as `device_id`, `location_id`, `water_level_mm`, status fields |
| Firmware -> VPS events | MQTT primary, HTTP fallback | `services/deviceService.js`, `/api/device/event` | Event naming and event payload structure |
| Firmware -> VPS heartbeat | MQTT | `services/deviceService.js` | Topic name and online/offline heartbeat fields |
| VPS -> Firmware commands | HTTP polling by device | `/api/device/:deviceId/commands/pending` | Device polling behavior and command schema |
| VPS -> Firmware config | MQTT publish plus HTTP config fetch | `services/deviceConfigService.js`, `mqtt/outboundPublisher.js`, `/api/device/:deviceId/config` | Config field names and config ACK behavior |
| VPS -> MQTT broker | Local broker client auth | `config/env.js`, `mqtt/mqttBridge.js` | Broker host/port/user/pass and topic base |
| APK/Web -> VPS | HTTPS JSON API + WebSocket | `/api/*`, `/ws/live` | Auth model, response envelope, route names |
| VPS -> FCM | Firebase Admin SDK | `services/fcmService.js` | Service account path and token/session mapping |
| VPS -> Head office | Pull API plus outbound webhook | `services/headOfficeIntegrationService.js` | Integration token model, event schema, retry/signature logic |

## 10. Incident, Audit, Notification, and Retention Behavior

| Area | Current behavior |
| --- | --- |
| Incident open/update | Danger telemetry or danger-confirmed events create/update active incident |
| Auto clear | `DANGER_AUTO_CLEARED` event closes incident automatically |
| Force clear | User `FORCE_CLEAR` both queues command and closes active incident with reason |
| Audit logging | Command requests, config changes, device claim/provision, local config changes, integration updates, ACK outcomes |
| Notifications | FCM notification fan-out based on active sessions and role/location access |
| Live updates | Realtime bus publishes to WebSocket subscribers by location |
| Retention job | `/api/admin/jobs/no-water-compaction` compacts no-water telemetry into summary rows |

Retention warning:

- Because `telemetry` and `auditLogs` are not persisted to disk in current code, retention behavior is only meaningful within the active process lifetime unless a durable DB layer is added.

## 11. Head-Office Integration Contract

Current integration mode supports both pull and push.

### 11.1 Pull API

Routes are under `/api/integration/v1` and require a Bearer integration token.

| Path | Purpose |
| --- | --- |
| `/locations` | List locations with status summary |
| `/locations/:locationId/live` | Live location/device/sensor snapshot |
| `/locations/:locationId/incidents` | Incident history for location |
| `/locations/:locationId/audit-logs` | Audit log view for location |
| `/devices/:deviceId/status` | Device runtime status |
| `/summary` | Overall department summary |

### 11.2 Push Webhook

| Feature | Current behavior |
| --- | --- |
| Push trigger source | Realtime bus events |
| Supported mode | `PULL`, `PUSH`, `PULL_AND_PUSH` |
| Telemetry throttling | Controlled by `send_telemetry_interval_seconds` |
| Event-only mode | `send_only_events` can suppress telemetry pushes |
| Auth | Optional outbound bearer token |
| Signature | Optional `X-FloodGuard-Timestamp` and `X-FloodGuard-Signature` HMAC |
| Retry schedule | 30s, 120s, 300s, 900s |
| Delivery logs | Stored in memory only in current code |

## 12. APK Release and Update Pipeline Through VPS

The VPS now acts as the temporary release server until Play Store rollout is available.

| Piece | Current implementation |
| --- | --- |
| Release manifest source | `backend/app-release.json` |
| Public manifest API | `/api/app-release/mobile` |
| APK hosting folder | `backend/downloads/floodguard/android/` |
| Public APK URL pattern | `https://api.floodguard.iotsoft.in/downloads/floodguard/android/<file>.apk` |
| App-side update check | Mobile app compares current `versionCode` with VPS manifest |
| Current live release | `1.0.1`, `versionCode=2`, released `2026-06-06` |

Current manifest fields expected by app:

| Field | Meaning |
| --- | --- |
| `version` | Human-readable app version |
| `versionCode` | Numeric app build code used for update comparison |
| `releasedAt` | Release date string |
| `releasedLabel` | User-facing release label |
| `minimumSupportedVersionCode` | Minimum allowed app build |
| `forceUpdate` | Whether update is mandatory |
| `fileName` | APK filename |
| `downloadPath` | Relative or absolute APK URL |
| `notes` | Release notes shown to user |

Release workflow currently used:

1. Build signed APK in `APK/android/app/build/outputs/apk/release/`.
2. Copy APK into `VPS/backend/downloads/floodguard/android/`.
3. Update `VPS/backend/app-release.json`.
4. Restart VPS service so operational teams know the new manifest is live.

## 13. What Is Still Not Final or Needs Care

| Item | Current state | Why it matters |
| --- | --- | --- |
| MongoDB architecture | Planned in old doc, not active in code | Avoid assuming durable DB behavior |
| Telemetry/audit persistence | Not durable across restart | Historical analysis and compliance are limited |
| Pending command durability | Not durable across restart | Commands queued before restart may be lost |
| Session persistence | Not durable across restart | Users may need to log in again and FCM token/session mapping resets |
| Integration delivery logs | In-memory only | External webhook troubleshooting history is not durable |
| OTA rollout | Metadata only, no full VPS-side OTA publish pipeline | Do not tell firmware team OTA is production-ready from VPS |
| Hardware contract | Still evolving | Firmware payload and topic changes must be coordinated with VPS |
| Secrets management | Config file still contains sensitive/default-style values | Must be hardened before final production sign-off |

## 14. Change Safety Rules for Future Work

Before changing firmware, MQTT, or APK behavior, keep these rules:

1. Do not change the MQTT topic shape `{base}/{deviceId}/{channel}` unless both firmware and `topicParser.js` are updated together.
2. Do not remove HTTP pending-command polling from firmware unless the VPS command delivery path is redesigned; current operational commands depend on polling.
3. Do not rename config payload fields without updating both firmware config parser and `deviceConfigService.js`.
4. Do not assume MongoDB durability from old planning notes; read the current persistence layer first.
5. Do not change `/api/app-release/mobile` response fields unless the APK update-check code is updated in the same release.
6. Do not change integration webhook event schema or signing rules without coordinating with any external head-office consumer.
7. Do not change device registration response field names casually; those values are part of the device bootstrap contract.

## 15. Key Files to Read Before Any VPS Integration Change

| Area | Files |
| --- | --- |
| App bootstrap and routing | `backend/src/server.js`, `backend/src/app.js`, `backend/src/routes/index.js` |
| Storage | `backend/src/db/datastore.js`, `backend/src/db/persistence.js`, `backend/src/db/seed.js` |
| Device ingest | `backend/src/routes/deviceRoutes.js`, `backend/src/controllers/deviceController.js`, `backend/src/services/deviceService.js` |
| MQTT | `backend/src/mqtt/mqttBridge.js`, `backend/src/mqtt/messageRouter.js`, `backend/src/mqtt/topicParser.js`, `backend/src/mqtt/outboundPublisher.js` |
| Commands/config | `backend/src/services/commandService.js`, `backend/src/services/deviceConfigService.js` |
| Provisioning | `backend/src/services/deviceProvisionService.js` |
| Auth/RBAC | `backend/src/services/authService.js`, `backend/src/config/permissions.js`, `backend/src/middleware/auth.js` |
| Notifications/live | `backend/src/services/notificationService.js`, `backend/src/services/fcmService.js`, `backend/src/services/liveSocketService.js` |
| Integration | `backend/src/routes/integrationRoutes.js`, `backend/src/services/headOfficeIntegrationService.js` |
| APK release | `backend/src/controllers/appReleaseController.js`, `backend/app-release.json` |

This file should now be treated as the VPS-side source of truth until the storage architecture or device contract changes again.
