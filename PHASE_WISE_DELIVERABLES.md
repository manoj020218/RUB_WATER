# FloodGuard by Jenix - Phase-Wise Project Deliverables

Date: 17 May 2026  
Project Reference: `PROJECT.MD` in this repository

## 1. Delivery Model
This plan converts the project specification into practical execution phases for firmware, backend, web dashboard (responsive PWA), Android app, and launch readiness.

## 2. Delivery Principles
- Safety logic stays local on ESP32 as the final authority.
- Cloud services are for monitoring, audit, notification, configuration, and OTA.
- Desktop dashboard is responsive first, then enhanced for larger screens.
- UI language follows existing mockup theme with clearer motion states (blink, glow, pulse) and controlled animation.
- Every control action is auditable by user, session, device, and time.

## 3. Phase-Wise Deliverables

## Phase 0 - Foundation and Project Setup
Goal: Prepare controlled development baseline.

Deliverables:
- Final repository structure for `firmware`, `backend`, `pwa`, `android`, `docs`.
- Environment profiles: `dev`, `staging`, `prod`.
- Baseline CI checks (lint, build, test skeleton).
- Device/location naming standard:
  - Example: `RUB043-CTRL01`, `RUB-043`.
- Initial architecture and API contract document aligned to MQTT + HTTP fallback.

Exit Criteria:
- Team can build and run each module locally.
- Shared coding and release conventions approved.

## Phase 1 - Firmware Safety Core (Offline-First)
Goal: Complete local flood safety logic independent of internet.

Deliverables:
- ESP32-S3 modules:
  - RS485 ultrasonic read + validation filter
  - 300 mm and 500 mm switch inputs with debounce
  - alarm state machine with 60-second stable confirmation
  - danger clear logic with 5-minute stable safe condition
  - relay control: siren, beacon, voice, barrier reserve, spare
- Siren/voice pattern engine and mute behavior.
- Local dry-run output tests.
- Local event queue for offline persistence.

Additional Firmware Diagnostics Deliverables (from project notes):
- Wi-Fi connected yes/no
- Gateway reachable yes/no
- Internet available yes/no
- SIM inserted, registered, 4G connected
- Signal detail (RSSI/RSRP/bars), operator, WAN IP, network mode (2G/3G/4G)
- MAC bind / allowed device check
- Router auto-reboot strategy when internet is down
- Status reporting to VPS through MQTT
- Reserve 2 GPIO pins for SIM800L backup SMS path
- Reserve 2 GPIO pins to trigger RF boom barrier remote during confirmed danger

Exit Criteria:
- Bench test confirms local danger handling without VPS connectivity.
- Serial or local logs show state transitions and command outcomes clearly.

## Phase 2 - Device Connectivity and Uplink
Goal: Reliable cloud sync without compromising local safety.

Deliverables:
- MQTT topic implementation:
  - telemetry, event, heartbeat, command, command_ack, config, ota
- HTTP fallback endpoints integration for telemetry/event/commands/config.
- Retry, backoff, and reconnection strategy.
- Offline queue replay after network restoration.
- Time sync strategy (NTP available, fallback timestamp behavior).

Exit Criteria:
- Device continues local operation during outage.
- Pending telemetry/events sync after internet returns.

## Phase 3 - Backend and Security Core
Goal: Production-grade backend with strict auth, RBAC, audit, and incident lifecycle.

Deliverables:
- Node.js service with MongoDB collections from specification.
- JWT auth with bcrypt password hashing.
- Role and hierarchy enforcement:
  - Vendor, Department, Location, Operator, Viewer, Auditor, third-party monitor.
- Command permission validation and command expiry checks.
- Incident creation/update/close and force-clear handling with reason.
- Audit logs for every high-risk action.
- Device session tracking for shared login accountability.
- FCM token management per session/device.

Data Retention Deliverables (from project notes):
- If no water detected for 24 hours:
  - purge detailed dry telemetry
  - retain one summarized "no water day" record
- If water detected:
  - retain relevant water-detection telemetry and incident records

Exit Criteria:
- API tests pass for auth, permission, audit, and incident flows.
- Viewer role cannot mute/force-clear.

## Phase 4 - Responsive Desktop PWA Dashboard
Goal: Build dashboard UI from mockup theme with responsive-first behavior.

Deliverables:
- Responsive live dashboard for desktop/tablet/mobile web.
- UI modules:
  - login
  - location list
  - live location dashboard with vessel fill animation
  - control panel with role-based actions
  - audit timeline
  - incident detail view
- Enhanced visual feedback:
  - controlled blink for critical state
  - glow/pulse for active danger components
  - smooth transitions for water level and status updates
- PWA enablement:
  - installable manifest
  - service worker offline shell
  - version badge and update flow

Exit Criteria:
- Works across mobile, tablet, and desktop breakpoints.
- Installable as PWA with offline landing behavior.

## Phase 5 - Android App (Capacitor) and Push Notifications
Goal: Package mobile experience and deliver notification reliability.

Deliverables:
- Capacitor Android build from React PWA codebase.
- FCM push for:
  - ALERT start
  - DANGER confirmed
  - mute/unmute
  - force clear
  - auto clear
  - device offline/online
  - sensor/battery warnings
  - dry-run events
- Session registration and token refresh handling.
- App version check policy (mandatory and optional paths).

Exit Criteria:
- Push is verified on multiple devices for same login and multi-user assignment.
- APK distribution pipeline baseline ready.

## Phase 6 - OTA, Hardening, and Regression
Goal: Reliability for long-term operations.

Deliverables:
- Firmware OTA orchestration with checksum validation.
- OTA safety rules (no update during active danger).
- Scheduled reboot controls and danger-aware postponement.
- Watchdog, health monitoring, and reboot reason logs.
- Full regression suite from project checklist.

Exit Criteria:
- Firmware + backend + app regression test pass report.
- OTA success/failure behaviors validated.

## Phase 7 - Marketing, Legal, and Launch Readiness
Goal: Public-facing launch assets and policy readiness.

Deliverables:
- One-page marketing website for FloodGuard by Jenix.
- About page.
- Privacy policy page.
- Terms and Conditions page with:
  - limitation of liability
  - user obligations
  - emergency-use disclaimer
  - indemnity and force majeure
  - jurisdiction and compliance clauses
- Cross-linking among all pages and footer legal navigation.

Exit Criteria:
- Website pages approved by business owner.
- Final legal text reviewed by legal counsel before production release.

## 4. Milestone Acceptance Checklist
- Safety logic proven offline.
- MQTT + HTTP fallback proven.
- RBAC + audit complete.
- Responsive PWA dashboard complete.
- Android + push complete.
- OTA + reboot + resilience complete.
- Marketing + legal pages complete and reviewed.

## 5. Immediate Next Sprint Recommendation
Priority order:
1. Phase 1 firmware safety core
2. Phase 3 backend auth + incident + audit foundation
3. Phase 4 responsive PWA dashboard base screens
4. Phase 2 connectivity fallback integration

This order gives the fastest path to an end-to-end demonstrable MVP with real safety behavior and traceability.

