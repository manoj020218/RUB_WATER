# FloodGuard VPS Organization

This folder is now organized in the same practical VPS style used in `relay-app`:
- clear backend boundaries
- MQTT bridge layer
- deploy-ready infra folder
- dashboard folder
- script and docs separation

## Folder Layout

```text
VPS/
  README.md
  WORK_PLAN.md
  backend/
    README.md
    src/
      routes/
      services/
      middleware/
      mqtt/
      jobs/
      db/
  dashboard/
    README.md
  infra/
    docker-compose.example.yml
  scripts/
    README.md
  docs/
    VPS_ARCHITECTURE.md
```

## VPS Responsibilities
- Device telemetry ingest (MQTT primary, HTTP fallback)
- Command pipeline with ACK handling
- Incident and audit lifecycle
- Role-based authorization and session tracking
- Realtime dashboard broadcast (WebSocket/Socket.IO)
- FCM push notification dispatch
- OTA and version metadata services

## Execution Order (VPS Team)
1. Read `docs/VPS_ARCHITECTURE.md`
2. Build backend module by module (`backend/README.md`)
3. Prepare deployment config (`infra/docker-compose.example.yml`)
4. Add automation scripts (`scripts/README.md`)
5. Integrate dashboard API/WebSocket layer (`dashboard/README.md`)

