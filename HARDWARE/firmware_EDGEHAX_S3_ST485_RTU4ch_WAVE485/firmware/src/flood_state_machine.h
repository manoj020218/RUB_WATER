#pragma once

#include <Arduino.h>

enum class FloodState : uint8_t {
    NORMAL = 0,
    ALERT_WAITING_FOR_CONFIRMATION,
    ALERT_CONFIRMED,
    ALERT_SENSOR_MISMATCH,
    DANGER_WAITING_FOR_CONFIRMATION,
    DANGER_CONFIRMED,
    DANGER_WITH_CONFIRMATION_MISMATCH,
    DANGER_WITH_PRIMARY_SENSOR_FAULT,
    CLEAR_PENDING,
    SENSOR_FAULT
};

const char* floodStateStr(FloodState s);
bool isAlertOrDanger(FloodState s);
bool isDanger(FloodState s);

struct FloodStateSnapshot {
    FloodState state;
    FloodState prevState;
    bool       stateChanged;
    uint32_t   stateEnteredMs;
    int32_t    waterLevelMm;
    int32_t    distanceMm;
    bool       sensorValid;
    bool       l1Active;
    bool       l2Active;
    char       note[64];
};

class FloodStateMachine {
public:
    static FloodStateMachine& getInstance();

    void begin();
    void loop();

    const FloodStateSnapshot& snapshot() const { return _snap; }
    bool isDangerOutputRequired() const;
    bool isAlertOutputRequired() const;

private:
    FloodStateMachine() = default;
    FloodStateSnapshot _snap{};
    uint32_t _stateStartMs = 0;

    void transitionTo(FloodState next, const char* note = nullptr);
    void evaluate(int32_t levelMm, bool sensorValid, bool l1, bool l2,
                  uint16_t alertMm, uint16_t dangerMm, uint16_t dangerClearMm,
                  uint32_t trigDelaySec, uint32_t clearDelaySec);
};
