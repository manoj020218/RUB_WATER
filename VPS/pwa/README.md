# FloodGuard PWA — app.floodguard.jenix.in

Progressive Web App served from the same VPS as the API (103.118.183.243).
Files are served directly from the Vite build output at `APK/www/`.

## Architecture

```
app.floodguard.jenix.in  →  103.118.183.243  →  nginx  →  /var/www/floodguard-pwa/
```

Files are copied to `/var/www/floodguard-pwa/` (SELinux `httpd_sys_content_t` context required — files
under `/root/` are `admin_home_t` which nginx cannot read under SELinux Enforcing mode).

After each APK rebuild, sync the new build to the PWA web root:
```bash
cp -r /root/projects/floodguard/repo/APK/www/. /var/www/floodguard-pwa/
```

## DNS Setup

Add an A record in your DNS provider:
```
app.floodguard.jenix.in   A   103.118.183.243
```

## First-time Deploy (on VPS)

```bash
bash /root/projects/floodguard/repo/VPS/pwa/setup.sh
```

Then obtain SSL (after DNS propagates — usually 5–30 min):
```bash
certbot --nginx -d app.floodguard.jenix.in
```

Then restart PM2 to apply the CORS change for `app.floodguard.jenix.in`:
```bash
pm2 restart floodguard-api
```

## Auto-update on APK rebuild

The PWA uses a network-first service worker strategy.
When `APK/www/` changes (after a new build), users get the update on next visit
because:
1. SW is served with `no-cache` headers → browser always fetches latest sw.js
2. Vite assets use content-hash filenames → cache busted automatically
3. `index.html` is served fresh each time (no long-lived cache on root)

## Nginx Config Location

`/etc/nginx/conf.d/app-floodguard.conf`

Source: `VPS/pwa/nginx-app.conf`

## CORS

`app.floodguard.jenix.in` is already whitelisted in `VPS/backend/src/config/env.js`
under `defaultCorsOrigins`. No env variable change needed.

## BLE/WiFi Provisioning

BLE provisioning requires the Android APK — not available in the browser.
The Install page shows a notice to users on the web app.

## Features Available on PWA

- Login / Logout
- Locations list
- Live device dashboard (water level, status, telemetry)
- Audit timeline (CSV/TXT export via browser download)
- Reports / Audit Report
- Complaints
- Controls (mute alarm, dry run, force clear)
- User Management (for VENDOR_SUPER_ADMIN)
- Device Config
- OTA Firmware Update (page loads; actual OTA still goes via API)
- PWA install prompt (Add to Home Screen on Android/desktop Chrome)

## Not Available on PWA (native-only)

- BLE device provisioning (requires Capacitor + Android BLE)
- Native push notifications (FCM via Capacitor)
- Native file system share (falls back to browser download)
