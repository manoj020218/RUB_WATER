#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>

enum class AlertActionLevel : uint8_t {
    ORANGE = 0,
    RED    = 1
};

enum class AlertRelayMode : uint8_t {
    OFF = 0,
    CONTINUOUS_ON,
    PULSE_REPEAT
};

struct AlertRelayAction {
    bool           enabled;
    AlertRelayMode mode;
    uint16_t       onTimeSec;
    uint16_t       offTimeSec;
    uint16_t       repeatIntervalSec;
    uint16_t       pulseDurationSec;
};

struct AlertLevelActionSheet {
    AlertRelayAction relays[3];
};

struct AlertActionSheetConfig {
    uint32_t schemaVersion        = 0;
    uint32_t actionSheetVersion   = 0;
    bool     redAllOffOverride    = false;
    char     lastSyncSource[24]   = {};
    char     lastSyncAt[32]       = {};
    AlertLevelActionSheet orange{};
    AlertLevelActionSheet red{};
};

class AlertActionSheetManager {
public:
    static AlertActionSheetManager& getInstance();

    void begin();

    const AlertActionSheetConfig& get() const { return _cfg; }
    const AlertLevelActionSheet& sheetFor(AlertActionLevel level) const;

    uint32_t version() const { return _cfg.actionSheetVersion; }
    const char* lastSyncSource() const { return _cfg.lastSyncSource; }
    const char* lastSyncAt() const { return _cfg.lastSyncAt; }
    bool redAllOffOverride() const { return _cfg.redAllOffOverride; }

    bool applyJson(const char* json,
                   String& reason,
                   const char* syncSource = nullptr,
                   const char* syncAt = nullptr,
                   bool bumpVersion = false,
                   bool allowRedAllOffOverride = false);
    bool buildJson(char* out, size_t outSize) const;
    bool save(bool bumpVersion = false);

    static const char* levelStr(AlertActionLevel level);
    static const char* relayName(uint8_t relayIndex);
    static const char* modeStr(AlertRelayMode mode);
    static AlertRelayMode modeFromString(const String& value);

private:
    AlertActionSheetManager() = default;

    AlertActionSheetConfig _cfg{};

    void loadDefaults();
    bool loadFromNvs();

    static bool validate(const AlertActionSheetConfig& cfg,
                         String& reason,
                         bool allowRedAllOffOverride);
    static AlertRelayAction& relayFor(AlertActionSheetConfig& cfg, AlertActionLevel level, uint8_t relayIndex);
    static const AlertRelayAction& relayFor(const AlertActionSheetConfig& cfg, AlertActionLevel level, uint8_t relayIndex);
    static bool parseActionObject(const JsonVariantConst& item, AlertActionSheetConfig& next, String& reason);
    static void writeSyncMetadata(AlertActionSheetConfig& cfg, const char* syncSource, const char* syncAt);
};
