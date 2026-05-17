#pragma once

#include <Arduino.h>

#include "config_manager.h"

struct RelaySnapshot {
    bool siren;
    bool beacon;
    bool voice;
    bool barrier;
    bool spare;
    bool rfEntryActive;
    bool rfExitActive;
};

class RelayController {
public:
    static RelayController& getInstance();

    void begin(const GpioConfig& gpio);
    void setMuted(bool muted);
    void loop(AlarmState state);
    void forceAllOff();
    const RelaySnapshot& getSnapshot() const;

private:
    RelayController() = default;
    GpioConfig _gpio{};
    RelaySnapshot _snapshot{};
    bool _muted = false;
    unsigned long _sirenCycleStartMs = 0;
    unsigned long _voiceCycleStartMs = 0;

    void setRelayPin(int pin, bool on);
};

