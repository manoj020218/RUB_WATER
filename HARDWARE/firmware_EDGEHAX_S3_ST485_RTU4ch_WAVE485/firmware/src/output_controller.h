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

    void setSiren(bool on);
    void setFlash(bool on);
    void setVoiceFuture(bool on);

    const OutputSnapshot& snapshot() const { return _snap; }

private:
    OutputController() = default;
    OutputSnapshot _snap{};
    void writeRelay(int pin, bool on);
};
