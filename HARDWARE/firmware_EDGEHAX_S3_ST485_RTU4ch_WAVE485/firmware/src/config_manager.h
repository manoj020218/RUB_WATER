#pragma once

#include <Arduino.h>

struct MainConfig {
    uint16_t alertLevelMm;
    uint16_t dangerLevelMm;
    uint16_t dangerClearLevelMm;
    uint16_t triggerDelaySeconds;
    uint16_t alarmClearDelaySeconds;
    uint16_t zeroDistanceMm;
    bool     leftRemoteEnabled;
    bool     rightRemoteEnabled;
    bool     dailyRebootEnabled;
    uint8_t  dailyRebootHour;
    uint8_t  dailyRebootMinute;
    float    vMonCalFactor;    // INA219 bus voltage multiplier — default 1.0 (no correction)
    uint8_t  leftRtuSlaveId;   // Modbus slave ID of left ST485 box (default 1)
    uint8_t  rightRtuSlaveId;  // Modbus slave ID of right ST485 box (default 1)
    uint16_t telemetryIdleIntervalSeconds;  // Idle publish interval when no flood (default 180)
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
