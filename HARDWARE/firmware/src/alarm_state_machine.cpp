#include "alarm_state_machine.h"

AlarmStateMachine& AlarmStateMachine::getInstance() {
    static AlarmStateMachine instance;
    return instance;
}

void AlarmStateMachine::begin(const ThresholdConfig& thresholds) {
    _thresholds = thresholds;
    _state = AlarmState::NORMAL;
    _muted = false;
    _alertStartMs = 0;
    _dangerStartMs = 0;
    _clearStartMs = 0;
}

void AlarmStateMachine::setMuted(bool muted) {
    _muted = muted;
    if (!isDangerActive()) {
        _muted = false;
    }
}

void AlarmStateMachine::clearMute() {
    _muted = false;
}

void AlarmStateMachine::update(const SensorSnapshot& sensor, const SwitchSnapshot& switches) {
    const unsigned long now = millis();

    if (sensor.fault) {
        _state = AlarmState::SENSOR_FAULT;
        return;
    }

    const bool alertCondition = sensor.waterLevelMm >= _thresholds.alertLevelMm || switches.switch300Closed;
    const bool dangerCondition = sensor.waterLevelMm >= _thresholds.dangerLevelMm || switches.switch500Closed;
    const bool clearCondition = sensor.waterLevelMm < _thresholds.dangerClearLevelMm && !switches.switch500Closed;

    if (dangerCondition) {
        if (_dangerStartMs == 0) {
            _dangerStartMs = now;
        }
        if (now - _dangerStartMs >= _thresholds.triggerConfirmMs) {
            _state = _muted ? AlarmState::MUTED_DANGER : AlarmState::DANGER;
        } else {
            _state = AlarmState::DANGER_PENDING;
        }
        _clearStartMs = 0;
        return;
    }

    _dangerStartMs = 0;

    if (isDangerActive()) {
        if (clearCondition) {
            if (_clearStartMs == 0) {
                _clearStartMs = now;
            }
            if (now - _clearStartMs >= _thresholds.clearConfirmMs) {
                _muted = false;
                _state = alertCondition ? AlarmState::ALERT : AlarmState::NORMAL;
                _clearStartMs = 0;
            } else {
                _state = AlarmState::CLEAR_PENDING;
            }
        } else {
            _clearStartMs = 0;
        }
        return;
    }

    if (alertCondition) {
        if (_alertStartMs == 0) {
            _alertStartMs = now;
        }
        if (now - _alertStartMs >= _thresholds.triggerConfirmMs) {
            _state = AlarmState::ALERT;
        } else {
            _state = AlarmState::ALERT_PENDING;
        }
    } else {
        _alertStartMs = 0;
        _state = sensor.waterLevelMm > 0 ? AlarmState::WATER_DETECTED : AlarmState::NORMAL;
    }
}

AlarmState AlarmStateMachine::getState() const {
    return _state;
}

bool AlarmStateMachine::isDangerActive() const {
    return _state == AlarmState::DANGER || _state == AlarmState::MUTED_DANGER || _state == AlarmState::CLEAR_PENDING;
}

bool AlarmStateMachine::isAlertActive() const {
    return _state == AlarmState::ALERT || _state == AlarmState::ALERT_PENDING;
}

