# Jenix IoT — Device Provisioning Standard

**Applies to:** FloodGuard (ESP32-S3) and future Jenix IoT products  
**Last updated:** 2026-06-04

---

## 1. Philosophy

- **Zero-config first boot.** Device comes out of the box in BLE mode. No stickers to scan, no AP to join, no IP to type.
- **Offline-first.** Device is fully functional on a local LAN even without internet. Cloud is additive, not required.
- **Graceful degradation.** BLE → AP fallback. Cloud → mDNS local fallback. Every level has a fallback.
- **No re-provisioning without intent.** Changing WiFi requires a factory reset (physical button hold) to prevent accidental or malicious re-provisioning.

---

## 2. Device Naming Convention

### BLE Advertisement Name
```
JXFG + last 6 hex digits of WiFi STA MAC (uppercase, no separators)
```
Example: MAC `9C:13:9E:BA:F9:68` → BLE name `JXFGBAF968`

### mDNS Hostname (local LAN)
Derived from Device ID by lowercasing and replacing non-alphanumeric chars with `-`:
```
FG-MAIN-EDGEHAX-01  →  fg-main-edgehax-01.local
```
Local WebUI: `http://fg-main-edgehax-01.local/`

### Current Code — BLE name fix needed
File: `firmware/src/ble_provisioning.cpp` line 63  
Change:
```cpp
// Current (wrong prefix)
snprintf(_bleName, sizeof(_bleName), "FgMain%02X%02X%02X", mac[3], mac[4], mac[5]);

// Correct (JXFG prefix)
snprintf(_bleName, sizeof(_bleName), "JXFG%02X%02X%02X", mac[3], mac[4], mac[5]);
```

---

## 3. Full Provisioning Flow

### Phase 0 — First Boot Detection
```
Device starts
  └─ NVS has WiFi credentials?
       ├─ YES → skip BLE, go directly to WiFi connect (Phase 3)
       └─ NO  → enter BLE advertisement mode (Phase 1)
```

### Phase 1 — BLE Advertisement
- Start BLE, advertise as `JXFG{6-hex-MAC}`
- Service UUID: `0000ff00-0000-1000-8000-00805f9b34fb`
- Characteristic UUID: `0000ff01-0000-1000-8000-00805f9b34fb`  
  (READ + WRITE + WRITE_NR)
- Initial characteristic value: `{"ok":true,"cmd":"ready"}`
- Timeout: BLE runs indefinitely until credentials received OR factory reset

### Phase 2 — BLE Credential Exchange
App sends JSON commands to the characteristic, reads response:

| Command | Payload | Response |
|---|---|---|
| `hello` | `{"cmd":"hello"}` | device name, WiFi status, SSID, IP |
| `scan_wifi` | `{"cmd":"scan_wifi"}` | array of {ssid, rssi} up to 8 networks |
| `set_wifi` | `{"cmd":"set_wifi","ssid":"MyNet","password":"pass"}` | `{"ok":true,"wifi_connected":true,"ip":"192.168.1.x"}` |

Short aliases: `"op":"h"`, `"op":"w"` with `"s"` and `"p"` for compact BLE packets.

On `set_wifi` success:
- Credentials saved to NVS (persistent across reboot)
- Device replies with IP address
- App receives response → shows success → BLE can be stopped by device

### Phase 3 — WiFi Connection
```
WiFi.begin(ssid, pass)
  ├─ Connected (within 20s timeout)
  │    ├─ Stop BLE advertising → BLEDevice::deinit()
  │    └─ Start mDNS + local WebServer → proceed to Phase 4
  └─ Failed
       └─ Reply {"ok":true,"wifi_connected":false,"ip":""}
          App shows error, user retries or tries different password
```

### Phase 4 — Internet + Cloud Detection
```
WiFi connected
  └─ Check internet (HTTP GET http://connectivity-check.jenix.in/ or 8.8.8.8 TCP:53)
       ├─ Internet available
       │    ├─ Connect to VPS MQTT
       │    └─ mDNS + local WebUI remain active (useful for local config)
       └─ Internet NOT available
            ├─ mDNS + local WebUI active → fg-main-edgehax-01.local
            ├─ WebUI shows orange banner: "No internet — cloud not reachable"
            └─ Background: check internet every 60s
                 └─ Internet restored → connect MQTT, show "Cloud connected" banner
```

### Phase 5 — Cloud-Connected Steady State
- MQTT to VPS: telemetry, alerts, remote config
- Local WebUI stays active for local config and OTA
- App accesses device via cloud (MQTT pub/sub via VPS)
- Factory reset (button hold 10s) → clears NVS WiFi → reboots to Phase 1

---

## 4. Local WebUI (mDNS)

**Access:** `http://{mdns-hostname}.local/`  
**Auth:** password-protected (session 1 hour)  
**Always available** when device is on local WiFi, regardless of internet status.

| Route | Purpose |
|---|---|
| `/status` | Live sensor, FSM state, battery, remote boxes, WiFi, MQTT |
| `/config` | Flood thresholds, pump config, reboot schedule |
| `/calibration` | Sensor zero, battery ADC calibration |
| `/relay-test` | Manual relay trigger (timed) |
| `/remote-test` | Remote box Modbus test |
| `/diagnostics` | Heap, PSRAM, WiFi RSSI, SD status |
| `/firmware-upload` | Local OTA (blocked during alert/danger) |
| `/reboot` | Reboot device |
| `/factory-reset-confirm` | Erase WiFi, reboot to BLE mode |

### No-Internet Banner (add to WebUI)
When `MqttManager::isConnected()` returns false and WiFi is connected, show:
```html
<div style="background:#f57c00;color:#fff;padding:10px 16px;text-align:center">
  No internet — device running in local mode. Cloud features unavailable.
  Monitoring for internet every 60s...
</div>
```
When internet restored, replace with:
```html
<div style="background:#2e7d32;color:#fff;padding:10px 16px;text-align:center">
  Cloud connected. You may access device configuration from the app now.
</div>
```

---

## 5. App UI Flow — Modern Style

### Screen 1 — Scan (Animated Radar)
```
┌─────────────────────────────┐
│                             │
│       [Radar animation]     │
│     Searching for Jenix     │
│        devices...           │
│                             │
│  ┌───────────────────────┐  │
│  │ JXFGBAF968  ████░  -52│  │
│  │ FloodGuard Main       │  │
│  └───────────────────────┘  │
│                             │
│       [Scan again]          │
└─────────────────────────────┘
```
- Animated pulse/sonar rings from center
- Each device appears as a card with signal bars and RSSI dBm
- Auto-selects if only one device found

### Screen 2 — WiFi Setup
```
┌─────────────────────────────┐
│  Connect JXFGBAF968         │
│  ─────────────────          │
│  Network (from your phone): │
│  ┌───────────────────────┐  │
│  │ 📶 MyHomeWiFi     [✓] │  │
│  └───────────────────────┘  │
│  [Use a different network ▼]│
│                             │
│  Password                   │
│  ┌───────────────────────┐  │
│  │ ••••••••••••      [👁]│  │
│  └───────────────────────┘  │
│                             │
│  [    Connect Device    ]   │
└─────────────────────────────┘
```
- SSID auto-filled from phone's current WiFi (`WifiManager` API on Android/iOS)
- "Use a different network" triggers `scan_wifi` BLE command, shows dropdown
- Password show/hide toggle
- No SSID entry needed in 99% of cases (phone is already on the right network)

### Screen 3 — Progress (Animated Steps)
```
┌─────────────────────────────┐
│  Setting up your device     │
│                             │
│  ✅ BLE Connected           │
│  ⟳  Connecting to WiFi...  │
│  ○  Reaching Cloud          │
│                             │
│  [──────░░░░░░░░──────]     │
│         Connecting...       │
│                             │
│  This takes about 20 sec    │
└─────────────────────────────┘
```
- Steps animate in sequence: BLE → WiFi → Cloud
- Each step: pending (grey circle) → in-progress (spinning) → done (green checkmark)
- Progress bar fills smoothly
- Timeout shown with retry option

### Screen 4a — Success (Internet Available)
```
┌─────────────────────────────┐
│                             │
│         [✅ Big tick]       │
│                             │
│   Device Ready!             │
│   JXFGBAF968                │
│                             │
│   WiFi: MyHomeWiFi          │
│   IP:   192.168.1.42        │
│   Cloud: Connected ✅       │
│                             │
│  [   Open Dashboard   ]     │
└─────────────────────────────┘
```

### Screen 4b — Success (No Internet / Local Mode)
```
┌─────────────────────────────┐
│                             │
│         [✅ Big tick]       │
│                             │
│   Device Ready (Local Mode) │
│   JXFGBAF968                │
│                             │
│   WiFi: MyHomeWiFi  ✅      │
│   Cloud: ⚠️ No internet     │
│                             │
│   Access locally at:        │
│   fg-main-edgehax-01.local  │
│   [  Open Local Panel  ]    │
│                             │
│   Monitoring for internet...│
└─────────────────────────────┘
```
- Opens mDNS URL in in-app browser
- Background: polls for internet, shows toast when cloud connects
- Toast: "Cloud connected — you can now use the app dashboard"

---

## 6. Professional Enhancements (Recommended)

### 6.1 BLE Notify Characteristic (Priority: High)
Add a second NOTIFY characteristic so the device pushes status to app instead of app polling.  
Device sends progress events during WiFi connection:
```json
{"event":"wifi_connecting","ssid":"MyHomeWiFi"}
{"event":"wifi_connected","ip":"192.168.1.42"}
{"event":"mqtt_connected","broker":"vps"}
{"event":"mqtt_failed","reason":"no_internet"}
```
App reacts instantly without polling.

### 6.2 QR Code on Device Label (Priority: High)
Print a QR code on the device label containing:
```json
{"id":"JXFGBAF968","mdns":"fg-main-edgehax-01","token":"pre-seeded-token"}
```
App scans QR → auto-selects device in BLE scan → skips manual device selection.  
Also used as factory token for MQTT auth.

### 6.3 AP Fallback Mode (Priority: Medium)
If BLE provisioning fails (BLE disabled on phone, older Android):  
- Device creates SoftAP: SSID = `JXFG-BAF968`, Password = last 8 of MAC
- App shows "Can't find device via BLE? Connect to JXFG-BAF968 WiFi"
- Phone connects to that AP, visits `http://192.168.4.1/`
- Simple WiFi credential form (same as mDNS WebUI `/config`)
- Device reboots with new credentials

### 6.4 Re-Provisioning Lock (Priority: Medium)
After provisioning, BLE advertising stops permanently.  
To re-provision, user must hold CONFIG button 10 seconds until LED flashes.  
This prevents neighbours or anyone nearby from re-provisioning the device over BLE.

### 6.5 Silent Re-Provisioning via Auth Token (Priority: Low)
For IT installers managing many devices: allow BLE `set_wifi` only if a valid token is also sent:
```json
{"cmd":"set_wifi","ssid":"NewNet","password":"pass","token":"device-specific-token"}
```
Token = sha256 truncated from device serial, printed on device label.  
Without token, `set_wifi` is rejected after provisioning (lock is active).

### 6.6 Multi-Network Profile (Priority: Low)
Store up to 3 WiFi SSID+password pairs in NVS.  
Device auto-tries all three on startup, uses first that connects.  
Useful for installation sites with primary + backup WiFi networks.

---

## 7. What Is Already Implemented

| Feature | Status | Notes |
|---|---|---|
| BLE advertising | ✅ Done | Prefix is `FgMain` — change to `JXFG` |
| BLE `hello` command | ✅ Done | Returns name, WiFi status, IP |
| BLE `scan_wifi` | ✅ Done | Returns up to 8 SSIDs with RSSI |
| BLE `set_wifi` | ✅ Done | Saves to NVS, connects within 20s |
| WiFi retry loop | ✅ Done | Retries every 15s |
| NVS credential persist | ✅ Done | Survives reboot |
| mDNS + local WebUI | ✅ Done | Starts on WiFi connect |
| Factory reset via WebUI | ✅ Done | Clears NVS, reboots to BLE |
| MQTT cloud connection | ✅ Done | Connects after WiFi |
| BLE stop after provisioning | ✅ Done | `BLEDevice::deinit()` |
| Internet check + fallback banner | ⬜ Needed | Add to WebUI + MQTT logic |
| BLE Notify characteristic | ⬜ Needed | Progress push events |
| `JXFG` BLE prefix | ⬜ 1-line fix | `ble_provisioning.cpp:63` |
| QR code label flow | ⬜ Needed | App-side only |
| AP fallback mode | ⬜ Needed | `LocalWebserver::startAp()` exists |
| Re-provisioning lock | ⬜ Needed | Firmware + app |

---

## 8. Reuse Checklist for New Projects

When applying this provisioning system to a new product:

- [ ] Set BLE name prefix (e.g., `JXFG`, `JXAQ`, `JXENV`)
- [ ] Set `DEVICE_ID_SEED` in `platformio.ini` per device
- [ ] Set `DEVICE_TOKEN_SEED` per device (pre-seed MQTT auth)
- [ ] Update mDNS hostname pattern in `local_webserver.cpp`
- [ ] Update service UUID and characteristic UUID (reuse or generate new)
- [ ] Update WebUI title, logo, nav items to match product
- [ ] Update NVS namespace (`NVS_NS_WIFI`, `NVS_NS_MAIN`) to avoid clashes with other products sharing same chip
- [ ] Print QR code on device label with `{"id":..., "mdns":..., "token":...}`
- [ ] Set factory reset button hold time and LED feedback pattern

---

## 9. Quick Reference — BLE Packet Examples

```json
// App → Device: check status
{"cmd":"hello"}

// Device → App: response
{"ok":true,"cmd":"hello","ble_name":"JXFGBAF968","wifi_connected":false,"ssid":"","ip":""}

// App → Device: scan networks
{"cmd":"scan_wifi"}

// Device → App: network list
{"ok":true,"cmd":"scan_wifi","networks":[{"ssid":"HomeNet","rssi":-45},{"ssid":"GuestNet","rssi":-72}]}

// App → Device: provision
{"cmd":"set_wifi","ssid":"HomeNet","password":"mysecretpass"}

// Device → App: success
{"ok":true,"cmd":"set_wifi","wifi_connected":true,"ip":"192.168.1.42"}

// Device → App: failure
{"ok":true,"cmd":"set_wifi","wifi_connected":false,"ip":""}
```
