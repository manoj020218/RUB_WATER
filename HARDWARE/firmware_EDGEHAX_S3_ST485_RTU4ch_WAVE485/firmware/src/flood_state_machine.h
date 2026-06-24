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

enum class AlertLevel : uint8_t {
    NORMAL = 0,
    ORANGE,
    DANGER
};

enum class AlertStatus : uint8_t {
    IDLE = 0,
    WAITING_CONFIRMATION,
    CONFIRMED,
    SUSPECTED,
    CONFIRMED_BY_SINGLE_SENSOR,
    DISABLED_MODE
};

enum class AlertSource : uint8_t {
    NONE = 0,
    BOTH_SENSOR,
    DYP_ONLY,
    SWITCH_ONLY,
    NO_SENSOR
};

const char* floodStateStr(FloodState s);
const char* alertLevelStr(AlertLevel level);
const char* alertStatusStr(AlertStatus status);
const char* alertSourceStr(AlertSource source);
bool isAlertOrDanger(FloodState s);
bool isDanger(FloodState s);

struct FloodStateSnapshot {
    FloodState   state;
    FloodState   prevState;
    bool         stateChanged;
    uint32_t     stateEnteredMs;
    int32_t      waterLevelMm;
    int32_t      distanceMm;
    bool         sensorValid;
    bool         sensorDetected;
    bool         l1Active;
    bool         l2Active;
    AlertLevel   alertLevel;
    AlertStatus  alertStatus;
    AlertSource  alertSource;
    AlertLevel   pendingAlertLevel;
    uint32_t     alertSinceMs;
    uint32_t     pendingSinceMs;
    uint16_t     confirmationWaitSec;
    bool         outputsEnabled;
    bool         dypFirst;
    bool         switchFirst;
    char         eventType[64];
    char         note[192];
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
    enum class FirstSensor : uint8_t {
        NONE = 0,
        DYP,
        SWITCH
    };

    struct PendingDecision {
        AlertLevel  level = AlertLevel::NORMAL;
        FirstSensor first = FirstSensor::NONE;
        uint32_t    startedMs = 0;
    };

    FloodStateMachine() = default;

    FloodStateSnapshot _snap{};
    AlertLevel   _activeLevel = AlertLevel::NORMAL;
    AlertStatus  _activeStatus = AlertStatus::IDLE;
    AlertSource  _activeSource = AlertSource::NONE;
    FirstSensor  _activeFirst = FirstSensor::NONE;
    uint32_t     _activeSinceMs = 0;
    PendingDecision _pending{};
    bool         _clearPending = false;
    uint32_t     _clearStartMs = 0;
    AlertLevel   _clearFromLevel = AlertLevel::NORMAL;
    bool         _sensorFaultLatched = false;

    void resetPending();
    void clearActiveDecision();
    void transitionTo(FloodState next, const char* note = nullptr, const char* eventType = nullptr);
    void setActiveDecision(AlertLevel level, AlertStatus status, AlertSource source,
                           FirstSensor firstSensor, const char* note,
                           const char* eventType = nullptr);
    void setPassiveState(FloodState state, AlertStatus status, AlertSource source,
                         const char* note, const char* eventType = nullptr);
    bool updateClearPending(uint32_t nowMs, uint32_t clearDelayMs,
                            bool sensorStillActive, bool noSensorMode);
    bool dualPromoteIfReady(uint32_t nowMs, uint32_t waitMs,
                            bool dypHit, bool switchHit,
                            AlertLevel level);
    void startPending(AlertLevel level, FirstSensor firstSensor, uint32_t nowMs,
                      const char* note, const char* eventType);
    const char* waitingReason(AlertLevel level, FirstSensor firstSensor) const;
    const char* suspectedReason(AlertLevel level, FirstSensor firstSensor) const;
    const char* confirmedReason(AlertLevel level, FirstSensor firstSensor) const;
    const char* waitingEvent(AlertLevel level, FirstSensor firstSensor) const;
    const char* suspectedEvent(AlertLevel level, FirstSensor firstSensor) const;
    const char* confirmedEvent(AlertLevel level, FirstSensor firstSensor) const;
};
