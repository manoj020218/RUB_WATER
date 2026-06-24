#include "flood_state_machine.h"

#include <string.h>

#include "config_manager.h"
#include "confirmation_inputs.h"
#include "dyp_sensor.h"

namespace {
bool isAlertLevelActive(AlertLevel level) {
    return level == AlertLevel::ORANGE || level == AlertLevel::DANGER;
}

bool isWaitingState(FloodState state) {
    return state == FloodState::ALERT_WAITING_FOR_CONFIRMATION
        || state == FloodState::DANGER_WAITING_FOR_CONFIRMATION;
}
}

FloodStateMachine& FloodStateMachine::getInstance() {
    static FloodStateMachine inst;
    return inst;
}

const char* floodStateStr(FloodState s) {
    switch (s) {
        case FloodState::NORMAL:                            return "NORMAL";
        case FloodState::ALERT_WAITING_FOR_CONFIRMATION:    return "ALERT_WAITING";
        case FloodState::ALERT_CONFIRMED:                   return "ALERT_CONFIRMED";
        case FloodState::ALERT_SENSOR_MISMATCH:             return "ALERT_MISMATCH";
        case FloodState::DANGER_WAITING_FOR_CONFIRMATION:   return "DANGER_WAITING";
        case FloodState::DANGER_CONFIRMED:                  return "DANGER_CONFIRMED";
        case FloodState::DANGER_WITH_CONFIRMATION_MISMATCH: return "DANGER_CONF_MISMATCH";
        case FloodState::DANGER_WITH_PRIMARY_SENSOR_FAULT:  return "DANGER_SENSOR_FAULT";
        case FloodState::CLEAR_PENDING:                     return "CLEAR_PENDING";
        case FloodState::SENSOR_FAULT:                      return "SENSOR_FAULT";
        default:                                            return "UNKNOWN";
    }
}

const char* alertLevelStr(AlertLevel level) {
    switch (level) {
        case AlertLevel::ORANGE: return "ORANGE";
        case AlertLevel::DANGER: return "DANGER";
        case AlertLevel::NORMAL:
        default:                 return "NORMAL";
    }
}

const char* alertStatusStr(AlertStatus status) {
    switch (status) {
        case AlertStatus::WAITING_CONFIRMATION:   return "WAITING_CONFIRMATION";
        case AlertStatus::CONFIRMED:              return "CONFIRMED";
        case AlertStatus::SUSPECTED:              return "SUSPECTED";
        case AlertStatus::CONFIRMED_BY_SINGLE_SENSOR: return "CONFIRMED_BY_SINGLE_SENSOR";
        case AlertStatus::DISABLED_MODE:          return "DISABLED";
        case AlertStatus::IDLE:
        default:                                  return "IDLE";
    }
}

const char* alertSourceStr(AlertSource source) {
    switch (source) {
        case AlertSource::BOTH_SENSOR: return "BOTH_SENSOR";
        case AlertSource::DYP_ONLY:    return "DYP_ONLY";
        case AlertSource::SWITCH_ONLY: return "SWITCH_ONLY";
        case AlertSource::NO_SENSOR:   return "NO_SENSOR";
        case AlertSource::NONE:
        default:                       return "NONE";
    }
}

bool isAlertOrDanger(FloodState s) {
    return s == FloodState::ALERT_CONFIRMED
        || s == FloodState::ALERT_SENSOR_MISMATCH
        || s == FloodState::DANGER_CONFIRMED
        || s == FloodState::DANGER_WITH_CONFIRMATION_MISMATCH
        || s == FloodState::DANGER_WITH_PRIMARY_SENSOR_FAULT;
}

bool isDanger(FloodState s) {
    return s == FloodState::DANGER_CONFIRMED
        || s == FloodState::DANGER_WITH_CONFIRMATION_MISMATCH
        || s == FloodState::DANGER_WITH_PRIMARY_SENSOR_FAULT;
}

void FloodStateMachine::begin() {
    memset(&_snap, 0, sizeof(_snap));
    _snap.state = FloodState::NORMAL;
    _snap.prevState = FloodState::NORMAL;
    _snap.alertLevel = AlertLevel::NORMAL;
    _snap.alertStatus = AlertStatus::IDLE;
    _snap.alertSource = AlertSource::NONE;
    _snap.pendingAlertLevel = AlertLevel::NORMAL;
    _activeLevel = AlertLevel::NORMAL;
    _activeStatus = AlertStatus::IDLE;
    _activeSource = AlertSource::NONE;
    _activeFirst = FirstSensor::NONE;
    _activeSinceMs = millis();
    _pending = PendingDecision{};
    _clearPending = false;
    _clearStartMs = 0;
    _clearFromLevel = AlertLevel::NORMAL;
    _sensorFaultLatched = false;
    Serial.println("[FSM] Flood state machine started");
}

void FloodStateMachine::resetPending() {
    _pending = PendingDecision{};
    _snap.pendingAlertLevel = AlertLevel::NORMAL;
    _snap.pendingSinceMs = 0;
}

void FloodStateMachine::clearActiveDecision() {
    _activeLevel = AlertLevel::NORMAL;
    _activeStatus = AlertStatus::IDLE;
    _activeSource = AlertSource::NONE;
    _activeFirst = FirstSensor::NONE;
    _activeSinceMs = millis();
}

void FloodStateMachine::transitionTo(FloodState next, const char* note, const char* eventType) {
    const uint32_t now = millis();
    const bool noteChanged = note ? strncmp(_snap.note, note, sizeof(_snap.note) - 1) != 0
                                  : _snap.note[0] != '\0';
    if (_snap.state == next && !noteChanged && (!eventType || eventType[0] == '\0')) {
        return;
    }
    if (_snap.state != next) {
        Serial.printf("[FSM] %s -> %s%s%s\n",
                      floodStateStr(_snap.state), floodStateStr(next),
                      note ? " | " : "", note ? note : "");
        _snap.prevState = _snap.state;
        _snap.state = next;
        _snap.stateChanged = true;
        _snap.stateEnteredMs = now;
    }
    if (note) {
        strncpy(_snap.note, note, sizeof(_snap.note) - 1);
        _snap.note[sizeof(_snap.note) - 1] = '\0';
    } else {
        _snap.note[0] = '\0';
    }
    if (eventType) {
        strncpy(_snap.eventType, eventType, sizeof(_snap.eventType) - 1);
        _snap.eventType[sizeof(_snap.eventType) - 1] = '\0';
    }
}

void FloodStateMachine::setActiveDecision(AlertLevel level, AlertStatus status, AlertSource source,
                                          FirstSensor firstSensor, const char* note,
                                          const char* eventType) {
    if (_activeLevel != level || _activeStatus != status || _activeSource != source) {
        _activeSinceMs = millis();
    }
    _activeLevel = level;
    _activeStatus = status;
    _activeSource = source;
    _activeFirst = firstSensor;

    _snap.alertLevel = level;
    _snap.alertStatus = status;
    _snap.alertSource = source;
    _snap.alertSinceMs = _activeSinceMs;
    _snap.outputsEnabled = (status == AlertStatus::CONFIRMED
                         || status == AlertStatus::SUSPECTED
                         || status == AlertStatus::CONFIRMED_BY_SINGLE_SENSOR)
                        && isAlertLevelActive(level);
    _snap.dypFirst = firstSensor == FirstSensor::DYP;
    _snap.switchFirst = firstSensor == FirstSensor::SWITCH;

    if (level == AlertLevel::DANGER) {
        if (status == AlertStatus::SUSPECTED) {
            transitionTo(firstSensor == FirstSensor::SWITCH
                         ? FloodState::DANGER_WITH_PRIMARY_SENSOR_FAULT
                         : FloodState::DANGER_WITH_CONFIRMATION_MISMATCH,
                         note, eventType);
        } else {
            transitionTo(FloodState::DANGER_CONFIRMED, note, eventType);
        }
    } else if (level == AlertLevel::ORANGE) {
        transitionTo(status == AlertStatus::SUSPECTED
                     ? FloodState::ALERT_SENSOR_MISMATCH
                     : FloodState::ALERT_CONFIRMED,
                     note, eventType);
    } else {
        transitionTo(FloodState::NORMAL, note, eventType);
    }
}

void FloodStateMachine::setPassiveState(FloodState state, AlertStatus status, AlertSource source,
                                        const char* note, const char* eventType) {
    _snap.alertLevel = _activeLevel;
    _snap.alertStatus = status;
    _snap.alertSource = source;
    _snap.alertSinceMs = _activeSinceMs;
    _snap.outputsEnabled = (_activeStatus == AlertStatus::CONFIRMED
                         || _activeStatus == AlertStatus::SUSPECTED
                         || _activeStatus == AlertStatus::CONFIRMED_BY_SINGLE_SENSOR)
                        && isAlertLevelActive(_activeLevel);
    _snap.dypFirst = (_activeFirst == FirstSensor::DYP) || (_pending.first == FirstSensor::DYP);
    _snap.switchFirst = (_activeFirst == FirstSensor::SWITCH) || (_pending.first == FirstSensor::SWITCH);
    transitionTo(state, note, eventType);
}

bool FloodStateMachine::updateClearPending(uint32_t nowMs, uint32_t clearDelayMs,
                                           bool sensorStillActive, bool noSensorMode) {
    if (noSensorMode) {
        _clearPending = false;
        _clearStartMs = 0;
        _clearFromLevel = AlertLevel::NORMAL;
        clearActiveDecision();
        return false;
    }

    if (!_clearPending) {
        _clearPending = true;
        _clearStartMs = nowMs;
        _clearFromLevel = _activeLevel;
        resetPending();
    }

    if (sensorStillActive) {
        _clearPending = false;
        return false;
    }

    if ((nowMs - _clearStartMs) < clearDelayMs) {
        setPassiveState(FloodState::CLEAR_PENDING, AlertStatus::IDLE, _activeSource,
                        "awaiting_clear_delay", nullptr);
        return true;
    }

    const char* eventType = (_clearFromLevel == AlertLevel::DANGER)
        ? "DANGER_AUTO_CLEARED"
        : (_clearFromLevel == AlertLevel::ORANGE ? "ALERT_AUTO_CLEARED" : nullptr);
    _clearPending = false;
    _clearStartMs = 0;
    _clearFromLevel = AlertLevel::NORMAL;
    clearActiveDecision();
    setPassiveState(FloodState::NORMAL, AlertStatus::IDLE, AlertSource::NONE,
                    "cleared", eventType);
    return true;
}

void FloodStateMachine::startPending(AlertLevel level, FirstSensor firstSensor, uint32_t nowMs,
                                     const char* note, const char* eventType) {
    if (_pending.level != level || _pending.first != firstSensor) {
        _pending.level = level;
        _pending.first = firstSensor;
        _pending.startedMs = nowMs;
        _snap.pendingSinceMs = nowMs;
        _snap.pendingAlertLevel = level;
        setPassiveState(level == AlertLevel::DANGER
                        ? FloodState::DANGER_WAITING_FOR_CONFIRMATION
                        : FloodState::ALERT_WAITING_FOR_CONFIRMATION,
                        AlertStatus::WAITING_CONFIRMATION, AlertSource::BOTH_SENSOR,
                        note, eventType);
    } else {
        _snap.pendingSinceMs = _pending.startedMs;
        _snap.pendingAlertLevel = _pending.level;
        setPassiveState(level == AlertLevel::DANGER
                        ? FloodState::DANGER_WAITING_FOR_CONFIRMATION
                        : FloodState::ALERT_WAITING_FOR_CONFIRMATION,
                        AlertStatus::WAITING_CONFIRMATION, AlertSource::BOTH_SENSOR,
                        note, nullptr);
    }
}

bool FloodStateMachine::dualPromoteIfReady(uint32_t nowMs, uint32_t waitMs,
                                           bool dypHit, bool switchHit,
                                           AlertLevel level) {
    const FirstSensor firstSensor = dypHit ? FirstSensor::DYP : FirstSensor::SWITCH;
    if (dypHit && switchHit) {
        const FirstSensor promotedFirst = (_pending.level == level) ? _pending.first : firstSensor;
        resetPending();
        setActiveDecision(level, AlertStatus::CONFIRMED, AlertSource::BOTH_SENSOR,
                          promotedFirst, confirmedReason(level, promotedFirst),
                          confirmedEvent(level, promotedFirst));
        return true;
    }

    startPending(level, firstSensor, nowMs, waitingReason(level, firstSensor),
                 waitingEvent(level, firstSensor));
    if ((nowMs - _pending.startedMs) >= waitMs) {
        setActiveDecision(level, AlertStatus::SUSPECTED, AlertSource::BOTH_SENSOR,
                          firstSensor, suspectedReason(level, firstSensor),
                          suspectedEvent(level, firstSensor));
        resetPending();
        return true;
    }
    return false;
}

const char* FloodStateMachine::waitingReason(AlertLevel level, FirstSensor firstSensor) const {
    if (level == AlertLevel::DANGER) {
        return (firstSensor == FirstSensor::DYP)
            ? "Danger on RS485 US Sensor, waiting for Switch Type Sensor L2 confirmation"
            : "Danger on Switch Type Sensor L2, waiting for RS485 US Sensor confirmation";
    }
    return (firstSensor == FirstSensor::DYP)
        ? "Orange on RS485 US Sensor, waiting for Switch Type Sensor confirmation"
        : "Orange on Switch Type Sensor, waiting for RS485 US Sensor confirmation";
}

const char* FloodStateMachine::suspectedReason(AlertLevel level, FirstSensor firstSensor) const {
    if (level == AlertLevel::DANGER) {
        return (firstSensor == FirstSensor::DYP)
            ? "RS485 US Sensor crossed Danger level but Switch Type Sensor L2 did not confirm within configured time. Possible Switch Sensor fault or obstruction below RS485 US Sensor."
            : "Switch Type Sensor L2 crossed but RS485 US Sensor did not confirm within configured time. Possible RS485 US Sensor fault or obstruction below Switch Type Sensor.";
    }
    return (firstSensor == FirstSensor::DYP)
        ? "RS485 US Sensor crossed Orange level but Switch Type Sensor did not confirm within configured time. Possible Switch Sensor fault or obstruction below RS485 US Sensor."
        : "Switch Type Sensor L1 crossed but RS485 US Sensor did not confirm within configured time. Possible RS485 US Sensor fault or obstruction below Switch Type Sensor.";
}

const char* FloodStateMachine::confirmedReason(AlertLevel level, FirstSensor firstSensor) const {
    if (level == AlertLevel::DANGER) {
        if (firstSensor == FirstSensor::SWITCH) {
            return "Switch Type Sensor L2 confirmed by RS485 US Sensor";
        }
        return "RS485 US Sensor Danger level confirmed by Switch Type Sensor L2";
    }
    if (firstSensor == FirstSensor::SWITCH) {
        return "Switch Type Sensor L1 confirmed by RS485 US Sensor";
    }
    return "RS485 US Sensor Orange level confirmed by Switch Type Sensor";
}

const char* FloodStateMachine::waitingEvent(AlertLevel level, FirstSensor firstSensor) const {
    if (level == AlertLevel::DANGER) {
        return (firstSensor == FirstSensor::DYP)
            ? "DANGER_WAITING_DYP_FIRST"
            : "DANGER_WAITING_SWITCH_FIRST";
    }
    return (firstSensor == FirstSensor::DYP)
        ? "ORANGE_WAITING_DYP_FIRST"
        : "ORANGE_WAITING_SWITCH_FIRST";
}

const char* FloodStateMachine::suspectedEvent(AlertLevel level, FirstSensor firstSensor) const {
    if (level == AlertLevel::DANGER) {
        return (firstSensor == FirstSensor::DYP)
            ? "DANGER_ALERT_UNCONFIRMED_DYP_FIRST"
            : "DANGER_ALERT_UNCONFIRMED_SWITCH_FIRST";
    }
    return (firstSensor == FirstSensor::DYP)
        ? "ORANGE_ALERT_UNCONFIRMED_DYP_FIRST"
        : "ORANGE_ALERT_UNCONFIRMED_SWITCH_FIRST";
}

const char* FloodStateMachine::confirmedEvent(AlertLevel level, FirstSensor firstSensor) const {
    if (level == AlertLevel::DANGER) {
        return (firstSensor == FirstSensor::SWITCH)
            ? "DANGER_ALERT_CONFIRMED_SWITCH_FIRST"
            : "DANGER_ALERT_CONFIRMED_DYP_FIRST";
    }
    return (firstSensor == FirstSensor::SWITCH)
        ? "ORANGE_ALERT_CONFIRMED_SWITCH_FIRST"
        : "ORANGE_ALERT_CONFIRMED_DYP_FIRST";
}

void FloodStateMachine::loop() {
    const auto& cfg = ConfigManager::getInstance().get();
    const auto& dyp = DypSensor::getInstance().snapshot();
    const auto& conf = ConfirmationInputs::getInstance().snapshot();
    const uint32_t nowMs = millis();
    const uint32_t waitMs = (uint32_t)cfg.mismatchDurationSeconds * 1000UL;
    const uint32_t clearMs = (uint32_t)cfg.alarmClearDelaySeconds * 1000UL;

    _snap.stateChanged = false;
    _snap.eventType[0] = '\0';
    _snap.confirmationWaitSec = cfg.mismatchDurationSeconds;
    _snap.distanceMm = dyp.distanceMm;
    _snap.sensorDetected = dyp.detected;
    _snap.sensorValid = dyp.valid;
    _snap.l1Active = conf.level1Active;
    _snap.l2Active = conf.level2Active;

    int32_t effectiveLevel = dyp.valid ? dyp.waterLevelMm : 0;
    if (!cfg.rs485SensorEnabled && cfg.switchSensorEnabled) {
        effectiveLevel = conf.level2Active ? cfg.switchLevel2Mm
                       : conf.level1Active ? cfg.switchLevel1Mm : 0;
    } else if (!cfg.rs485SensorEnabled && !cfg.switchSensorEnabled) {
        effectiveLevel = 0;
    }
    _snap.waterLevelMm = effectiveLevel;

    const bool dualMode = cfg.rs485SensorEnabled && cfg.switchSensorEnabled;
    const bool dypOnlyMode = cfg.rs485SensorEnabled && !cfg.switchSensorEnabled;
    const bool switchOnlyMode = !cfg.rs485SensorEnabled && cfg.switchSensorEnabled;
    const bool noSensorMode = !cfg.rs485SensorEnabled && !cfg.switchSensorEnabled;

    const bool dypOrange = cfg.rs485SensorEnabled && dyp.valid && dyp.waterLevelMm >= cfg.alertLevelMm;
    const bool dypDanger = cfg.rs485SensorEnabled && dyp.valid && dyp.waterLevelMm >= cfg.dangerLevelMm;
    const bool switchOrange = cfg.switchSensorEnabled && (conf.level1Active || conf.level2Active);
    const bool switchDanger = cfg.switchSensorEnabled && conf.level2Active;
    const bool dangerSensorStillActive = dyp.valid && dyp.waterLevelMm >= cfg.dangerClearLevelMm;
    const bool anySensorStillActive = dyp.valid && dyp.waterLevelMm >= cfg.alertLevelMm;
    const bool switchStillActive = conf.level1Active || conf.level2Active;

    if (noSensorMode) {
        const bool noSensorChanged = _snap.alertSource != AlertSource::NO_SENSOR
                                  || _snap.alertStatus != AlertStatus::DISABLED_MODE;
        resetPending();
        _clearPending = false;
        _sensorFaultLatched = false;
        clearActiveDecision();
        _snap.pendingAlertLevel = AlertLevel::NORMAL;
        _snap.pendingSinceMs = 0;
        _snap.alertSinceMs = nowMs;
        _snap.outputsEnabled = false;
        _snap.dypFirst = false;
        _snap.switchFirst = false;
        _snap.alertLevel = AlertLevel::NORMAL;
        _snap.alertStatus = AlertStatus::DISABLED_MODE;
        _snap.alertSource = AlertSource::NO_SENSOR;
        transitionTo(FloodState::NORMAL,
                     "Automatic alert trigger disabled because no sensor is configured.",
                     noSensorChanged ? "NO_SENSOR_MODE_ACTIVE" : nullptr);
        return;
    }

    if (dypOnlyMode) {
        resetPending();
        _sensorFaultLatched = false;
        if (!dyp.valid) {
            clearActiveDecision();
            _snap.pendingAlertLevel = AlertLevel::NORMAL;
            _snap.pendingSinceMs = 0;
            _snap.alertLevel = AlertLevel::NORMAL;
            _snap.alertStatus = AlertStatus::IDLE;
            _snap.alertSource = AlertSource::DYP_ONLY;
            _snap.outputsEnabled = false;
            transitionTo(FloodState::SENSOR_FAULT, "rs485_us_sensor_invalid", "SENSOR_FAULT");
            return;
        }
        if (dypDanger) {
            _clearPending = false;
            setActiveDecision(AlertLevel::DANGER, AlertStatus::CONFIRMED_BY_SINGLE_SENSOR,
                              AlertSource::DYP_ONLY, FirstSensor::DYP,
                              "Danger by RS485 US Sensor only", "ALERT_BY_DYP_ONLY");
            return;
        }
        if (dypOrange) {
            _clearPending = false;
            setActiveDecision(AlertLevel::ORANGE, AlertStatus::CONFIRMED_BY_SINGLE_SENSOR,
                              AlertSource::DYP_ONLY, FirstSensor::DYP,
                              "Orange by RS485 US Sensor only", "ALERT_BY_DYP_ONLY");
            return;
        }
        if (_activeLevel != AlertLevel::NORMAL) {
            if (updateClearPending(nowMs, clearMs, anySensorStillActive, false)) return;
        }
        clearActiveDecision();
        _snap.pendingAlertLevel = AlertLevel::NORMAL;
        _snap.pendingSinceMs = 0;
        _snap.alertLevel = AlertLevel::NORMAL;
        _snap.alertStatus = AlertStatus::IDLE;
        _snap.alertSource = AlertSource::DYP_ONLY;
        _snap.outputsEnabled = false;
        transitionTo(FloodState::NORMAL, "normal_by_rs485_only", nullptr);
        return;
    }

    if (switchOnlyMode) {
        resetPending();
        _sensorFaultLatched = false;
        if (switchDanger) {
            _clearPending = false;
            setActiveDecision(AlertLevel::DANGER, AlertStatus::CONFIRMED_BY_SINGLE_SENSOR,
                              AlertSource::SWITCH_ONLY, FirstSensor::SWITCH,
                              "Danger by Switch Type Sensor L2", "ALERT_BY_SWITCH_ONLY");
            return;
        }
        if (switchOrange) {
            _clearPending = false;
            setActiveDecision(AlertLevel::ORANGE, AlertStatus::CONFIRMED_BY_SINGLE_SENSOR,
                              AlertSource::SWITCH_ONLY, FirstSensor::SWITCH,
                              "Orange by Switch Type Sensor L1", "ALERT_BY_SWITCH_ONLY");
            return;
        }
        if (_activeLevel != AlertLevel::NORMAL) {
            if (updateClearPending(nowMs, clearMs, switchStillActive, false)) return;
        }
        clearActiveDecision();
        _snap.pendingAlertLevel = AlertLevel::NORMAL;
        _snap.pendingSinceMs = 0;
        _snap.alertLevel = AlertLevel::NORMAL;
        _snap.alertStatus = AlertStatus::IDLE;
        _snap.alertSource = AlertSource::SWITCH_ONLY;
        _snap.outputsEnabled = false;
        transitionTo(FloodState::NORMAL, "normal_by_switch_only", nullptr);
        return;
    }

    // Dual-sensor mode
    if (_activeLevel == AlertLevel::DANGER) {
        if (dypDanger && switchDanger && _activeStatus == AlertStatus::SUSPECTED) {
            setActiveDecision(AlertLevel::DANGER, AlertStatus::CONFIRMED, AlertSource::BOTH_SENSOR,
                              _activeFirst == FirstSensor::NONE ? FirstSensor::DYP : _activeFirst,
                              confirmedReason(AlertLevel::DANGER, _activeFirst == FirstSensor::NONE ? FirstSensor::DYP : _activeFirst),
                              confirmedEvent(AlertLevel::DANGER, _activeFirst == FirstSensor::NONE ? FirstSensor::DYP : _activeFirst));
            return;
        }
        if (dangerSensorStillActive || switchDanger) {
            _clearPending = false;
            _snap.pendingAlertLevel = AlertLevel::NORMAL;
            _snap.pendingSinceMs = 0;
            resetPending();
            setActiveDecision(AlertLevel::DANGER, _activeStatus, AlertSource::BOTH_SENSOR,
                              _activeFirst, _snap.note, nullptr);
            return;
        }
        if (updateClearPending(nowMs, clearMs, dangerSensorStillActive || switchDanger, false)) return;
    }

    if (dypDanger || switchDanger) {
        _clearPending = false;
        if (dualPromoteIfReady(nowMs, waitMs, dypDanger, switchDanger, AlertLevel::DANGER)) {
            return;
        }
        return;
    }

    if (_activeLevel == AlertLevel::ORANGE) {
        if (dypOrange && switchOrange && _activeStatus == AlertStatus::SUSPECTED) {
            setActiveDecision(AlertLevel::ORANGE, AlertStatus::CONFIRMED, AlertSource::BOTH_SENSOR,
                              _activeFirst == FirstSensor::NONE ? FirstSensor::DYP : _activeFirst,
                              confirmedReason(AlertLevel::ORANGE, _activeFirst == FirstSensor::NONE ? FirstSensor::DYP : _activeFirst),
                              confirmedEvent(AlertLevel::ORANGE, _activeFirst == FirstSensor::NONE ? FirstSensor::DYP : _activeFirst));
            return;
        }
        if (anySensorStillActive || switchOrange) {
            _clearPending = false;
            resetPending();
            setActiveDecision(AlertLevel::ORANGE, _activeStatus, AlertSource::BOTH_SENSOR,
                              _activeFirst, _snap.note, nullptr);
            return;
        }
        if (updateClearPending(nowMs, clearMs, anySensorStillActive || switchOrange, false)) return;
    }

    if (dypOrange || switchOrange) {
        _clearPending = false;
        if (dualPromoteIfReady(nowMs, waitMs, dypOrange, switchOrange, AlertLevel::ORANGE)) {
            return;
        }
        return;
    }

    resetPending();
    if (_activeLevel != AlertLevel::NORMAL) {
        if (updateClearPending(nowMs, clearMs, false, false)) return;
    }

    clearActiveDecision();
    _snap.alertLevel = AlertLevel::NORMAL;
    _snap.alertStatus = AlertStatus::IDLE;
    _snap.alertSource = AlertSource::BOTH_SENSOR;
    _snap.alertSinceMs = nowMs;
    _snap.outputsEnabled = false;
    _snap.dypFirst = false;
    _snap.switchFirst = false;
    if (!dyp.valid) {
        const bool emitFault = !_sensorFaultLatched;
        _sensorFaultLatched = true;
        transitionTo(FloodState::SENSOR_FAULT, "primary_sensor_lost", emitFault ? "SENSOR_FAULT" : nullptr);
    } else {
        _sensorFaultLatched = false;
        transitionTo(FloodState::NORMAL, "normal_dual_sensor", nullptr);
    }
}

bool FloodStateMachine::isDangerOutputRequired() const {
    return _snap.outputsEnabled && _snap.alertLevel == AlertLevel::DANGER;
}

bool FloodStateMachine::isAlertOutputRequired() const {
    return _snap.outputsEnabled && isAlertLevelActive(_snap.alertLevel);
}
