#include "config_manager.h"

#include <ArduinoJson.h>
#include <Preferences.h>

#include "device_profile.h"

namespace {
constexpr uint32_t kConfigMagic = 0xFEED0004UL;  // bumped: added vMonCalFactor
}

ConfigManager& ConfigManager::getInstance() {
    static ConfigManager inst;
    return inst;
}

void ConfigManager::begin() {
    loadDefaults();
    if (!loadFromNvs()) {
        Serial.println("[CFG] NVS empty or version mismatch — using defaults");
        save();
    }
#ifdef DUMMY_DYP_MM
    _cfg.leftRemoteEnabled  = false;
    _cfg.rightRemoteEnabled = true;   // right bus GPIO38/39, auto-DE module
    Serial.println("[CFG] DEV: rightRemoteEnabled forced true (GPIO38/39 auto-DE)");
#endif
#ifdef ST485_RTU4CH_WAVE485_MODE
    _cfg.leftRemoteEnabled  = true;   // left bus:  GPIO15/2, Waveshare + ST485-4CH
    _cfg.rightRemoteEnabled = true;   // right bus: GPIO38/39, Waveshare + ST485-4CH
    Serial.println("[CFG] ST485: both left+right RTU buses forced enabled");
#endif
#ifdef GENERIC_REMOTE_RELAY_MODE
    if (!_cfg.leftRemoteEnabled && !_cfg.rightRemoteEnabled) {
        _cfg.rightRemoteEnabled = true;
        Serial.println("[CFG] GENERIC relay backup: default rightRemoteEnabled=true");
    }
#endif
    Serial.printf("[CFG] alert=%d danger=%d clear=%d pumpStart=%d pumpStop=%d "
                  "trigDelay=%d clearDelay=%d zero=%d\n",
                  _cfg.alertLevelMm, _cfg.dangerLevelMm, _cfg.dangerClearLevelMm,
                  _cfg.pumpAutoStartLevelMm, _cfg.pumpAutoStopLevelMm,
                  _cfg.triggerDelaySeconds, _cfg.alarmClearDelaySeconds,
                  _cfg.zeroDistanceMm);
}

const MainConfig& ConfigManager::get() const { return _cfg; }

bool ConfigManager::save() {
    Preferences prefs;
    if (!prefs.begin(NVS_NS_MAIN, false)) {
        Serial.println("[CFG] NVS open failed");
        return false;
    }
    _cfg.configVersion = kConfigMagic;
    prefs.putBytes("cfg", &_cfg, sizeof(_cfg));
    prefs.end();
    return true;
}

bool ConfigManager::applyJson(const char* json, String& reason) {
    StaticJsonDocument<512> doc;
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
    OPT_U16(pumpAutoStartLevelMm,   "pump_auto_start_level_mm")
    OPT_U16(pumpAutoStopLevelMm,    "pump_auto_stop_level_mm")
    OPT_U16(triggerDelaySeconds,    "trigger_delay_seconds")
    OPT_U16(alarmClearDelaySeconds, "alarm_clear_delay_seconds")
    OPT_U16(pumpLowStopDelaySeconds,"pump_low_level_stop_delay_seconds")
    OPT_U16(pumpMaxRuntimeMinutes,  "pump_max_runtime_minutes")
    // battery_adc_divider_ratio / battery_adc_calibration_factor removed — INA219 used
    OPT_BOOL(leftRemoteEnabled,     "left_remote_enabled")
    OPT_BOOL(rightRemoteEnabled,    "right_remote_enabled")
    OPT_BOOL(dailyRebootEnabled,    "daily_reboot_enabled")
    OPT_U8(dailyRebootHour,         "daily_reboot_hour")
    OPT_U8(dailyRebootMinute,       "daily_reboot_minute")
    if (doc.containsKey("vmon_cal_factor"))
        next.vMonCalFactor = doc["vmon_cal_factor"].as<float>();

#undef OPT_U16
#undef OPT_BOOL
#undef OPT_U8

    if (!validate(next, reason)) return false;
    _cfg = next;
#ifdef DUMMY_DYP_MM
    _cfg.leftRemoteEnabled  = false;
    _cfg.rightRemoteEnabled = true;
#endif
    save();
    return true;
}

bool ConfigManager::setZeroDistance(uint16_t mm, String& reason) {
    if (mm < 100 || mm > 2500) {
        reason = "zero_distance_out_of_range";
        return false;
    }
    _cfg.zeroDistanceMm = mm;
    save();
    return true;
}

bool ConfigManager::buildJson(char* out, size_t outSize) const {
    StaticJsonDocument<512> doc;
    doc["alert_level_mm"]                    = _cfg.alertLevelMm;
    doc["danger_level_mm"]                   = _cfg.dangerLevelMm;
    doc["danger_clear_level_mm"]             = _cfg.dangerClearLevelMm;
    doc["pump_auto_start_level_mm"]          = _cfg.pumpAutoStartLevelMm;
    doc["pump_auto_stop_level_mm"]           = _cfg.pumpAutoStopLevelMm;
    doc["trigger_delay_seconds"]             = _cfg.triggerDelaySeconds;
    doc["alarm_clear_delay_seconds"]         = _cfg.alarmClearDelaySeconds;
    doc["pump_low_level_stop_delay_seconds"] = _cfg.pumpLowStopDelaySeconds;
    doc["pump_max_runtime_minutes"]          = _cfg.pumpMaxRuntimeMinutes;
    doc["zero_distance_mm"]                  = _cfg.zeroDistanceMm;
    doc["left_remote_enabled"]               = _cfg.leftRemoteEnabled;
    doc["right_remote_enabled"]              = _cfg.rightRemoteEnabled;
    doc["daily_reboot_enabled"]              = _cfg.dailyRebootEnabled;
    doc["daily_reboot_hour"]                 = _cfg.dailyRebootHour;
    doc["daily_reboot_minute"]               = _cfg.dailyRebootMinute;
    doc["vmon_cal_factor"]                   = _cfg.vMonCalFactor;
    return serializeJson(doc, out, outSize) > 0;
}

void ConfigManager::loadDefaults() {
    _cfg.alertLevelMm            = 200;
    _cfg.dangerLevelMm           = 400;
    _cfg.dangerClearLevelMm      = 350;
    _cfg.pumpAutoStartLevelMm    = 200;
    _cfg.pumpAutoStopLevelMm     = 50;
    _cfg.triggerDelaySeconds     = 60;
    _cfg.alarmClearDelaySeconds  = 300;
    _cfg.pumpLowStopDelaySeconds = 30;
    _cfg.pumpMaxRuntimeMinutes   = 30;
    _cfg.zeroDistanceMm          = 1200;
#if defined(ST485_RTU4CH_WAVE485_MODE)
    _cfg.leftRemoteEnabled       = true;   // both buses active in ST485 mode
    _cfg.rightRemoteEnabled      = true;
#elif defined(GENERIC_REMOTE_RELAY_MODE)
    _cfg.leftRemoteEnabled       = false;
    _cfg.rightRemoteEnabled      = true;
#else
    _cfg.leftRemoteEnabled       = false;
    _cfg.rightRemoteEnabled      = false;
#endif
    _cfg.dailyRebootEnabled      = true;
    _cfg.dailyRebootHour         = 3;
    _cfg.dailyRebootMinute       = 30;
    _cfg.vMonCalFactor           = 1.0f;
    _cfg.configVersion           = kConfigMagic;
}

bool ConfigManager::loadFromNvs() {
    Preferences prefs;
    if (!prefs.begin(NVS_NS_MAIN, true)) return false;
    MainConfig loaded{};
    const size_t n = prefs.getBytes("cfg", &loaded, sizeof(loaded));
    prefs.end();
    if (n != sizeof(loaded) || loaded.configVersion != kConfigMagic) return false;
    String reason;
    if (!validate(loaded, reason)) {
        Serial.printf("[CFG] NVS config invalid: %s — using defaults\n", reason.c_str());
        return false;
    }
    _cfg = loaded;
    return true;
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
    if (c.pumpAutoStopLevelMm >= c.pumpAutoStartLevelMm) {
        reason = "pump_stop_must_be_less_than_pump_start";
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
    if (c.vMonCalFactor < 0.5f || c.vMonCalFactor > 3.0f) {
        reason = "vmon_cal_factor_must_be_0.5_to_3.0";
        return false;
    }
    return true;
}
