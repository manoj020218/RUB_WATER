#pragma once

#include <Arduino.h>

struct VoltageSnapshot {
    float    voltage;
    uint16_t adcRaw;
    bool     adcReady;
    bool     lowBattery;
    bool     criticalBattery;
};

class VoltageMonitor {
public:
    static VoltageMonitor& getInstance();

    void begin();
    void loop();

    const VoltageSnapshot& snapshot() const { return _snap; }
    float dividerRatio()     const { return _divider; }
    float calibrationFactor() const { return _calFactor; }

    void setCalibration(float divider, float calFactor);

private:
    VoltageMonitor() = default;
    VoltageSnapshot _snap{};
    float _divider   = 5.0f;
    float _calFactor = 1.0f;
    uint32_t _lastReadMs = 0;
};
