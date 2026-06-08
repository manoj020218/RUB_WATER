#pragma once

#include <Arduino.h>

enum class PumpMode : uint8_t { AUTO = 0, MANUAL_ON, MANUAL_OFF };

struct PumpSnapshot {
    bool     running;
    PumpMode mode;
    uint32_t runtimeMs;
    bool     maxRuntimeReached;
    bool     dryRunStop;
};

class PumpController {
public:
    static PumpController& getInstance();

    void begin();
    void loop();

    void setManualOn();
    void setManualOff();
    void setAutoMode();

    const PumpSnapshot& snapshot() const { return _snap; }

private:
    PumpController() = default;
    PumpSnapshot _snap{};
    PumpMode     _mode = PumpMode::AUTO;
    bool         _running = false;
    uint32_t     _startMs = 0;
    uint32_t     _lowLevelSinceMs = 0;
    bool         _lowLevelTracking = false;

    void startPump();
    void stopPump(const char* reason);
};
