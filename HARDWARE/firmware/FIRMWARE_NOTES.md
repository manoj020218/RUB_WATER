# FloodGuard Firmware — Hard-Won Notes

This file documents every non-obvious issue we hit during development so they are never repeated.
Keep it updated whenever a new bug is root-caused or a hardware constraint is discovered.

---

## 1. Stack overflow — loopTask (CRITICAL, SOLVED)

### Symptom
`Guru Meditation Error: Core 1 panic'ed — Stack canary watchpoint triggered (loopTask)`
Crash happened at ~5 seconds into boot, reproducibly.

### Root cause
The Arduino ESP32 framework default loopTask stack is **8 KB**. The lwIP TCP connect
cleanup path (called by MQTT `connect()` and by `HTTPClient::begin()` with DNS) uses
**~30–57 KB of stack depth**. 8 KB is nowhere near enough.

### Why `-DCONFIG_ARDUINO_LOOP_STACK_SIZE=65536` does NOT work alone
The framework's `cores/esp32/main.cpp` checks `ARDUINO_LOOP_STACK_SIZE` first:
```c
#ifndef ARDUINO_LOOP_STACK_SIZE
#ifndef CONFIG_ARDUINO_LOOP_STACK_SIZE
#define ARDUINO_LOOP_STACK_SIZE 8192
#else
#define ARDUINO_LOOP_STACK_SIZE CONFIG_ARDUINO_LOOP_STACK_SIZE
#endif
#endif
```
If `ARDUINO_LOOP_STACK_SIZE` is already defined anywhere (sdkconfig.h or another header),
the `-D` build flag value is silently ignored.

### Correct fix — weak symbol override in `src/main.cpp`
The framework exposes a `__attribute__((weak))` function specifically for overriding:
```cpp
// src/main.cpp (already applied)
size_t getArduinoLoopTaskStackSize() { return 65536; }
```
This is a **strong symbol** that replaces the framework's weak one. It is guaranteed to work
regardless of sdkconfig or build flag ordering. Do NOT remove it.

---

## 2. BLE malloc failure after stack size increase (CRITICAL, SOLVED)

### Symptom
After fixing the stack size to 64 KB: `E (1467) BLE_INIT: Malloc failed`
followed by watchdog timeout crash.

### Root cause
The 64 KB loopTask stack is allocated from the internal RAM heap. The ESP32-S3 only has
320 KB internal RAM; static data uses ~226 KB, leaving ~94 KB heap. BLE needs ~70 KB
contiguous heap. A 64 KB stack leaves only ~30 KB — not enough for BLE.

### Fix — enable PSRAM
This chip has **8 MB embedded OPI PSRAM** (`Features: WiFi, BLE, Embedded PSRAM 8MB (AP_3v3)`
in esptool output). It was NOT enabled in the build. With PSRAM enabled:
- Internal heap is preserved for BLE and WiFi
- Large allocations (stack, HTTP buffers) can spill into PSRAM

In `platformio.ini` (already applied):
```ini
board_build.arduino.memory_type = qio_opi
build_flags = ... -DBOARD_HAS_PSRAM ...
```

---

## 3. WiFiClientSecure — SSL memory allocation crash (SOLVED)

### Symptom
`[ssl_client.cpp] SSL - Memory allocation failed (-32512)` in serial log.
Device crashed or hung during BLE provisioning or local config operations.

### Root cause
`WiFiClientSecure` allocates ~32 KB of SSL context **on the stack** when constructed
locally (e.g., `WiFiClientSecure secureClient;` inside a function). With the default
8 KB loopTask stack this overflows immediately.

Additionally, `local_config_server.cpp::normalizeBaseUrl()` was defaulting bare hostnames
to `https://`, so every `http://api.floodguard.iotsoft.in` typed without scheme became
HTTPS and triggered SSL allocation.

### Fix (already applied)
- **`ble_provisioning.cpp`**: removed `WiFiClientSecure`, `beginHttpRequest()` returns `false` for HTTPS.
- **`local_config_server.cpp`**: same — `WiFiClientSecure` removed, defaults to `http://`.
- **`http_fallback.cpp`**: same.
- **`ota_manager.cpp`**: SSL kept only for the HTTPS OTA download branch (never triggered
  with `http://flash.iotsoft.in`).

**Rule**: Never construct `WiFiClientSecure` as a local variable inside any function that
runs on the loopTask. If HTTPS is needed, allocate on heap (`new WiFiClientSecure`).

---

## 4. RS485 sensor — DYP-A01 wiring and UART config

### Hardware
- Sensor: DYP-A01 ultrasonic distance sensor, TTL output (NOT RS485 despite the module name).
- Wired directly to ESP32-S3 GPIO21 (RX). **TX pin is NOT connected.**
- The sensor auto-broadcasts one 4-byte frame per second. No TX command needed.

### Frame format
```
0xFF  [H]  [L]  [SUM]
Distance (mm) = H*256 + L
Checksum = (0xFF + H + L) & 0xFF
Valid range: 280 mm – 2500 mm
```
Example: `0xFF 0x03 0xCD 0xCF` → distance = 3*256+205 = 973 mm, checksum = (255+3+205)&255 = 207 ✓

### UART configuration (already applied in `device_profile.h`)
```cpp
static const int RS485_RX_PIN = 21;
static const int RS485_TX_PIN = -1;  // not wired
static const int RS485_DERE_PIN = -1; // no DE/RE pin needed (auto-flow module)
```
Using `-1` for TX_PIN tells `HardwareSerial::begin()` not to configure any TX GPIO,
avoiding the hardware unnecessarily driving GPIO15 (which is connected to something else).

### Physical mounting constraint — minimum 280 mm clearance (CRITICAL)
The DYP-A01 minimum valid range is **280 mm**. If the sensor is mounted closer than
280 mm to the water surface (or any surface it points at), every frame is rejected by
`readDypFrame()` as out-of-range and `distanceMm` stays 0.

**What this looks like in the field:**
- Serial log prints: `[RS485] Distance out of range: 250 mm (valid 280-2500mm)`
- Telemetry publishes `distance_mm: 0` — **this is indistinguishable from "sensor absent"**
- App config page shows 0 mm; "Set Zero" is blocked by the `distanceMm <= 0` guard
- The firmware is working correctly — this is purely a hardware placement issue

**Rule**: Mount the sensor so there is **at least 280 mm** of clear air between the
sensor face and the lowest expected water level. Recommended mount height ≥ 350 mm to
leave calibration headroom.

### Previous RS485 module that failed (wasted 2 days)
The earlier RS485 module (MAX485 transceiver + DYP-A01) required DE/RE pin control
and a 300 ms inter-frame wait. It failed due to:
1. DE/RE not being toggled correctly in firmware.
2. The 300 ms intra-frame wait causing UART buffer stalls.
3. TXD voltage (2.93 V) being borderline for the module's threshold.
The current wiring (direct TTL on GPIO21) bypasses the transceiver entirely and works reliably.

---

## 5. MQTT / WiFi guards — boot sequence (SOLVED)

### Problem
MQTT was attempting TCP connect before WiFi was established. The blocking TCP connect
(5 s timeout) ran on the loopTask, consuming deep lwIP stack frames and crashing.

### Fix (already applied in `main.cpp`)
```cpp
static const unsigned long kMqttBootDelayMs = 15000UL;
if (wifiConnected && millis() >= kMqttBootDelayMs) {
    MqttClientService::getInstance().loop();
}
```
`publishWithFallback()` also guards: if no WiFi, events are queued locally instead of
attempting HTTP, preventing unnecessary DNS lookups at startup.

### MQTT exponential backoff
`mqtt_client.cpp` implements backoff: 5 s → 15 s → 30 s → 60 s → 300 s.
Resets to 5 s on successful connection. This prevents a tight crash loop if the
MQTT server is unreachable.

---

## 6. NVS "NOT_FOUND" errors at boot — normal, not a bug

Every boot on a freshly-flashed device prints:
```
nvs_get_str len fail: mqtt_host NOT_FOUND
nvs_get_str len fail: mqtt_user NOT_FOUND
...
```
These are **expected** — the Preferences library prints this whenever a key doesn't exist
yet. The firmware handles `NOT_FOUND` correctly by falling back to `device_profile.h`
defaults. After first provisioning, these disappear.

---

## 7. Serial monitoring on USB-CDC (ESP32-S3)

The firmware uses `ARDUINO_USB_CDC_ON_BOOT=1`. Serial output goes through the ESP32-S3's
native USB CDC interface, NOT through a UART bridge. Implications:

- **PIO monitor** (`pio device monitor`) with `monitor_dtr = 0` opens the port without
  asserting DTR. The CDC implementation may discard Serial output if it thinks no terminal
  is connected. Symptom: PIO monitor shows only the header, then silence.
- **Boot messages are lost** if the monitor opens after the device has already booted.

### Reliable capture method
Use the Arduino 1200-baud CDC reset trick. While the device is running:
```python
import serial, time
s = serial.Serial('COMXX', 1200, timeout=0.5)
s.dtr = True
time.sleep(0.8)
s.close()
time.sleep(2.5)
# Now open at 115200 — device has just rebooted
s = serial.Serial('COMXX', 115200, timeout=0.2)
s.dtr = True
# read from s...
```
Opening at 1200 baud sends a CDC control signal that triggers a device reset.
After 2.5 s, the device is mid-boot and the next open captures everything.

---

## 8. BLE provisioning — WiFi radio conflict (SOLVED)

### Problem
BLE provisioning step 3 (`device_register_failed: wifi_not_connected`) despite the device
being on WiFi.

### Root cause
BLE and WiFi share the single 2.4 GHz antenna on ESP32-S3. The BLE WRITE operation that
delivers the `c` (connect) command briefly drops WiFi. The register call checked
`WiFi.status()` at exactly this drop moment.

### Fix (already applied in `ble_provisioning.cpp`)
```cpp
// BLE write causes brief WiFi drop on ESP32-S3 (shared antenna). Retry 3 s.
for (uint8_t i = 0; i < 6 && WiFi.status() != WL_CONNECTED; i++) {
    delay(500);
}
```

---

## 9. NVS migration — do not skip known-good hosts

`mqtt_client.cpp::loadPersistedConnection()` and `http_fallback.cpp::loadPersistedCloudAuth()`
had a bug: they skipped `api.floodguard.iotsoft.in` in the "skip old hosts" list, preventing
BLE-provisioned credentials from loading on reboot.

Correct check (already applied): only skip the retired hostname `FGServer.jenix.in`.

---

## 10. PSRAM board variant note

The ESP32-S3 on this board reports `Embedded PSRAM 8MB (AP_3v3)` in esptool.
The correct `memory_type` for this OPI PSRAM configuration is `qio_opi`:
```ini
board_build.arduino.memory_type = qio_opi
```
If PSRAM is NOT enabled: BLE fails to allocate when the loopTask stack is ≥ 32 KB.
Always verify PSRAM is active by checking `esp_get_free_heap_size()` in serial output —
it should be several hundred KB, not ~30 KB.

---

## 11. BLE malloc failure — `BTU_StartUp Unable to allocate resources` (CRITICAL, SOLVED)

### Symptom
`E (1495) BT_LOG: BTU_StartUp Unable to allocate resources for bt_workqueue`
followed by `assert failed: vQueueDelete` and immediate reboot. Crash loop at ~1.5 s.
Even with PSRAM enabled (`qio_opi`), the crash persisted.

### Root cause
BLE init (`BLEDevice::init()`) allocates ~70 KB from the **internal** RAM heap.
The 64 KB loopTask stack (from fix #1) is ALSO allocated from internal RAM because
the Arduino framework's `xTaskCreateUniversal()` uses the default heap, and 94 KB of
internal heap minus 64 KB stack = only ~30 KB left for BLE.

PSRAM being enabled does NOT automatically redirect the loopTask stack to PSRAM.
`CONFIG_SPIRAM_MALLOC_ALWAYSINTERNAL` in `sdkconfig.board` also does NOT work —
the PlatformIO Arduino framework uses pre-built IDF binaries; `sdkconfig.board`
overrides are not compiled into those binaries.

### Why BLE is not needed on a provisioned device
BLE provisioning is a one-time operation. After WiFi+MQTT credentials are saved to NVS,
BLE is never used again. Starting BLE on every boot just to never use it was the bug.

### Fix (already applied)
**`ble_provisioning.cpp::loop()`**: removed the auto-start that called `begin()` on
every loop tick if `_started` was false. `loop()` now returns early if not started:
```cpp
if (!_started) {
    return;
}
```

**`main.cpp::setup()`**: `begin()` is now conditional — only called when
(a) not a DEV_WIFI build AND (b) NVS has no saved WiFi SSID (device is unprovisioned):
```cpp
#if defined(DEV_WIFI_SSID)
    // DEV build: no BLE, saves ~70KB internal heap
#else
    if (!deviceIsProvisioned) {
        BleProvisioningService::getInstance().begin(config);
    }
#endif
```

`deviceIsProvisioned` is checked by reading `WifiManager::getConfiguredSsid()` AFTER
`WifiManager::begin()` but BEFORE the DEV_WIFI override. If NVS has a saved SSID that
is not `"CHANGE_WIFI_SSID"`, the device is considered provisioned.

### Effect
Skipping BLE init frees ~70 KB internal RAM. Flash size dropped from 1.67 MB to 1.12 MB
because the linker prunes the entire BLE stack when `begin()` is unreachable.

---

## 12. MQTT ACL — messages silently dropped (CRITICAL, SOLVED)

### Symptom
Device showed `[MQTT] Connected!` in serial, backend API confirmed MQTT broker subscription,
but `last_seen` timestamp in the backend DB never updated and the device stayed OFFLINE.
`mosquitto_sub` on `rub/#` received nothing.

### Root cause
The Mosquitto broker has ACL rules in `/etc/mosquitto/acl`:
```
user RUB043-CTRL01
topic readwrite rub/RUB043-CTRL01/#

# Anonymous/all clients
topic readwrite device/#
```
The password file is commented out (`#password_file`), so `allow_anonymous true` means
all clients connect regardless of password. But the **ACL uses the MQTT username** to
determine topic permissions.

The firmware's `DEFAULT_MQTT_USER = "floodguard_device"` (device_profile.h) doesn't
have an ACL entry for `rub/#`, so every publish to `rub/RUB043-CTRL01/telemetry` etc.
was **silently discarded by the broker** with no error logged on the device.

`mqtt_client.cpp::loadPersistedConnection()` had a fallback to use `deviceId` as the
MQTT username, but it only fired when `_user` was empty — with "floodguard_device" as
default, the fallback was never reached.

### Fix (already applied in `device_profile.h`)
```cpp
// Was: static const char DEFAULT_MQTT_USER[] = "floodguard_device";
static const char DEFAULT_MQTT_USER[] = "";
```
With empty default, `loadPersistedConnection()` falls through to:
```cpp
if (_user[0] == '\0' && _deviceId[0] != '\0' && _pass[0] != '\0') {
    std::strncpy(_user, _deviceId, sizeof(_user) - 1);
}
```
This sets the MQTT username to the device ID (`RUB043-CTRL01`), which matches the ACL.

### Rule
`DEFAULT_MQTT_USER` in `device_profile.h` MUST remain empty. The mqtt_client.cpp
fallback auto-sets it to `deviceId`. If a non-empty default is ever added back,
publishes will be silently dropped by the broker ACL.

---

## 13. VPS backend — `location_id` mismatch silently misroutes telemetry (CRITICAL, SOLVED)

### Symptom
Device showed ONLINE in backend, MQTT messages were arriving, but the app config page
showed "Awaiting data" on the live RS485 panel. `GET /locations/RUB43-AJ/dashboard`
returned `latest: null` despite telemetry flowing continuously.

### Root cause
The firmware sends `location_id: "RUB043"` (from `DEFAULT_LOCATION_ID` in
`device_profile.h`). The DB record for this device has `location_id: "RUB43-AJ"`.

`deviceService.js::ingestTelemetry()` only overrode `location_id` when the **payload
omitted it entirely**:
```js
// Old (buggy):
const resolvedPayload = (!payload.location_id && device.location_id)
  ? { ...payload, location_id: device.location_id }
  : payload;
```
Because the firmware always includes `location_id: "RUB043"`, the condition
`!payload.location_id` was always false — every telemetry record was stored with the
firmware's wrong value. The dashboard query for `"RUB43-AJ"` found zero records.

`ingestEvent()` had the same problem AND created the event record before looking up
the device, so there was no opportunity to override at all.

### Fix (applied to VPS `backend/src/services/deviceService.js`)
```js
// ingestTelemetry — always use device DB's location_id:
const resolvedPayload = device.location_id
  ? { ...payload, location_id: device.location_id }
  : payload;

// ingestEvent — find device first, resolve location, then create record:
function ingestEvent(payload) {
  const device = deviceRepository.findById(payload.device_id);
  if (!device) { throw notFound('Device not found'); }
  const resolvedPayload = device.location_id
    ? { ...payload, location_id: device.location_id }
    : payload;
  const event = createEventRecord(resolvedPayload);
  ...
}
```

### Rule
The VPS backend is the **authoritative source for `location_id`**. The firmware's
`DEFAULT_LOCATION_ID` is a hint only. Both `ingestTelemetry` and `ingestEvent` must
always override `location_id` from `device.location_id` (DB), never trust the payload.

This matters whenever a device is re-provisioned to a different location, or when
`DEFAULT_LOCATION_ID` in firmware doesn't exactly match the ID in the DB.

---

## 14. Provisioning pipeline — build envs, factory reset, provision key (PROD READY)

### Build environments (`platformio.ini`)

| Environment | Command | Use |
|---|---|---|
| `esp32-s3-prod` | `pio run -e esp32-s3-prod -t upload` | **Field devices** — BLE provisioning enabled |
| `esp32-s3-dev` | `pio run -e esp32-s3-dev -t upload` | Bench testing — hardcoded WiFi, BLE skipped |

`pio run` (no flags) defaults to **prod**. The dev build defines `DEV_WIFI_SSID` which
the preprocessor uses to skip BLE entirely and patch in hardcoded WiFi credentials.

### Factory reset — re-provision any time

Hold the **BOOT button (GPIO0)** for **5 seconds** at power-on:
1. Serial prints: `[RESET] BOOT held — keep holding 5s to factory-reset...`
2. Release before 5 s → normal boot (safe cancellation)
3. Hold full 5 s → NVS namespace `fgcfg` is cleared (all WiFi + MQTT credentials)
4. Device reboots → BLE advertises `JNX-FG<MAC>` → ready for fresh provisioning

This is the test loop: flash once, factory-reset repeatedly to test provisioning.
`fgcfg` is the only Preferences namespace the firmware uses for credentials; clearing
it is equivalent to a factory reset without re-flashing.

### Provision key

```
FloodGuard@302020
```
Stored in `VPS_SHIFT_CONFIG.json` → `security.deviceProvisionKey`.
`requireDeviceProvisionKey: true` — the VPS rejects any `/api/device/register` call
that doesn't include `x-provision-key: FloodGuard@302020`.

The app's BLE provisioning screen has a **"Provision Key"** input (persisted in
localStorage). Enter this value before tapping **Apply Cloud**.

### Device registration flow (via BLE `c` command)

1. App sends BLE `c` command with `pk: "FloodGuard@302020"` and VPS URL
2. Firmware calls `registerDeviceAndFetchKey()` → `POST http://api.floodguard.iotsoft.in/api/device/register`
   with `x-provision-key: FloodGuard@302020` header
3. VPS returns `{ device_key: "fgk_...", cloud: { mqtt: { host, port, username, password } } }`
4. Firmware saves `device_key` as MQTT password to NVS; MQTT username = deviceId (per §12 rule)
5. After saving, firmware schedules a **2.5 s reboot** so the BLE response reaches the app first

### Auto-reboot after cloud provisioning

`ble_provisioning.cpp::handleCommand()` sets `_rebootScheduledMs = millis() + 2500` at the
end of every `set_cloud` / `c` handler. `loop()` fires `ESP.restart()` when elapsed.

**Why reboot instead of reconnecting in-place:**
- BLE is consuming ~70 KB internal RAM; rebooting frees it for MQTT/WiFi
- `deviceIsProvisioned` is evaluated once in `setup()` — after provisioning, a reboot
  ensures BLE is never started again for this device
- Clean state: all services re-init with the new NVS credentials

### End-to-end test sequence

1. Flash `esp32-s3-prod` → Serial shows `[BLE] Advertising as JNX-FG<MAC>`
2. Open FloodGuard app → **Provision** tab → **Scan** → select the device
3. **WiFi tab**: enter SSID + password → **Connect** → wait for `[BLE][set_wifi] wc=1 ip=...`
4. **Cloud tab**: enter Provision Key `FloodGuard@302020` → **Apply** → wait for confirmation
5. Device prints `[BLE] Cloud credentials saved — rebooting in 2.5 s` → reboots
6. App shows BLE disconnect (expected) → device reconnects WiFi + MQTT
7. Dashboard shows device status = **ONLINE**

To re-test: hold BOOT 5 s → factory reset → repeat from step 2. The firmware's
`DEFAULT_LOCATION_ID` is a hint only. Both `ingestTelemetry` and `ingestEvent` must
always override `location_id` from `device.location_id` (DB), never trust the payload.

This matters whenever a device is re-provisioned to a different location, or when
`DEFAULT_LOCATION_ID` in firmware doesn't exactly match the ID in the DB.
