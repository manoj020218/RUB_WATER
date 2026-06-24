#pragma once

#include <Arduino.h>

struct OutputSnapshot {
    bool sirenOn;
    bool flashOn;
    bool voiceFutureOn;
};

class OutputController {
public:
    static OutputController& getInstance();

    void begin();         // init GPIO, all OFF immediately
    void safeOff();       // force everything OFF

    void setAutoOutputs(bool sirenOn, bool flashOn, bool voiceOn);
    void suspendAutoControl(uint32_t durationMs = 900000UL);
    bool autoControlSuspended() const;

    void setSiren(bool on);
    void setFlash(bool on);
    void setVoiceFuture(bool on);

    const OutputSnapshot& snapshot() const { return _snap; }

private:
    OutputController() = default;
    OutputSnapshot _snap{};
    uint32_t _manualHoldoffUntilMs = 0;
    void writeRelay(int pin, bool on);
};
