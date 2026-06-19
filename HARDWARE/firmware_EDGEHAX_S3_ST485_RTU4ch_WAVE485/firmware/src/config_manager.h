#pragma once

#include <Arduino.h>

struct MainConfig {
    uint16_t alertLevelMm;
    uint16_t dangerLevelMm;
    uint16_t dangerClearLevelMm;
    uint16_t pumpAutoStartLevelMm;
    uint16_t pumpAutoStopLevelMm;
    uint16_t triggerDelaySeconds;
    uint16_t alarmClearDelaySeconds;
    uint16_t pumpLowStopDelaySeconds;
    uint16_t pumpMaxRuntimeMinutes;
    uint16_t zeroDistanceMm;
    bool     leftRemoteEnabled;
    bool     rightRemoteEnabled;
    bool     dailyRebootEnabled;
    uint8_t  dailyRebootHour;
    uint8_t  dailyRebootMinute;
    float    vMonCalFactor;    // INA219 bus voltage multiplier — default 1.0 (no correction)
    uint32_t configVersion;
};

class ConfigManager {
public:
    static ConfigManager& getInstance();

    void begin();
    const MainConfig& get() const;

    bool applyJson(const char* json, String& reason);
    bool setZeroDistance(uint16_t mm, String& reason);
    bool buildJson(char* out, size_t outSize) const;

    bool save();

private:
    ConfigManager() = default;
    MainConfig _cfg{};
    void loadDefaults();
    bool loadFromNvs();
    static bool validate(const MainConfig& c, String& reason);
};
