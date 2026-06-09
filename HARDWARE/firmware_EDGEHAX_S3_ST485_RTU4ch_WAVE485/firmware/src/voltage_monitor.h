#pragma once

#include <Arduino.h>

struct VoltageSnapshot {
    float voltage;       // bus voltage in V (battery terminal)
    float currentMa;     // load current in mA (positive = discharging)
    float powerMw;       // power in mW
    bool  ready;         // INA219 initialised successfully
    bool  lowBattery;    // voltage < 11.5 V
    bool  criticalBattery; // voltage < 10.5 V
};

class VoltageMonitor {
public:
    static VoltageMonitor& getInstance();

    void begin();
    void loop();

    const VoltageSnapshot& snapshot() const { return _snap; }

private:
    VoltageMonitor() = default;
    VoltageSnapshot _snap{};
    uint32_t _lastReadMs = 0;
};
