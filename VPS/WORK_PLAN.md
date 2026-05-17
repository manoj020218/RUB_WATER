# VPS Work Plan

Scope owner: cloud backend, security, audit, notifications, and command routing.

## A. Core Backend Deliverables
- Node.js API service (Express or Fastify)
- MongoDB schemas/collections:
  - users, user_sessions, locations, devices
  - telemetry, incidents, audit_logs
  - firmware_versions, app_versions
- JWT auth and bcrypt passwords
- Role-based access checks for every control command

## B. Device Communication Deliverables
- MQTT subscribers/publishers for:
  - telemetry, events, heartbeat, commands, acks, config, ota
- HTTP fallback APIs:
  - telemetry/event ingest
  - pending command fetch
  - command ack submission
  - config and firmware metadata endpoints

## C. Incident and Audit Engine
- Incident open/update/close logic
- Force-clear reason enforcement
- Full audit trail:
  - user/login/session/device/IP/timestamp/details
- Shared-login traceability through per-session records

## D. Push and Live Updates
- FCM token storage by user session
- Event-based push rules for ALERT, DANGER, mute, clear, offline, dry-run
- Websocket/Socket.IO live status updates for PWA/APK dashboards

## E. Data Retention Rule
- If no water detection for 24h:
  - retain one summarized no-water-day record
  - purge high-frequency dry telemetry
- If water detected:
  - retain relevant event/telemetry and incident timelines

## F. Parent-App Integration Pattern (from QRunlock model)
- Parent app frontend calls parent backend only
- Parent backend proxies to FloodGuard VPS with:
  - `x-api-key`
  - `x-user-id`
  - `x-user-name`
- FloodGuard VPS remains tenant-aware and audit-readable
- Keep direct device service hidden from public frontend

## G. Acceptance Checklist
- Viewer cannot execute mute/force-clear
- Operator role command flow works with audit logging
- Command ACK path confirmed end-to-end
- Push reaches assigned users
- Device fallback path works when MQTT fails
