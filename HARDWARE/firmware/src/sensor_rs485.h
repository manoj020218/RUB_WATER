#pragma once

#include <Arduino.h>

struct SensorSnapshot {
    bool valid;
    bool fault;
    bool enabled;
    bool detected;   // true once the physical sensor has confirmed its presence
    int32_t distanceMm;
    int32_t waterLevelMm;
    uint32_t lastValidMs;
};

class SensorRs485 {
public:
    static SensorRs485& getInstance();
    void begin(int32_t sensorMountHeightMm, bool enabled);
    void loop();
    void setEnabled(bool enabled);
    void setMountHeightMm(int32_t sensorMountHeightMm);
    const SensorSnapshot& getSnapshot() const;

    bool setZeroFromCurrentReading(String& reason);
    int32_t zeroDistanceMm() const;

private:
    SensorRs485() = default;
    SensorSnapshot _snapshot{};
    int32_t _mountHeightMm = 1200;
    int32_t _zeroDistanceMm = 1200;
    bool _enabled = true;
    bool _detected = false;
    unsigned long _lastReadMs = 0;
    unsigned long _graceStartMs = 0;   // detection grace period start (ms)

    void loadZeroFromNvs();
    void persistZeroToNvs();
};
