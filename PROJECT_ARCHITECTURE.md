# FloodGuard by Jenix - Project Architecture

Date: 17 May 2026

## 1. Architecture Goal
Build an offline-first flood safety platform for RUB sites where local alarm logic always works, while VPS services provide monitoring, audit, notifications, configuration, and OTA.

## 2. Top-Level System Architecture

```text
RS485 Ultrasonic Sensor + 300/500mm Switches
                |
                v
        ESP32-S3 Controller (HARDWARE)
  - local state machine
  - siren/beacon/voice relays
  - queue when internet is down
                |
      MQTT primary / HTTP fallback
                |
                v
          VPS Platform (VPS)
  - MQTT broker integration
  - Node.js API + command engine
  - MongoDB telemetry + incidents + audit
  - FCM push dispatcher
  - auth + RBAC + sessions
                |
      WebSocket/REST + Push Messages
                |
                v
     Responsive PWA + Android APK (APK)
  - login and role-based control
  - live dashboard and vessel UI
  - mute/dry-run/force-clear actions
  - audit timeline and incident visibility
```

## 3. Control Authority Model
- Local authority: ESP32 firmware decides and executes emergency relay actions.
- Cloud authority: VPS validates user commands and publishes commands.
- UI authority: PWA/APK can request actions but cannot bypass role and safety checks.

## 4. Component Boundaries

## HARDWARE Domain
- ESP32 firmware modules:
  - sensor_rs485, switch_inputs, relay_controller
  - alarm_state_machine, telemetry_manager
  - mqtt_client, http_fallback
  - command_handler, local_event_queue, ota_manager
- Router/SIM diagnostics:
  - Wi-Fi, gateway, internet, SIM, signal, operator, WAN IP
- Safety outputs:
  - siren, beacon, voice, barrier reserve, RF trigger reserve

## VPS Domain
- Device ingress:
  - telemetry/event ingestion from MQTT and HTTP fallback
- Core backend:
  - auth, users, sessions, roles, location mapping
  - command issuance + ACK tracking
  - incident lifecycle + audit logs
- Notification and realtime:
  - FCM push dispatch
  - websocket/socket broadcast to dashboard clients
- Storage policy:
  - dry-day summary model and water-event retention model

## APK Domain
- Shared UI architecture (React + PWA + Capacitor):
  - auth flow
  - location list
  - live dashboard (animated vessel)
  - control panel with reason-confirmation actions
  - audit timeline
- Platform integration:
  - FCM token registration
  - Android packaging and version checks
  - PWA installability and service worker behavior

## 5. Data and Event Flow

1. Device reads sensors and computes validated water level.
2. If alert/danger threshold remains stable for configured duration, device changes state and activates relays.
3. Device publishes telemetry/events via MQTT. If MQTT fails, device uses HTTP fallback.
4. VPS stores telemetry/events, updates incident state, and writes audit traces.
5. VPS pushes notifications and live updates to assigned users.
6. User command (mute/dry-run/force-clear) goes through VPS permission checks.
7. VPS sends command to device, device executes and publishes command ACK.

## 6. Security Model
- JWT auth for users
- bcrypt password hashing
- role-based command authorization
- per-session device traceability for shared logins
- audit log for every sensitive command
- command expiry enforcement

## 7. Build Order (Architecture-First)
1. HARDWARE local safety logic
2. VPS auth + incident + audit backbone
3. VPS device ingress (MQTT + HTTP fallback)
4. APK/PWA live views and control actions
5. Push notifications and OTA orchestration
6. Full regression and production hardening

## 8. Workstream Folder Mapping
- `HARDWARE/` -> firmware and field device work
- `VPS/` -> backend, database, broker, notification work
- `APK/` -> mobile app, PWA UI, Android packaging

