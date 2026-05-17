#pragma once

#include <Arduino.h>

#include "config_manager.h"
#include "sensor_rs485.h"
#include "switch_inputs.h"

class AlarmStateMachine {
public:
    static AlarmStateMachine& getInstance();

    void begin(const ThresholdConfig& thresholds);
    void setMuted(bool muted);
    void clearMute();
    void update(const SensorSnapshot& sensor, const SwitchSnapshot& switches);

    AlarmState getState() const;
    bool isDangerActive() const;
    bool isAlertActive() const;

private:
    AlarmStateMachine() = default;

    ThresholdConfig _thresholds{};
    AlarmState _state = AlarmState::NORMAL;
    bool _muted = false;

    unsigned long _alertStartMs = 0;
    unsigned long _dangerStartMs = 0;
    unsigned long _clearStartMs = 0;
};

