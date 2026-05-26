
# FloodGuard Dashboard Wiring

This folder contains the client-approved mockup now wired to live VPS APIs.

## Files
- `FloodGuard_Desktop_UI.html`: approved UI mockup with runtime IDs/hooks.
- `dashboard-app.js`: live API wiring, auth/session, polling, command actions.
- `dashboard-live.css`: mobile/tablet-first override styles.

## Backend Serving
- Backend serves this folder at `/dashboard`.
- Root `/` redirects to `/dashboard/FloodGuard_Desktop_UI.html`.

## API Mapping Used By UI
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/locations`
- `GET /api/locations/:locationId/dashboard`
- `GET /api/incidents?location_id=...`
- `GET /api/audit-logs?location_id=...`
- `POST /api/commands/mute`
- `POST /api/commands/dry-run`
- `POST /api/commands/force-clear`
- `GET /api/admin/users` (super admin panel)
- `POST /api/admin/users` (super admin panel)
- `PATCH /api/admin/users/:userId/access` (grant/revoke login access)

## Responsive Behavior
- Existing responsive CSS from mockup is preserved.
- `dashboard-live.css` adds mobile-first refinements for:
  - nav wrapping on phones
  - single-column control/network/relay sections
  - touch-friendly controls and modal sizing
  - audit table horizontal scroll on narrow screens

## Session/Auth
- Login modal stores session in local storage key `fg_dashboard_session_v1`.
- API base is configurable in modal; if blank, it auto-uses current origin + `/api`.

## Dummy Data + MQTT Note
- Dashboard updates from backend data only.
- ESP32-S3 telemetry can reach backend by:
  - MQTT topics (`rub/{device_id}/telemetry`, `/event`, `/heartbeat`, `/command_ack`)
  - HTTP fallback (`/api/device/telemetry`, `/api/device/event`, `/api/device/command_ack`)
- This means UI does not depend on Relay App internals; it depends on FloodGuard VPS API state.
