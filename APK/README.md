# FloodGuard Android App (APK)

This folder now contains a real Capacitor Android app wired to FloodGuard VPS APIs.

## Web App Source
- `www/index.html`
- `www/app.css`
- `www/app.js`

Implemented screens:
- Login
- Location list
- Live dashboard (vessel + level)
- Controls (mute, dry-run, force clear)
- Audit timeline
- Super-admin user management (create user + Active/Deactive + toggle access)

## Demo Super Admin Login
- `demo / 123456`

## Access Grant / Revoke Flow
Super admin can manage login access from dashboard using new admin APIs:
- `GET /api/admin/users`
- `POST /api/admin/users`
- `PATCH /api/admin/users/:userId/access`

When access is revoked:
- new login fails
- active tokens are invalidated on next request
- app auto-logs out with revoked/session-expired message

## Build APK
From `APK` folder:

1. `npm install`
2. `npm run cap:add:android` (first time only)
3. `npm run cap:sync`
4. `npm run android:debug`

Debug APK output:
- `APK/android/app/build/outputs/apk/debug/app-debug.apk`
