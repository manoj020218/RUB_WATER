#include "config_manager.h"

#include <ArduinoJson.h>
#include <Preferences.h>

#include "device_profile.h"
#include "dyp_sensor.h"

namespace {
constexpr uint32_t kLegacyConfigMagic = 0xFEED0008UL;
constexpr uint32_t kConfigSchemaMagic = 0xFEED0009UL;

struct LegacyMainConfig {
    uint16_t alertLevelMm;
    uint16_t dangerLevelMm;
    uint16_t dangerClearLevelMm;
    uint16_t triggerDelaySeconds;
    uint16_t alarmClearDelaySeconds;
    uint16_t zeroDistanceMm;
    bool     rs485SensorEnabled;
    bool     switchSensorEnabled;
    uint16_t switchLevel1Mm;
    uint16_t switchLevel2Mm;
    uint16_t mismatchDurationSeconds;
    bool     leftRemoteEnabled;
    bool     rightRemoteEnabled;
    bool     dailyRebootEnabled;
    uint8_t  dailyRebootHour;
    uint8_t  dailyRebootMinute;
    float    vMonCalFactor;
    uint8_t  leftRtuSlaveId;
    uint8_t  rightRtuSlaveId;
    uint16_t telemetryIdleIntervalSeconds;
    uint32_t configVersion;
};
}

ConfigManager& ConfigManager::getInstance() {
    static ConfigManager inst;
    return inst;
}

void ConfigManager::begin() {
    loadDefaults();
    if (!loadFromNvs()) {
        Serial.println("[CFG] NVS empty or version mismatch, using defaults");
        save(false);
    }
#ifdef DUMMY_DYP_MM
    _cfg.leftRemoteEnabled  = false;
    _cfg.rightRemoteEnabled = true;
#endif
    Serial.printf("[CFG] rev=%lu alert=%d danger=%d clear=%d trigDelay=%d clearDelay=%d zero=%d mode=%s\n",
                  (unsigned long)_cfg.configVersion,
                  _cfg.alertLevelMm, _cfg.dangerLevelMm, _cfg.dangerClearLevelMm,
                  _cfg.triggerDelaySeconds, _cfg.alarmClearDelaySeconds,
                  _cfg.zeroDistanceMm, sensorLogicMode());
}

const MainConfig& ConfigManager::get() const { return _cfg; }

bool ConfigManager::save(bool bumpVersion) {
    Preferences prefs;
    if (!prefs.begin(NVS_NS_MAIN, false)) {
        Serial.println("[CFG] NVS open failed");
        return false;
    }
    if (bumpVersion) {
        _cfg.configVersion = (_cfg.configVersion == 0) ? 1UL : (_cfg.configVersion + 1UL);
    } else if (_cfg.configVersion == 0) {
        _cfg.configVersion = 1UL;
    }
    _cfg.schemaVersion = kConfigSchemaMagic;
    prefs.putBytes("cfg", &_cfg, sizeof(_cfg));
    prefs.end();
    return true;
}

bool ConfigManager::applyJson(const char* json, String& reason) {
    StaticJsonDocument<1024> doc;
    if (deserializeJson(doc, json) != DeserializationError::Ok) {
        reason = "invalid_json";
        return false;
    }
    MainConfig next = _cfg;

#define OPT_U16(field, key) \
    if (doc.containsKey(key)) next.field = (uint16_t)doc[key].as<int>();
#define OPT_BOOL(field, key) \
    if (doc.containsKey(key)) next.field = doc[key].as<bool>();
#define OPT_U8(field, key) \
    if (doc.containsKey(key)) next.field = (uint8_t)doc[key].as<int>();

    OPT_U16(alertLevelMm,           "alert_level_mm")
    OPT_U16(dangerLevelMm,          "danger_level_mm")
    OPT_U16(dangerClearLevelMm,     "danger_clear_level_mm")
    OPT_U16(dangerClearLevelMm,     "clear_level_mm")
    OPT_U16(triggerDelaySeconds,    "trigger_delay_seconds")
    OPT_U16(triggerDelaySeconds,    "trigger_delay_s")
    OPT_U16(alarmClearDelaySeconds, "alarm_clear_delay_seconds")
    OPT_U16(alarmClearDelaySeconds, "clear_delay_seconds")
    OPT_U16(alarmClearDelaySeconds, "clear_delay_s")
    OPT_BOOL(leftRemoteEnabled,     "left_remote_enabled")
    OPT_BOOL(rightRemoteEnabled,    "right_remote_enabled")
    OPT_BOOL(dailyRebootEnabled,    "daily_reboot_enabled")
    OPT_U8(dailyRebootHour,         "daily_reboot_hour")
    OPT_U8(dailyRebootMinute,       "daily_reboot_minute")
    OPT_U16(telemetryIdleIntervalSeconds, "telemetry_idle_interval_seconds")
    OPT_BOOL(rs485SensorEnabled,    "rs485_sensor_enabled")
    OPT_BOOL(rs485SensorEnabled,    "rs485_enabled")
    OPT_BOOL(switchSensorEnabled,   "switch_sensor_enabled")
    OPT_BOOL(switchSensorEnabled,   "switch_enabled")
    OPT_U16(switchLevel1Mm,         "switch_level_1_mm")
    OPT_U16(switchLevel2Mm,         "switch_level_2_mm")
    OPT_U16(mismatchDurationSeconds, "mismatch_duration_seconds")
    OPT_U16(mismatchDurationSeconds, "sensor_confirmation_wait_sec")
    if (doc.containsKey("vmon_cal_factor")) {
        next.vMonCalFactor = doc["vmon_cal_factor"].as<float>();
    }
    if (doc.containsKey("left_rtu_slave_id")) {
        next.leftRtuSlaveId = (uint8_t)constrain(doc["left_rtu_slave_id"].as<int>(), 1, 247);
    }
    if (doc.containsKey("right_rtu_slave_id")) {
        next.rightRtuSlaveId = (uint8_t)constrain(doc["right_rtu_slave_id"].as<int>(), 1, 247);
    }
    if (doc.containsKey("sensor_mount_height_mm")) {
        next.zeroDistanceMm = (uint16_t)doc["sensor_mount_height_mm"].as<int>();
    }
    if (doc.containsKey("zero_distance_mm")) {
        next.zeroDistanceMm = (uint16_t)doc["zero_distance_mm"].as<int>();
    }
    if (doc.containsKey("zero_dist_mm")) {
        next.zeroDistanceMm = (uint16_t)doc["zero_dist_mm"].as<int>();
    }
    if (doc.containsKey("sensor_mode") || doc.containsKey("sensor_logic_mode") || doc.containsKey("logic_mode")) {
        String mode = doc.containsKey("sensor_mode")
                    ? doc["sensor_mode"].as<String>()
                    : (doc.containsKey("sensor_logic_mode")
                        ? doc["sensor_logic_mode"].as<String>()
                        : doc["logic_mode"].as<String>());
        mode.trim();
        mode.toUpperCase();
        if (mode == "DUAL" || mode == "BOTH_ACTIVE") {
            next.rs485SensorEnabled = true;
            next.switchSensorEnabled = true;
        } else if (mode == "RS485_ONLY" || mode == "DYP_ONLY") {
            next.rs485SensorEnabled = true;
            next.switchSensorEnabled = false;
        } else if (mode == "SWITCH_ONLY") {
            next.rs485SensorEnabled = false;
            next.switchSensorEnabled = true;
        } else if (mode == "NO_SENSOR") {
            next.rs485SensorEnabled = false;
            next.switchSensorEnabled = false;
        } else {
            reason = "invalid_sensor_logic_mode";
            return false;
        }
    }

    if (doc.containsKey("daily_reboot_time")) {
        const String hhmm = doc["daily_reboot_time"].as<String>();
        const int colon = hhmm.indexOf(':');
        if (colon > 0) {
            next.dailyRebootHour = (uint8_t)constrain(hhmm.substring(0, colon).toInt(), 0, 23);
            next.dailyRebootMinute = (uint8_t)constrain(hhmm.substring(colon + 1).toInt(), 0, 59);
        }
    }

#undef OPT_U16
#undef OPT_BOOL
#undef OPT_U8

    if (!validate(next, reason)) return false;
    const bool zeroChanged = next.zeroDistanceMm != _cfg.zeroDistanceMm;
    _cfg = next;
#ifdef DUMMY_DYP_MM
    _cfg.leftRemoteEnabled  = false;
    _cfg.rightRemoteEnabled = true;
#endif
    if (zeroChanged && !DypSensor::getInstance().setZeroDistanceMm(_cfg.zeroDistanceMm, reason)) {
        return false;
    }
    return save(true);
}

bool ConfigManager::setZeroDistance(uint16_t mm, String& reason) {
    if (mm < 300 || mm > 3000) {
        reason = "zero_distance_out_of_range";
        return false;
    }
    _cfg.zeroDistanceMm = mm;
    save(true);
    return true;
}

bool ConfigManager::buildJson(char* out, size_t outSize) const {
    StaticJsonDocument<960> doc;
    doc["alert_level_mm"] = _cfg.alertLevelMm;
    doc["danger_level_mm"] = _cfg.dangerLevelMm;
    doc["danger_clear_level_mm"] = _cfg.dangerClearLevelMm;
    doc["clear_level_mm"] = _cfg.dangerClearLevelMm;
    doc["trigger_delay_seconds"] = _cfg.triggerDelaySeconds;
    doc["trigger_delay_s"] = _cfg.triggerDelaySeconds;
    doc["alarm_clear_delay_seconds"] = _cfg.alarmClearDelaySeconds;
    doc["clear_delay_seconds"] = _cfg.alarmClearDelaySeconds;
    doc["clear_delay_s"] = _cfg.alarmClearDelaySeconds;
    doc["zero_distance_mm"] = _cfg.zeroDistanceMm;
    doc["zero_dist_mm"] = _cfg.zeroDistanceMm;
    doc["sensor_mount_height_mm"] = _cfg.zeroDistanceMm;
    doc["rs485_sensor_enabled"] = _cfg.rs485SensorEnabled;
    doc["rs485_enabled"] = _cfg.rs485SensorEnabled;
    doc["switch_sensor_enabled"] = _cfg.switchSensorEnabled;
    doc["switch_enabled"] = _cfg.switchSensorEnabled;
    doc["switch_level_1_mm"] = _cfg.switchLevel1Mm;
    doc["switch_level_2_mm"] = _cfg.switchLevel2Mm;
    doc["mismatch_duration_seconds"] = _cfg.mismatchDurationSeconds;
    doc["sensor_confirmation_wait_sec"] = _cfg.mismatchDurationSeconds;
    doc["sensor_logic_mode"] = sensorLogicMode();
    doc["logic_mode"] = sensorLogicMode();
    doc["sensor_mode"] = strcmp(sensorLogicMode(), "DUAL") == 0 ? "BOTH_ACTIVE"
                        : (strcmp(sensorLogicMode(), "RS485_ONLY") == 0 ? "DYP_ONLY"
                           : sensorLogicMode());
    doc["left_remote_enabled"] = _cfg.leftRemoteEnabled;
    doc["right_remote_enabled"] = _cfg.rightRemoteEnabled;
    doc["daily_reboot_enabled"] = _cfg.dailyRebootEnabled;
    doc["daily_reboot_hour"] = _cfg.dailyRebootHour;
    doc["daily_reboot_minute"] = _cfg.dailyRebootMinute;
    char hhmm[8];
    snprintf(hhmm, sizeof(hhmm), "%02u:%02u", _cfg.dailyRebootHour, _cfg.dailyRebootMinute);
    doc["daily_reboot_time"] = hhmm;
    doc["vmon_cal_factor"] = _cfg.vMonCalFactor;
    doc["left_rtu_slave_id"] = _cfg.leftRtuSlaveId;
    doc["right_rtu_slave_id"] = _cfg.rightRtuSlaveId;
    doc["telemetry_idle_interval_seconds"] = _cfg.telemetryIdleIntervalSeconds;
    doc["config_version"] = _cfg.configVersion;
    doc["current_config_version"] = _cfg.configVersion;
    return serializeJson(doc, out, outSize) > 0;
}

void ConfigManager::loadDefaults() {
    _cfg.alertLevelMm = 200;
    _cfg.dangerLevelMm = 400;
    _cfg.dangerClearLevelMm = 350;
    _cfg.triggerDelaySeconds = 60;
    _cfg.alarmClearDelaySeconds = 300;
    _cfg.zeroDistanceMm = 1200;
    _cfg.rs485SensorEnabled = true;
    _cfg.switchSensorEnabled = true;
    _cfg.switchLevel1Mm = 300;
    _cfg.switchLevel2Mm = 500;
    _cfg.mismatchDurationSeconds = 300;
#if defined(ST485_RTU4CH_WAVE485_MODE)
    _cfg.leftRemoteEnabled = true;
    _cfg.rightRemoteEnabled = true;
#elif defined(GENERIC_REMOTE_RELAY_MODE)
    _cfg.leftRemoteEnabled = false;
    _cfg.rightRemoteEnabled = true;
#else
    _cfg.leftRemoteEnabled = false;
    _cfg.rightRemoteEnabled = false;
#endif
    _cfg.dailyRebootEnabled = true;
    _cfg.dailyRebootHour = 1;
    _cfg.dailyRebootMinute = 0;
    _cfg.vMonCalFactor = 1.0f;
    _cfg.leftRtuSlaveId = RTU_SLAVE_ID_LEFT_BOX;
    _cfg.rightRtuSlaveId = RTU_SLAVE_ID_RIGHT_BOX;
    _cfg.telemetryIdleIntervalSeconds = 180;
    _cfg.configVersion = 1;
    _cfg.schemaVersion = kConfigSchemaMagic;
}

bool ConfigManager::loadFromNvs() {
    Preferences prefs;
    if (!prefs.begin(NVS_NS_MAIN, true)) return false;

    const size_t n = prefs.getBytesLength("cfg");
    if (n == sizeof(MainConfig)) {
        MainConfig loaded{};
        prefs.getBytes("cfg", &loaded, sizeof(loaded));
        prefs.end();
        if (loaded.schemaVersion != kConfigSchemaMagic) return false;
        String reason;
        if (!validate(loaded, reason)) {
            Serial.printf("[CFG] NVS config invalid: %s, using defaults\n", reason.c_str());
            return false;
        }
        _cfg = loaded;
        return true;
    }

    if (n == sizeof(LegacyMainConfig)) {
        LegacyMainConfig legacy{};
        prefs.getBytes("cfg", &legacy, sizeof(legacy));
        prefs.end();
        if (legacy.configVersion != kLegacyConfigMagic) return false;

        loadDefaults();
        _cfg.alertLevelMm = legacy.alertLevelMm;
        _cfg.dangerLevelMm = legacy.dangerLevelMm;
        _cfg.dangerClearLevelMm = legacy.dangerClearLevelMm;
        _cfg.triggerDelaySeconds = legacy.triggerDelaySeconds;
        _cfg.alarmClearDelaySeconds = legacy.alarmClearDelaySeconds;
        _cfg.zeroDistanceMm = legacy.zeroDistanceMm;
        _cfg.rs485SensorEnabled = legacy.rs485SensorEnabled;
        _cfg.switchSensorEnabled = legacy.switchSensorEnabled;
        _cfg.switchLevel1Mm = legacy.switchLevel1Mm;
        _cfg.switchLevel2Mm = legacy.switchLevel2Mm;
        _cfg.mismatchDurationSeconds = legacy.mismatchDurationSeconds;
        _cfg.leftRemoteEnabled = legacy.leftRemoteEnabled;
        _cfg.rightRemoteEnabled = legacy.rightRemoteEnabled;
        _cfg.dailyRebootEnabled = legacy.dailyRebootEnabled;
        _cfg.dailyRebootHour = legacy.dailyRebootHour;
        _cfg.dailyRebootMinute = legacy.dailyRebootMinute;
        _cfg.vMonCalFactor = legacy.vMonCalFactor;
        _cfg.leftRtuSlaveId = legacy.leftRtuSlaveId;
        _cfg.rightRtuSlaveId = legacy.rightRtuSlaveId;
        _cfg.telemetryIdleIntervalSeconds = legacy.telemetryIdleIntervalSeconds;
        _cfg.configVersion = 1;
        _cfg.schemaVersion = kConfigSchemaMagic;

        String reason;
        if (!validate(_cfg, reason)) {
            Serial.printf("[CFG] Legacy config invalid: %s, using defaults\n", reason.c_str());
            loadDefaults();
            return false;
        }
        save(false);
        Serial.println("[CFG] Migrated legacy NVS config to revisioned schema");
        return true;
    }

    prefs.end();
    return false;
}

bool ConfigManager::validate(const MainConfig& c, String& reason) {
    if (c.dangerLevelMm <= c.alertLevelMm) {
        reason = "danger_must_be_greater_than_alert";
        return false;
    }
    if (c.dangerClearLevelMm >= c.dangerLevelMm) {
        reason = "danger_clear_must_be_less_than_danger";
        return false;
    }
    if (c.triggerDelaySeconds < 10) {
        reason = "trigger_delay_must_be_at_least_10_seconds";
        return false;
    }
    if (c.alarmClearDelaySeconds < 30) {
        reason = "alarm_clear_delay_must_be_at_least_30_seconds";
        return false;
    }
    if (c.zeroDistanceMm < 300 || c.zeroDistanceMm > 3000) {
        reason = "sensor_mount_height_must_be_300_to_3000_mm";
        return false;
    }
    if (c.switchLevel1Mm == 0 || c.switchLevel2Mm == 0 || c.switchLevel2Mm <= c.switchLevel1Mm) {
        reason = "switch_levels_invalid";
        return false;
    }
    if (c.switchLevel2Mm > c.zeroDistanceMm) {
        reason = "switch_level_2_must_be_below_sensor_mount_height";
        return false;
    }
    if (c.vMonCalFactor < 0.5f || c.vMonCalFactor > 3.0f) {
        reason = "vmon_cal_factor_must_be_0.5_to_3.0";
        return false;
    }
    if (c.telemetryIdleIntervalSeconds < 30 || c.telemetryIdleIntervalSeconds > 600) {
        reason = "telemetry_idle_interval_must_be_30_to_600_seconds";
        return false;
    }
    if (c.dailyRebootHour > 23 || c.dailyRebootMinute > 59) {
        reason = "daily_reboot_time_invalid";
        return false;
    }
    if (c.mismatchDurationSeconds < 30 || c.mismatchDurationSeconds > 1800) {
        reason = "mismatch_duration_must_be_30_to_1800_seconds";
        return false;
    }
    return true;
}

const char* ConfigManager::sensorLogicMode() const {
    if (_cfg.rs485SensorEnabled && _cfg.switchSensorEnabled) return "DUAL";
    if (_cfg.rs485SensorEnabled) return "RS485_ONLY";
    if (_cfg.switchSensorEnabled) return "SWITCH_ONLY";
    return "NO_SENSOR";
}
