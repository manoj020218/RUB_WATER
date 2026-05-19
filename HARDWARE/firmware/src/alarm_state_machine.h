#pragma once

#include <Arduino.h>

#include "config_manager.h"
#include "sensor_rs485.h"
#include "switch_inputs.h"

class AlarmStateMachine {
public:
    static AlarmStateMachine& getInstance();

    void begin();
    void setMuted(bool muted);
    void clearMute();
    void update(const FloodGuardRuntimeConfig& runtimeConfig, const SensorSnapshot& sensor, const SwitchSnapshot& switches);

    AlarmState getState() const;
    bool isDangerActive() const;
    bool isAlertActive() const;
    const char* getStatusNote() const;
    const char* getStatusColor() const;
    bool shouldRaiseSwitchFaultEvent() const;
    bool shouldRaiseRs485ObstructionEvent() const;

private:
    AlarmStateMachine() = default;

    AlarmState _state = AlarmState::NORMAL;
    bool _muted = false;
    char _statusNote[220]{};
    char _statusColor[16]{};

    unsigned long _alertStartMs = 0;
    unsigned long _dangerStartMs = 0;
    unsigned long _clearStartMs = 0;
    unsigned long _mismatchStartMs = 0;
    bool _switchFaultEventRaised = false;
    bool _rs485ObstructionEventRaised = false;
    int32_t _lastWaterLevelMm = 0;

    void setState(AlarmState state, const char* note, const char* color);
    bool delaySatisfied(bool condition, unsigned long& markerMs, uint32_t delayMs, unsigned long now);
};
