#pragma once

#include <Arduino.h>

#include "alarm_state_machine.h"
#include "sensor_rs485.h"
#include "switch_inputs.h"

class LocalConfigServer {
public:
    static LocalConfigServer& getInstance();

    void begin();
    void loop(
        AlarmState state,
        const SensorSnapshot& sensor,
        const SwitchSnapshot& switches,
        bool mqttConnected
    );

private:
    LocalConfigServer() = default;
    bool _started = false;
    AlarmState _state = AlarmState::NORMAL;
    SensorSnapshot _sensor{};
    SwitchSnapshot _switches{};
    bool _mqttConnected = false;
    unsigned long _lastStatusMs = 0;

    void ensureServerStarted();
    bool isAuthorized();
    String statusToString(AlarmState state) const;
};
