#pragma once

#include <Arduino.h>

#include "alarm_state_machine.h"
#include "config_manager.h"
#include "network_diagnostics.h"
#include "relay_controller.h"
#include "sensor_rs485.h"
#include "switch_inputs.h"

class TelemetryManager {
public:
    static TelemetryManager& getInstance();

    void begin(const DeviceConfig& config);
    void loop(
        AlarmState state,
        const SensorSnapshot& sensor,
        const SwitchSnapshot& switches,
        const RelaySnapshot& relays,
        const NetworkDiagnostics& diagnostics,
        bool mqttConnected
    );

private:
    TelemetryManager() = default;
    DeviceConfig _config{};
    unsigned long _lastTelemetryMs = 0;
    int32_t _lastWaterLevelMm = 0;

    uint32_t currentIntervalMs(AlarmState state, int32_t waterLevelMm) const;
    const char* stateToString(AlarmState state) const;
};

