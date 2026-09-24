# Config JSON Size Fix — Handoff (2026-09-24)

**Status:** NOT APPLIED. Deferred to the next scheduled maintenance window. Sites are live, so no firmware change until then.
**Affects:** ESP32-S3 MAIN firmware (`firmware_EDGEHAX_S3_ST485_RTU4ch_WAVE485`), field version `0.2.1` (e.g. RUB42-AJ).

---

## 1. Problem

The device never sends its full config to the VPS. So the VPS has no `device_reported` config for the device (verified on VPS for RUB42-AJ on 2026-09-24).

Because of that, the APK Config page used to block **Save via Cloud** with the message *"Current configuration has not been downloaded from the device yet"*. The request never reached the VPS. This showed up when changing **Sensor Input Mode** to *RS485 US Sensor + Switch Type Sensor*.

## 2. Root cause

`ConfigManager::buildJson()` (`src/config_manager.cpp`) writes **35 keys, about 896 bytes**. Most of that is alias duplicates: `trigger_delay_s` + `trigger_delay_seconds`, three names for the zero distance, three names for the sensor mode, and so on.

Two callers copy that JSON into 768-byte buffers:

| Caller | Buffer | Effect |
|---|---|---|
| `TelemetryManager::buildBootConfigJson()` (`telemetry_manager.cpp` ~L317) | `char cfgJson[768]` + `StaticJsonDocument<768>` | `serializeJson` truncates, but its return value is still > 0, so it counts as success. `deserializeJson` then fails and **`current_config` is silently omitted** from `DEVICE_BOOTED_CONFIG_REPORT`. The whole report (about 1148 bytes) would also overflow `payload[1024]`. |
| Config ACK in `main.cpp` (~L605–L623) | `char cfgJson[768]` + `StaticJsonDocument<768>` | Same failure. `current_config` is missing from `config_ack`, so the VPS never records what config the device applied. |

The local HTTP `/config` endpoints use 1024-byte buffers (`local_webserver.cpp` L599, L693) and currently work, but they have very little headroom.

## 3. Interim workaround (live since APK v1.0.18; current release v1.0.19, 2026-09-24)

`APK/src/pages/ConfigPage.tsx` → `configMatchesDeviceTelemetry()`: the upload guard also passes when the device's live telemetry `current_config_version` equals the server config version.

- No backend or firmware change was needed for this.
- It depends on telemetry continuing to carry `current_config_version`.
- **Keep this workaround even after the firmware fix.** It does no harm.

## 4. Fix to apply (single function, `src/config_manager.cpp`)

Replace `ConfigManager::buildJson()` with a compact version that has one key per field. Worst case (every value at its maximum) is **577 bytes and 22 keys**, and the boot report becomes at most **863 bytes**.

```cpp
bool ConfigManager::buildJson(char* out, size_t outSize) const {
    // Compact form: one key per field (~560 bytes). Consumers (VPS normalizeConfigForCompare,
    // APK applyConfig) accept these names; the old alias duplicates pushed this past the 768-byte
    // buffers used by the boot config report and config ACK, which silently dropped current_config.
    StaticJsonDocument<768> doc;
    doc["alert_level_mm"] = _cfg.alertLevelMm;
    doc["danger_level_mm"] = _cfg.dangerLevelMm;
    doc["clear_level_mm"] = _cfg.dangerClearLevelMm;
    doc["trigger_delay_s"] = _cfg.triggerDelaySeconds;
    doc["clear_delay_s"] = _cfg.alarmClearDelaySeconds;
    doc["zero_dist_mm"] = _cfg.zeroDistanceMm;
    doc["rs485_enabled"] = _cfg.rs485SensorEnabled;
    doc["switch_enabled"] = _cfg.switchSensorEnabled;
    doc["switch_level_1_mm"] = _cfg.switchLevel1Mm;
    doc["switch_level_2_mm"] = _cfg.switchLevel2Mm;
    doc["sensor_confirmation_wait_sec"] = _cfg.mismatchDurationSeconds;
    doc["sensor_mode"] = strcmp(sensorLogicMode(), "DUAL") == 0 ? "BOTH_ACTIVE"
                        : (strcmp(sensorLogicMode(), "RS485_ONLY") == 0 ? "DYP_ONLY"
                           : sensorLogicMode());
    doc["left_remote_enabled"] = _cfg.leftRemoteEnabled;
    doc["right_remote_enabled"] = _cfg.rightRemoteEnabled;
    doc["daily_reboot_enabled"] = _cfg.dailyRebootEnabled;
    doc["daily_reboot_hour"] = _cfg.dailyRebootHour;
    doc["daily_reboot_minute"] = _cfg.dailyRebootMinute;
    doc["vmon_cal_factor"] = _cfg.vMonCalFactor;
    doc["left_rtu_slave_id"] = _cfg.leftRtuSlaveId;
    doc["right_rtu_slave_id"] = _cfg.rightRtuSlaveId;
    doc["telemetry_idle_interval_seconds"] = _cfg.telemetryIdleIntervalSeconds;
    doc["current_config_version"] = _cfg.configVersion;
    const size_t needed = measureJson(doc);
    if (doc.overflowed() || needed + 1 > outSize) return false;   // never emit truncated JSON
    return serializeJson(doc, out, outSize) == needed;
}
```

**Keys removed (aliases only):**
- `danger_clear_level_mm`
- `trigger_delay_seconds`
- `alarm_clear_delay_seconds`, `clear_delay_seconds`
- `zero_distance_mm`, `sensor_mount_height_mm`
- `rs485_sensor_enabled`, `switch_sensor_enabled`
- `mismatch_duration_seconds`
- `sensor_logic_mode`, `logic_mode`
- `daily_reboot_time` (the VPS rebuilds it from the hour and minute)
- `config_version`

## 5. Consumers checked (2026-09-24)

| Consumer | Reads | Compatible? |
|---|---|---|
| VPS `deviceConfigService.normalizeConfigForCompare()` | Alias fallbacks for every field (`trigger_delay_s`, `clear_delay_s`, `zero_dist_mm`, `rs485_enabled`, `switch_enabled`, `sensor_confirmation_wait_sec`, `sensor_mode`) | Yes. `CONFIG_COMPARE_KEYS` are compared after normalisation. |
| VPS boot report → `deviceService` L525 (`event.details.current_config`) | Passed to `syncDeviceReportedConfig` → normalised | Yes |
| VPS config ACK → `deviceConfigService` L943 (`payload.current_config`) | Same | Yes |
| APK `ConfigPage.applyConfig()` (server config and local LAN `result.current_config`) | `trigger_delay_s ?? …`, `clear_delay_s ?? …`, `zero_dist_mm ?? …`, `sensor_mode ?? …`, `sensor_confirmation_wait_sec ?? …`, `current_config_version ?? version` | Yes |
| Firmware local web UI form (`local_webserver.cpp` L610–640) | Built from the `cfg` struct, not from `buildJson` | Not affected |
| Firmware telemetry (`telemetry_manager.cpp` L160–220) | Built from the `cfg` struct, not from `buildJson` | Not affected |

## 6. Maintenance-window procedure

1. Apply §4 on a branch and run `pio run -e <prod env>` (FIRMWARE_VERSION `0.2.1` → bump to `0.2.2`).
2. **Bench test on a spare S3 board first**, never on a live site:
   - Boot the board. The VPS audit log should show `DEVICE_BOOTED_CONFIG_REPORT` with `details.current_config` present, and the device config should get `device_reported` / `device_reported_at`.
   - Save via Cloud with a sensor mode change. `config_ack` should include `current_config`, and the config state should become VERIFIED.
   - Local LAN **Save Direct** should return `current_config` and the APK form should fill in correctly.
   - The Live page should show the new Sensor Input Mode after the reboot.
3. OTA one live site (RUB42-AJ) during the window. Watch it for one full boot and one config save.
4. Roll out to the remaining sites.

**Rollback:** re-flash `0.2.1` via OTA. The config lives in NVS as a struct, not JSON, so it is unaffected either way.

## 7. Related

- The overall session handoff (app, VPS, Play Store status, open issues) is in `HANDOFF_2026-09-24.md` at the repo root.
- **Play Store:** the owner uploaded build 19 (1.0.18). The next release is `APK/FloodGuard-v1.0.19-release.aab` (build 20). Remaining Console items are listed in the root handoff §4.
