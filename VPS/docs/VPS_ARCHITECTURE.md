# FloodGuard VPS Architecture (Inspired by relay-app + QRunlock Integration)

## 1) Proven Pattern from relay-app + QRunlock

The integration pattern used there is:
1. End-user logs in to parent app backend (QRunlock auth domain).
2. Parent backend calls relay microservice using:
   - `x-api-key` (tenant key)
   - `x-user-id` (opaque user identity from parent app)
   - `x-user-name` (for operation log readability)
3. Relay VPS does device/command/audit logic and MQTT bridge.
4. Parent app frontend never calls relay VPS directly.

This is the model we should reuse for FloodGuard integrations too.

## 2) FloodGuard VPS Logical Layers

```text
[External UI / Mobile / Department Portals]
                  |
                  | JWT (app auth)
                  v
      [FloodGuard API Gateway / Backend]
                  |
                  | x-api-key, x-user-id, x-user-name
                  v
      [FloodGuard Device Service on VPS]
      - MQTT bridge
      - command validation
      - incident + audit engine
      - telemetry ingestion
      - FCM push
                  |
                  | MQTT / HTTP fallback
                  v
      [ESP32 Controllers at RUB sites]
```

## 3) VPS Service Components

## A. API Layer (`VPS/backend/src/routes`)
- auth and session
- location/device metadata
- command endpoints (mute, dry-run, force-clear, config)
- telemetry/event ingest (HTTP fallback)
- incident and audit retrieval
- OTA/version endpoints

## B. MQTT Bridge (`VPS/backend/src/mqtt`)
- subscribe telemetry/event/heartbeat/ack topics
- publish commands and config updates
- keep device online/offline state

## C. Business Services (`VPS/backend/src/services`)
- incident lifecycle service
- audit log service
- permission service (RBAC)
- push notification service

## D. Scheduled Jobs (`VPS/backend/src/jobs`)
- stale device/offline detector
- dry-day telemetry compaction (24h no-water summarization)
- retry queues (command and notification)

## E. Data Access (`VPS/backend/src/db`)
- schema and migration definitions
- repository/model logic

## 4) Multi-Tenant Ready Contract

Even if FloodGuard runs as a single app today, keep this contract ready:
- `x-api-key`: identifies calling app/tenant
- `x-user-id`: caller user identity
- `x-user-name`: audit readability

This makes future third-party monitoring integration easier without refactoring core device service.

## 5) Security and Operations
- `helmet` + CORS controls + rate limiting
- strict route auth and role checks
- immutable audit trails for high-risk actions
- PM2 or systemd process management
- containerized runtime for DB + broker + API

## 6) Suggested Deployment Stack
- API: Node.js service
- Broker: Mosquitto
- DB: MongoDB for FloodGuard domain data
- Optional: Redis for queue/rate-limit/session acceleration
- Reverse proxy: Nginx with TLS

## 7) Folder-First Build Rule
- implement inside `VPS/backend/src/*` by module ownership
- infra files in `VPS/infra`
- deployment/runbook scripts in `VPS/scripts`
- keep architecture and contract updates in `VPS/docs`

