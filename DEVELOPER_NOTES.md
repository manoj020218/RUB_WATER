# FloodGuard — Developer Notes

**VPS:** 103.118.183.243 (AlmaLinux 8.10)
**Domain:** api.floodguard.iotsoft.in → 103.118.183.243
**Last updated:** 2026-06-13

---

## VPS Project Structure

```
/root/projects/floodguard/
  repo/                          ← git clone of this repository (RUB_WATER)
    VPS/backend/src/server.js    ← Node.js API, port 4080, managed by PM2
  pwa → /var/www/floodguard-pwa  ← symlink to PWA static files

/var/www/floodguard-pwa/         ← served by nginx (SELinux: httpd_sys_content_t label required)
```

- Node.js installed via NVM at `/root/.nvm`
- PM2 process name: `floodguard-api`
- Systemd service: `pm2-root.service` (uses a shell wrapper to source NVM before starting)
- Nginx config: `/etc/nginx/conf.d/floodguard-api.conf`

---

## MQTT Broker (Mosquitto)

**Port:** 1883 TCP (open in firewalld)
**Config:** `/etc/mosquitto/conf.d/floodguard.conf`
**Password file:** `/etc/mosquitto/passwd`
**ACL file:** `/etc/mosquitto/acl`

### Auth model

`allow_anonymous true` is set — BUT any client that sends a username + password
not found in the passwd file is **rejected**. Only truly anonymous (no credentials)
clients pass through as anonymous.

All FloodGuard edge devices authenticate with:
- **MQTT username** = device ID (e.g. `FG-MAIN-EH-01`)
- **MQTT password** = device token (set in firmware `DEVICE_TOKEN_SEED`)

Both must be added to Mosquitto before the device can connect.

---

## Device MQTT Onboarding Pipeline

### Firmware compile-time values (`device_profile.h`)

| Constant            | Example value                | Purpose                     |
|---------------------|------------------------------|-----------------------------|
| `DEVICE_ID_SEED`    | `FG-MAIN-EH-01`              | MQTT username + client ID   |
| `DEVICE_TOKEN_SEED` | *(set per device)*           | MQTT password               |
| `DEFAULT_MQTT_HOST` | `api.floodguard.iotsoft.in`  | Broker hostname             |
| `DEFAULT_MQTT_PORT` | `1883`                       | Broker port                 |

> **Important:** `DEVICE_TOKEN_SEED` defaults to `change_me_before_flash`. Always set a
> unique, secret token per device before flashing for production.

### MQTT topic structure (firmware v0.1.0+)

| Topic                               | Direction       | Content             |
|-------------------------------------|-----------------|---------------------|
| `floodguard/<deviceId>/telemetry`   | device → broker | Sensor readings, flood state |
| `floodguard/<deviceId>/event`       | device → broker | Alerts, state changes |
| `floodguard/<deviceId>/command`     | broker → device | `pump_on`, `pump_off`, `reboot` |
| `floodguard/<deviceId>/config`      | broker → device | `config_update` JSON |

> Older field devices (RUB043, RUB057, RUB071) use `rub/<deviceId>/...` topic prefix from
> an earlier firmware. The backend subscribes to both prefixes.

### Steps to onboard a NEW device

**1. Get device ID and token from firmware:**
Open `device_profile.h` in the device's firmware folder:
- `DEVICE_ID_SEED` → this is the MQTT username
- `DEVICE_TOKEN_SEED` → this is the MQTT password

**2. SSH into VPS and add to Mosquitto password file:**
```bash
mosquitto_passwd -b /etc/mosquitto/passwd <DEVICE_ID> <DEVICE_TOKEN>
```

**3. Add ACL entry** — edit `/etc/mosquitto/acl` and append:
```
# FloodGuard device: <DEVICE_ID>
user <DEVICE_ID>
topic readwrite floodguard/<DEVICE_ID>/#
```

**4. Reload Mosquitto** (no service restart needed):
```bash
systemctl reload mosquitto
```

**5. Verify auth and connectivity:**
```bash
mosquitto_sub -h localhost -p 1883 \
  -u <DEVICE_ID> -P <DEVICE_TOKEN> \
  -t "floodguard/<DEVICE_ID>/#" -C 1 -W 5
# Exit code 0 = auth OK
```

**6. Provision WiFi on the physical device** using one of:
- **BLE provisioning app** (APK) → step 1 Hello, step 2 Set WiFi, step 3 Cloud check
- **AP mode web UI** → connect to device AP (`JXFG<MAC>`), open `http://192.168.4.1/wifi`

### Currently registered devices

| Device ID       | Location       | Topic prefix               | Notes                        |
|-----------------|----------------|----------------------------|------------------------------|
| `FG-MAIN-EH-01` | Dev/test unit  | `floodguard/FG-MAIN-EH-01/#` | Token is placeholder value  |
| `RUB043-CTRL01` | RUB Site 043   | `rub/RUB043-CTRL01/#`      | Old firmware, old topic prefix |
| `RUB057-CTRL01` | RUB Site 057   | `rub/RUB057-CTRL01/#`      | Old firmware, old topic prefix |
| `RUB071-CTRL01` | RUB Site 071   | `rub/RUB071-CTRL01/#`      | Old firmware, old topic prefix |

---

## Backend MQTT Subscriber

The Node.js backend connects as user `fg_server` and subscribes to:
- `rub/#`         — legacy field devices
- `floodguard/#`  — new field devices (v0.1.0+ firmware)

To send a command to a device from the VPS:
```bash
mosquitto_pub -h localhost -p 1883 \
  -u fg_server -P <fg_server_password_from_passwd_file> \
  -t "floodguard/FG-MAIN-EH-01/command" \
  -m '{"cmd":"reboot"}'
```

---

## Nginx / SSL

Config: `/etc/nginx/conf.d/floodguard-api.conf`

- **HTTPS (443):** SSL via Let's Encrypt. Proxies to Node on port 4080.
- **HTTP (80):** Also proxies to port 4080. **No redirect to HTTPS.**
  Reason: IoT devices (ESP32) use plain HTTP for API calls and cannot handle HTTPS.

Renew SSL: `certbot renew` (runs automatically via cron).

---

## Firewall

Open ports (firewalld):
- 22 — SSH
- 80 — HTTP
- 443 — HTTPS
- 1883 — MQTT

Check: `firewall-cmd --list-ports`
Add a port: `firewall-cmd --permanent --add-port=XXXX/tcp && firewall-cmd --reload`

---

## Firmware Details

**Repo folder:** `HARDWARE/firmware_EDGEHAX_S3_ST485_RTU4ch_WAVE485/firmware/`
**Build tool:** PlatformIO
**Board:** ESP32-S3 (Edgehax N16R8)
**Default PIO environment:** `floodguard_edgehax_s3`

### Key source files

| File                       | Purpose                                              |
|----------------------------|------------------------------------------------------|
| `src/device_profile.h`     | Device ID, token, MQTT host, all GPIO pin defs       |
| `src/mqtt_manager.cpp`     | MQTT connect / publish / subscribe                   |
| `src/ble_provisioning.cpp` | BLE provisioning server (device name: `JXFG<MAC>`)   |
| `src/wifi_manager.cpp`     | WiFi credential storage in NVS (namespace: `fgcfg`) |
| `src/local_webserver.cpp`  | AP mode web UI (192.168.4.1) + local HTTP API        |
| `src/config_manager.cpp`   | Flood threshold config, stored in NVS                |

### BLE provisioning protocol

Service UUID: `0000ff00-0000-1000-8000-00805f9b34fb`
Characteristic UUID: `0000ff01-0000-1000-8000-00805f9b34fb` (READ + WRITE + WRITE_NR)

Data is sent in 20-byte chunks (intentional — some S3 variants reject large BLE bursts).
The firmware reassembles chunks by accumulating until a complete JSON `{...}` is received.

| Command JSON                                        | Response fields                              |
|-----------------------------------------------------|----------------------------------------------|
| `{"cmd":"hello"}`                                   | `ble_name`, `wifi_connected`, `ssid`, `ip`  |
| `{"cmd":"set_wifi","ssid":"...","password":"..."}`  | `wifi_connected`, `ip`                       |
| `{"cmd":"scan_wifi"}`                               | `networks:[{ssid,rssi}]`                    |
| `{"cmd":"c", "u":"...", "mh":"...", ...}`            | `wifi_connected`, `mqtt_connected`, `ip`    |

### Local HTTP API (no auth required)

```
GET http://<device-ip>/api/status
```
Response:
```json
{
  "device_id": "FG-MAIN-EH-01",
  "firmware": "0.1.0",
  "wifi_connected": true,
  "ip": "192.168.1.206",
  "mqtt_connected": true,
  "uptime_s": 1234
}
```

Used by the provisioning APK to check VPS/MQTT connection over local WiFi,
without needing BLE to be active.

### AP mode WiFi setup (web UI)

When the device has no WiFi credentials stored, it broadcasts an AP:
- SSID: `JXFG<last-3-MAC-bytes-hex>`
- IP: `192.168.4.1`
- Open `http://192.168.4.1/wifi` to enter SSID + password

The root `/` redirects to `/wifi` automatically when AP mode is active.

---

## APK (Provisioning App)

**Folder:** `APK/www/` (Capacitor/Ionic web app)

### Provisioning flow

1. **BLE Scan** — discover device by `JXFG<MAC>` name
2. **Set WiFi** — send `{"cmd":"set_wifi",...}` over BLE; device responds with local IP
3. **Cloud step** — send `{"cmd":"c",...}` over BLE; device responds with MQTT status
4. **Verify** — app polls `GET /api/status` over local HTTP to confirm cloud connection

### Known device (post-provisioning)

After provisioning, the device's local IP is saved in `localStorage`. On subsequent opens
of the install tab, a green banner shows the known device IP with a **"Check VPS/MQTT"**
button that calls `GET /api/status` over local HTTP — no BLE required.

---

## Common Troubleshooting

### Device WiFi connected but MQTT disconnected

1. Check DNS resolves: `nslookup api.floodguard.iotsoft.in` → should return 103.118.183.243
2. Check device ID in passwd: `grep <DEVICE_ID> /etc/mosquitto/passwd`
3. Check ACL entry exists: `grep <DEVICE_ID> /etc/mosquitto/acl`
4. Test auth manually:
   ```bash
   mosquitto_sub -h localhost -p 1883 -u <ID> -P <TOKEN> -t 'test' -W 2
   ```
5. Check Mosquitto logs: `journalctl -u mosquitto -n 50`

### BLE provisioning step 3 shows `invalid_json`

Caused by BLE MTU fragmentation — 20-byte chunks arriving as separate `onWrite` callbacks,
each overwriting the previous fragment. Fixed in `ble_provisioning.cpp` by accumulating
chunks until a complete JSON object is received. Flash the latest firmware.

### PM2 not starting after reboot

```bash
systemctl status pm2-root
journalctl -u pm2-root -n 20
/usr/local/bin/pm2-start.sh   # run manually to test NVM path
```

### SELinux blocking nginx

```bash
# Proxy to Node.js:
setsebool -P httpd_can_network_connect 1

# Static files under /var/www/:
semanage fcontext -a -t httpd_sys_content_t '/var/www/floodguard-pwa(/.*)?'
restorecon -Rv /var/www/floodguard-pwa
```

### Port 1883 not reachable from device

```bash
firewall-cmd --list-ports   # check 1883/tcp is listed
firewall-cmd --permanent --add-port=1883/tcp && firewall-cmd --reload
```
