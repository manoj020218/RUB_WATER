#pragma once

#include <Arduino.h>

struct DypSnapshot {
    bool     enabled;
    bool     detected;
    bool     valid;
    bool     fault;
    int32_t  distanceMm;
    int32_t  waterLevelMm;
    uint32_t lastValidMs;
};

class DypSensor {
public:
    static DypSensor& getInstance();

    void begin();
    void loop();

    const DypSnapshot& snapshot() const { return _snap; }
    int32_t zeroDistanceMm() const { return _zeroDist; }
    bool setZeroFromCurrentReading(String& reason);
    bool setZeroDistanceMm(int32_t mm, String& reason);

private:
    DypSensor() = default;
    DypSnapshot _snap{};
    int32_t     _zeroDist = 1200;
    bool        _uartReady = false;
    uint32_t    _graceStartMs = 0;
    uint32_t    _lastReadMs = 0;
    uint32_t    _lastLogMs = 0;

    bool readFrame(int32_t& distOut);
    void loadZeroFromNvs();
    void saveZeroToNvs();
};
