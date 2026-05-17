#pragma once

#include <Arduino.h>

struct SensorSnapshot {
    bool valid;
    bool fault;
    int32_t distanceMm;
    int32_t waterLevelMm;
};

class SensorRs485 {
public:
    static SensorRs485& getInstance();
    void begin(int32_t sensorMountHeightMm);
    void loop();
    const SensorSnapshot& getSnapshot() const;

private:
    SensorRs485() = default;
    SensorSnapshot _snapshot{};
    int32_t _mountHeightMm = 1200;
    unsigned long _lastReadMs = 0;
    float _simulatedDistanceMm = 930.0f;
    int8_t _simDirection = 1;
};

