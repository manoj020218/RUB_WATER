#pragma once

#include <Arduino.h>

#include "alert_action_sheet.h"

struct AlertActionRuntimeSnapshot {
    bool             active        = false;
    AlertActionLevel level         = AlertActionLevel::ORANGE;
    uint32_t         activeSinceMs = 0;
    uint32_t         actionSheetVersion = 0;
    bool             sirenOn       = false;
    bool             flashOn       = false;
    bool             voiceOn       = false;
};

class AlertActionRunner {
public:
    static AlertActionRunner& getInstance();

    void begin(const char* deviceId, const char* hardwareId);
    void loop();

    const AlertActionRuntimeSnapshot& snapshot() const { return _snap; }

private:
    AlertActionRunner() = default;

    char _deviceId[32]{};
    char _hardwareId[32]{};
    AlertActionRuntimeSnapshot _snap{};
    bool _latchedActive = false;
    AlertActionLevel _latchedLevel = AlertActionLevel::ORANGE;

    void resetOutputs();
    void latchLevel(AlertActionLevel level, const char* actionStatus);
    void clearLatchedLevel();
    void applyCurrentOutputs();
    bool computeRelayOutput(const AlertRelayAction& action, uint32_t elapsedMs) const;
    void publishStateEvent(const char* eventType, const char* actionStatus);
};
