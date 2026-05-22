# FloodGuard VPS Backend (MVC)

Production-style Node.js MVC backend for FloodGuard device ingress, command control, incident lifecycle, audit trail, and OTA metadata.

## VPS Shift Single-File Config

When shifting to a new VPS, edit only:

- `VPS_SHIFT_CONFIG.json`

This file centralizes:
- API domain/FQDN (`api.floodguard.iotsoft.in`)
- MongoDB URI/DB name
- MQTT host/port
- deployment port/timezone
- API key and JWT secret
- explicit CORS allowlist (`security.corsAllowedOrigins`)

After updating this file, move the same folder to the new VPS and start the backend.

## CORS Allowlist

Backend now uses explicit CORS allowlist (instead of open `*`) for browser clients.

- Config key: `security.corsAllowedOrigins` in `VPS_SHIFT_CONFIG.json`
- Env override: `CORS_ALLOWED_ORIGINS` (comma-separated)
- Example:
  - `http://localhost:3000,https://your-pwa-domain.com`

Notes:
- Requests without `Origin` header (device calls, curl, server-to-server) are still allowed.
- To temporarily allow all origins (not recommended in production), include `*` in allowlist.

## Architecture

```text
src/
  app.js
  server.js
  config/
    env.js
    permissions.js
  controllers/
    authController.js
    deviceController.js
    commandController.js
    monitoringController.js
    adminController.js
  middleware/
    auth.js
    tenant.js
    errorHandler.js
  mqtt/
    topicParser.js
    messageRouter.js
    mqttBridge.js
  models/
    telemetryModel.js
    eventModel.js
    commandModel.js
  repositories/
    userRepository.js
    sessionRepository.js
    locationRepository.js
    deviceRepository.js
    telemetryRepository.js
    incidentRepository.js
    commandRepository.js
    auditRepository.js
    firmwareRepository.js
  services/
    authService.js
    rbacService.js
    deviceService.js
    commandService.js
    incidentService.js
    retentionService.js
    auditService.js
    firmwareService.js
    monitoringService.js
    notificationService.js
  routes/
    authRoutes.js
    deviceRoutes.js
    commandRoutes.js
    monitoringRoutes.js
    adminRoutes.js
```

## Implemented API Endpoints

### Health
- `GET /health`

### Auth
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`

### Device ingress and fallback (`x-api-key` or `x-device-key`)
- `POST /api/device/register` (`x-provision-key` + `device_id` body)
- `POST /api/device/telemetry`
- `POST /api/device/event`
- `GET /api/device/:deviceId/commands/pending`
- `POST /api/device/commands/:commandId/ack`
- `POST /api/device/command_ack` (legacy firmware fallback compatibility)
- `GET /api/device/:deviceId/config`
- `GET /api/device/:deviceId/firmware/latest`

### Operator/App commands (JWT required)
- `POST /api/commands/mute`
- `POST /api/commands/dry-run`
- `POST /api/commands/force-clear`

### Monitoring (JWT required)
- `GET /api/locations`
- `GET /api/locations/:locationId/dashboard`
- `GET /api/incidents`
- `GET /api/audit-logs`

### Admin jobs (JWT required)
- `POST /api/admin/jobs/no-water-compaction`

### Admin user access (JWT required, super admin roles)
- `GET /api/admin/users`
- `POST /api/admin/users`
- `PATCH /api/admin/users/:userId/access`

`PATCH .../access` revokes or grants app/dashboard login access.
When revoked, active sessions for that user are deactivated and next API call returns `401`.

## Key Rules Implemented
- Role-based access control (Viewer cannot mute/force-clear).
- Force-clear requires reason.
- Full audit log entries for command requests and ACK.
- Incident opens on danger event and can be force-cleared.
- MQTT bridge subscribes to device topics and ingests telemetry/event/heartbeat/command_ack.
- Device HTTP fallback compatibility:
  - supports `/api/device/command_ack` (firmware legacy path)
  - supports API key auth and optional known `device_id` auth fallback (`security.allowDeviceIdAuth`)
- No-water-day compaction job:
  - if no water detected in compaction window, dry telemetry is compacted to one `NO_WATER_DAY_SUMMARY` record with remark `no water day`.

## MQTT Data Flow Clarification
- ESP32-S3 publishes directly to MQTT broker (`rub/{deviceId}/...` topics).
- VPS backend subscribes and processes that data in `src/mqtt/`.
- `relay-app` is a reference architecture pattern, not the source of FloodGuard sensor telemetry.

## Seed Login Credentials (for local testing)
- `vendor_admin / Pass@123`
- `demo / 123456` (super admin for app/dashboard demo)
- `operator_rub043 / Pass@123`
- `viewer_rub043 / Pass@123`

Device/API key defaults:
- `x-api-key: FG_LOCAL_DEV_KEY`
- Device: `RUB043-CTRL01`
- Location: `RUB043`

## Run

```powershell
npm install
npm test
npm start
```

To run only MQTT dummy-ingestion regression:

```powershell
& 'C:\Program Files\nodejs\node.exe' --test '.\tests\mqtt.ingestion.test.js'
```

If npm wrapper is restricted on your host sandbox, run via node directly:

```powershell
& 'C:\Program Files\nodejs\node.exe' --test '.\tests\api.regression.test.js'
```

## One-Command Deploy Script

Use:

```powershell
.\deploy.ps1 -Mode background
```

If script execution is blocked by Windows policy, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy.ps1 -Mode background
```

What it does:
- validates `VPS_SHIFT_CONFIG.json`
- installs dependencies
- runs regression API test
- starts backend
- blocks start if `security.jwtSecret` is still `CHANGE_THIS_IN_PRODUCTION` in production mode

Useful options:
- `-SkipInstall`
- `-SkipTests`
- `-InsecureRegistry` (only if SSL/certificate chain issue exists)
- `-Mode foreground` (run attached to terminal)
