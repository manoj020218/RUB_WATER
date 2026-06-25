#include "alert_action_sheet.h"

#include <ArduinoJson.h>
#include <Preferences.h>

#include "device_profile.h"

namespace {
constexpr uint32_t kActionSheetSchemaMagic = 0xAC710005UL;

bool parseLevel(const String& value, AlertActionLevel& level) {
    String normalized = value;
    normalized.trim();
    normalized.toUpperCase();
    if (normalized == "ORANGE" || normalized == "ALERT") {
        level = AlertActionLevel::ORANGE;
        return true;
    }
    if (normalized == "RED" || normalized == "DANGER") {
        level = AlertActionLevel::RED;
        return true;
    }
    return false;
}

bool actionEffectivelyOff(const AlertRelayAction& action) {
    return !action.enabled || action.mode == AlertRelayMode::OFF;
}

bool isPulseWindowOn(const AlertRelayAction& action) {
    return action.onTimeSec > 0 || action.offTimeSec > 0
        || (action.pulseDurationSec > 0 && action.repeatIntervalSec > 0);
}

uint16_t boundedU16(const JsonVariantConst& value) {
    const int parsed = value.isNull() ? 0 : value.as<int>();
    return (uint16_t)constrain(parsed, 0, 3600);
}
}

AlertActionSheetManager& AlertActionSheetManager::getInstance() {
    static AlertActionSheetManager inst;
    return inst;
}

void AlertActionSheetManager::begin() {
    loadDefaults();
    if (!loadFromNvs()) {
        Serial.println("[ACT] NVS empty or schema mismatch, using default action sheet");
        save(false);
    }
    Serial.printf("[ACT] version=%lu source=%s red_override=%d\n",
                  (unsigned long)_cfg.actionSheetVersion,
                  _cfg.lastSyncSource,
                  _cfg.redAllOffOverride ? 1 : 0);
}

const AlertLevelActionSheet& AlertActionSheetManager::sheetFor(AlertActionLevel level) const {
    return (level == AlertActionLevel::RED) ? _cfg.red : _cfg.orange;
}

bool AlertActionSheetManager::save(bool bumpVersion) {
    Preferences prefs;
    if (!prefs.begin(NVS_NS_ACTION_SHEET, false)) {
        Serial.println("[ACT] NVS open failed");
        return false;
    }
    if (bumpVersion) {
        _cfg.actionSheetVersion = (_cfg.actionSheetVersion == 0) ? 1UL : (_cfg.actionSheetVersion + 1UL);
    } else if (_cfg.actionSheetVersion == 0) {
        _cfg.actionSheetVersion = 1UL;
    }
    _cfg.schemaVersion = kActionSheetSchemaMagic;
    prefs.putBytes("sheet", &_cfg, sizeof(_cfg));
    prefs.end();
    return true;
}

bool AlertActionSheetManager::applyJson(const char* json,
                                        String& reason,
                                        const char* syncSource,
                                        const char* syncAt,
                                        bool bumpVersion,
                                        bool allowRedAllOffOverride) {
    StaticJsonDocument<4096> doc;
    if (deserializeJson(doc, json) != DeserializationError::Ok) {
        reason = "invalid_action_sheet_json";
        return false;
    }

    JsonVariantConst root = doc.as<JsonVariantConst>();
    if (!doc["action_sheet"].isNull()) {
        root = doc["action_sheet"].as<JsonVariantConst>();
    }

    AlertActionSheetConfig next = _cfg;

    if (root["action_sheet_version"].is<int>()) {
        next.actionSheetVersion = root["action_sheet_version"].as<uint32_t>();
    } else if (root["current_action_sheet_version"].is<int>()) {
        next.actionSheetVersion = root["current_action_sheet_version"].as<uint32_t>();
    }

    if (root.containsKey("red_all_off_override")) {
        next.redAllOffOverride = root["red_all_off_override"].as<bool>();
    }
    if (root.containsKey("vendor_super_admin_override")) {
        next.redAllOffOverride = root["vendor_super_admin_override"].as<bool>();
    }

    JsonArrayConst actions = root["actions"].as<JsonArrayConst>();
    if (!actions.isNull()) {
        for (JsonVariantConst item : actions) {
            if (!parseActionObject(item, next, reason)) {
                return false;
            }
        }
    } else {
        const struct {
            const char* key;
            AlertActionLevel level;
        } levelMaps[] = {
            {"orange", AlertActionLevel::ORANGE},
            {"red", AlertActionLevel::RED}
        };
        for (const auto& levelMap : levelMaps) {
            JsonVariantConst levelRoot = root[levelMap.key];
            if (levelRoot.isNull()) continue;
            JsonArrayConst levelActions = levelRoot["actions"].as<JsonArrayConst>();
            if (levelActions.isNull()) {
                levelActions = levelRoot.as<JsonArrayConst>();
            }
            for (JsonVariantConst item : levelActions) {
                StaticJsonDocument<256> normalizedDoc;
                normalizedDoc["alert_level"] = levelStr(levelMap.level);
                normalizedDoc["relay_number"] = item["relay_number"] | item["relay"] | item["index"] | 0;
                normalizedDoc["relay_name"] = item["relay_name"] | "";
                normalizedDoc["enabled"] = item["enabled"] | false;
                normalizedDoc["mode"] = item["mode"] | "OFF";
                normalizedDoc["on_time_sec"] = item["on_time_sec"] | 0;
                normalizedDoc["off_time_sec"] = item["off_time_sec"] | 0;
                normalizedDoc["repeat_interval_sec"] = item["repeat_interval_sec"] | 0;
                normalizedDoc["pulse_duration_sec"] = item["pulse_duration_sec"] | 0;
                if (!parseActionObject(normalizedDoc.as<JsonVariantConst>(), next, reason)) {
                    return false;
                }
            }
        }
    }

    if (!validate(next, reason, allowRedAllOffOverride)) {
        return false;
    }

    _cfg = next;
    writeSyncMetadata(_cfg, syncSource, syncAt);
    if (_cfg.actionSheetVersion == 0) {
        _cfg.actionSheetVersion = 1UL;
    }
    return save(bumpVersion);
}

bool AlertActionSheetManager::buildJson(char* out, size_t outSize) const {
    StaticJsonDocument<3072> doc;
    doc["action_sheet_version"] = _cfg.actionSheetVersion;
    doc["current_action_sheet_version"] = _cfg.actionSheetVersion;
    doc["red_all_off_override"] = _cfg.redAllOffOverride;
    doc["last_sync_source"] = _cfg.lastSyncSource;
    if (_cfg.lastSyncAt[0]) {
        doc["last_sync_at"] = _cfg.lastSyncAt;
    }

    JsonArray actions = doc.createNestedArray("actions");
    const AlertActionLevel levels[] = {AlertActionLevel::ORANGE, AlertActionLevel::RED};
    for (AlertActionLevel level : levels) {
        for (uint8_t relayIndex = 0; relayIndex < 3; relayIndex++) {
            const AlertRelayAction& action = relayFor(_cfg, level, relayIndex);
            JsonObject item = actions.createNestedObject();
            item["alert_level"] = levelStr(level);
            item["relay_number"] = relayIndex + 1;
            item["relay_name"] = relayName(relayIndex);
            item["enabled"] = action.enabled;
            item["mode"] = modeStr(action.mode);
            item["on_time_sec"] = action.onTimeSec;
            item["off_time_sec"] = action.offTimeSec;
            item["repeat_interval_sec"] = action.repeatIntervalSec;
            item["pulse_duration_sec"] = action.pulseDurationSec;
        }
    }

    return serializeJson(doc, out, outSize) > 0;
}

const char* AlertActionSheetManager::levelStr(AlertActionLevel level) {
    return level == AlertActionLevel::RED ? "RED" : "ORANGE";
}

const char* AlertActionSheetManager::relayName(uint8_t relayIndex) {
    switch (relayIndex) {
        case 0: return "Siren";
        case 1: return "Flash";
        case 2: return "Voice Trigger";
        default: return "Unknown";
    }
}

const char* AlertActionSheetManager::modeStr(AlertRelayMode mode) {
    switch (mode) {
        case AlertRelayMode::CONTINUOUS_ON: return "CONTINUOUS_ON";
        case AlertRelayMode::PULSE_REPEAT:  return "PULSE_REPEAT";
        case AlertRelayMode::OFF:
        default:                            return "OFF";
    }
}

AlertRelayMode AlertActionSheetManager::modeFromString(const String& value) {
    String normalized = value;
    normalized.trim();
    normalized.toUpperCase();
    if (normalized == "CONTINUOUS_ON") return AlertRelayMode::CONTINUOUS_ON;
    if (normalized == "PULSE_REPEAT") return AlertRelayMode::PULSE_REPEAT;
    return AlertRelayMode::OFF;
}

void AlertActionSheetManager::loadDefaults() {
    memset(&_cfg, 0, sizeof(_cfg));
    _cfg.schemaVersion = kActionSheetSchemaMagic;
    _cfg.actionSheetVersion = 1UL;
    _cfg.redAllOffOverride = false;
    strncpy(_cfg.lastSyncSource, "FIRMWARE_DEFAULT", sizeof(_cfg.lastSyncSource) - 1);

    _cfg.orange.relays[0] = {true, AlertRelayMode::PULSE_REPEAT, 10, 60, 0, 0};
    _cfg.orange.relays[1] = {true, AlertRelayMode::PULSE_REPEAT, 10, 60, 0, 0};
    _cfg.orange.relays[2] = {true, AlertRelayMode::PULSE_REPEAT, 0, 0, 60, 2};

    _cfg.red.relays[0] = {true, AlertRelayMode::CONTINUOUS_ON, 0, 0, 0, 0};
    _cfg.red.relays[1] = {true, AlertRelayMode::CONTINUOUS_ON, 0, 0, 0, 0};
    _cfg.red.relays[2] = {true, AlertRelayMode::PULSE_REPEAT, 0, 0, 15, 2};
}

bool AlertActionSheetManager::loadFromNvs() {
    Preferences prefs;
    if (!prefs.begin(NVS_NS_ACTION_SHEET, true)) return false;
    const size_t n = prefs.getBytesLength("sheet");
    if (n != sizeof(AlertActionSheetConfig)) {
        prefs.end();
        return false;
    }
    AlertActionSheetConfig loaded{};
    prefs.getBytes("sheet", &loaded, sizeof(loaded));
    prefs.end();
    if (loaded.schemaVersion != kActionSheetSchemaMagic) {
        return false;
    }
    String reason;
    if (!validate(loaded, reason, true)) {
        Serial.printf("[ACT] Stored action sheet invalid: %s\n", reason.c_str());
        return false;
    }
    _cfg = loaded;
    if (_cfg.actionSheetVersion == 0) {
        _cfg.actionSheetVersion = 1UL;
    }
    return true;
}

bool AlertActionSheetManager::validate(const AlertActionSheetConfig& cfg,
                                       String& reason,
                                       bool allowRedAllOffOverride) {
    const AlertActionLevel levels[] = {AlertActionLevel::ORANGE, AlertActionLevel::RED};
    for (AlertActionLevel level : levels) {
        for (uint8_t relayIndex = 0; relayIndex < 3; relayIndex++) {
            const AlertRelayAction& action = relayFor(cfg, level, relayIndex);
            if (!action.enabled || action.mode == AlertRelayMode::OFF) {
                continue;
            }
            if (action.mode == AlertRelayMode::CONTINUOUS_ON) {
                continue;
            }
            if (!isPulseWindowOn(action)) {
                reason = String(levelStr(level)) + "_relay_" + String(relayIndex + 1) + "_pulse_pattern_invalid";
                return false;
            }
            if (action.onTimeSec > 0 || action.offTimeSec > 0) {
                if (action.onTimeSec == 0) {
                    reason = String(levelStr(level)) + "_relay_" + String(relayIndex + 1) + "_on_time_required";
                    return false;
                }
                if (action.offTimeSec == 0) {
                    reason = String(levelStr(level)) + "_relay_" + String(relayIndex + 1) + "_off_time_required";
                    return false;
                }
            } else {
                if (action.pulseDurationSec == 0 || action.repeatIntervalSec == 0) {
                    reason = String(levelStr(level)) + "_relay_" + String(relayIndex + 1) + "_repeat_interval_invalid";
                    return false;
                }
                if (action.repeatIntervalSec <= action.pulseDurationSec) {
                    reason = String(levelStr(level)) + "_relay_" + String(relayIndex + 1) + "_repeat_must_exceed_pulse";
                    return false;
                }
            }
        }
        if (level == AlertActionLevel::RED) {
            const bool allOff = actionEffectivelyOff(cfg.red.relays[0])
                             && actionEffectivelyOff(cfg.red.relays[1])
                             && actionEffectivelyOff(cfg.red.relays[2]);
            if (allOff && !(allowRedAllOffOverride && cfg.redAllOffOverride)) {
                reason = "red_all_relays_off_requires_vendor_super_admin_override";
                return false;
            }
        }
    }
    return true;
}

AlertRelayAction& AlertActionSheetManager::relayFor(AlertActionSheetConfig& cfg,
                                                    AlertActionLevel level,
                                                    uint8_t relayIndex) {
    return (level == AlertActionLevel::RED ? cfg.red : cfg.orange).relays[relayIndex];
}

const AlertRelayAction& AlertActionSheetManager::relayFor(const AlertActionSheetConfig& cfg,
                                                          AlertActionLevel level,
                                                          uint8_t relayIndex) {
    return (level == AlertActionLevel::RED ? cfg.red : cfg.orange).relays[relayIndex];
}

bool AlertActionSheetManager::parseActionObject(const JsonVariantConst& item,
                                                AlertActionSheetConfig& next,
                                                String& reason) {
    AlertActionLevel level = AlertActionLevel::ORANGE;
    if (!parseLevel(item["alert_level"] | item["level"] | "", level)) {
        reason = "invalid_alert_level";
        return false;
    }
    const int relayNumber = item["relay_number"] | item["relay"] | item["index"] | 0;
    if (relayNumber < 1 || relayNumber > 3) {
        reason = "invalid_relay_number";
        return false;
    }
    AlertRelayAction& action = relayFor(next, level, (uint8_t)(relayNumber - 1));
    if (item.containsKey("enabled")) {
        action.enabled = item["enabled"].as<bool>();
    }
    if (item.containsKey("mode")) {
        action.mode = modeFromString(item["mode"].as<String>());
    }
    if (item.containsKey("on_time_sec")) {
        action.onTimeSec = boundedU16(item["on_time_sec"]);
    }
    if (item.containsKey("off_time_sec")) {
        action.offTimeSec = boundedU16(item["off_time_sec"]);
    }
    if (item.containsKey("repeat_interval_sec")) {
        action.repeatIntervalSec = boundedU16(item["repeat_interval_sec"]);
    }
    if (item.containsKey("pulse_duration_sec")) {
        action.pulseDurationSec = boundedU16(item["pulse_duration_sec"]);
    }
    return true;
}

void AlertActionSheetManager::writeSyncMetadata(AlertActionSheetConfig& cfg,
                                                const char* syncSource,
                                                const char* syncAt) {
    if (syncSource && syncSource[0]) {
        strncpy(cfg.lastSyncSource, syncSource, sizeof(cfg.lastSyncSource) - 1);
        cfg.lastSyncSource[sizeof(cfg.lastSyncSource) - 1] = '\0';
    }
    if (syncAt && syncAt[0]) {
        strncpy(cfg.lastSyncAt, syncAt, sizeof(cfg.lastSyncAt) - 1);
        cfg.lastSyncAt[sizeof(cfg.lastSyncAt) - 1] = '\0';
    } else if (!cfg.lastSyncAt[0] && syncSource && syncSource[0]) {
        snprintf(cfg.lastSyncAt, sizeof(cfg.lastSyncAt), "uptime_ms:%lu", (unsigned long)millis());
    }
}
