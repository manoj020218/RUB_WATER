#include "alarm_state_machine.h"

#include <cstdio>
#include <cstring>

AlarmStateMachine& AlarmStateMachine::getInstance() {
    static AlarmStateMachine instance;
    return instance;
}

void AlarmStateMachine::begin() {
    _state = AlarmState::NORMAL;
    _muted = false;
    _alertStartMs = 0;
    _dangerStartMs = 0;
    _clearStartMs = 0;
    _mismatchStartMs = 0;
    _switchFaultEventRaised = false;
    _rs485ObstructionEventRaised = false;
    _lastWaterLevelMm = 0;
    setState(AlarmState::NORMAL, "System normal.", "NORMAL");
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

void AlarmStateMachine::update(
    const FloodGuardRuntimeConfig& runtimeConfig,
    const SensorSnapshot& sensor,
    const SwitchSnapshot& switches
) {
    const unsigned long now = millis();
    const uint32_t triggerDelayMs = static_cast<uint32_t>(runtimeConfig.triggerDelaySeconds) * 1000UL;
    const uint32_t clearDelayMs = static_cast<uint32_t>(runtimeConfig.clearDelaySeconds) * 1000UL;
    const uint32_t mismatchDelayMs = static_cast<uint32_t>(runtimeConfig.mismatchDurationSeconds) * 1000UL;

    const bool rs485Enabled = runtimeConfig.rs485SensorEnabled;
    const bool switchEnabled = runtimeConfig.switchSensorEnabled;
    const bool switchL1 = switchEnabled && switches.switch300Closed;
    const bool switchL2 = switchEnabled && switches.switch500Closed;
    const bool rs485Fault = rs485Enabled && (!sensor.enabled || sensor.fault || !sensor.valid);
    const bool rs485Valid = rs485Enabled && !rs485Fault;

    const int32_t waterLevel = sensor.waterLevelMm;
    const bool alertCross = rs485Valid && waterLevel >= runtimeConfig.alertLevelMm;
    const bool dangerCross = rs485Valid && waterLevel >= runtimeConfig.dangerLevelMm;
    const bool clearByRs485 = rs485Valid && waterLevel < runtimeConfig.clearLevelMm;

    const bool risingFast = (waterLevel - _lastWaterLevelMm) >= 60;
    const bool unstableHigh = (waterLevel >= static_cast<int32_t>(runtimeConfig.dangerLevelMm)) &&
        (sensor.valid && sensor.lastValidMs > 0) &&
        (static_cast<int32_t>(abs(waterLevel - _lastWaterLevelMm)) >= 30);
    _lastWaterLevelMm = waterLevel;

    if (!rs485Enabled && !switchEnabled) {
        setState(AlarmState::SENSOR_FAULT, "At least one sensor must be enabled.", "FAULT");
        return;
    }

    const bool dangerStateNow = isDangerActive();
    if (dangerStateNow) {
        bool clearCondition = false;
        if (rs485Enabled && switchEnabled) {
            clearCondition = clearByRs485 && !switchL1 && !switchL2;
        } else if (rs485Enabled) {
            clearCondition = clearByRs485;
        } else {
            clearCondition = !switchL1 && !switchL2;
        }

        if (delaySatisfied(clearCondition, _clearStartMs, clearDelayMs, now)) {
            _muted = false;
            setState(AlarmState::NORMAL, "Water level normal after clear delay.", "NORMAL");
        } else if (clearCondition) {
            setState(AlarmState::CLEAR_PENDING, "Clear condition active. Waiting clear delay.", "NORMAL");
        }
        if (clearCondition) {
            return;
        }
        _clearStartMs = 0;
    }

    if (rs485Enabled && !switchEnabled) {
        if (rs485Fault) {
            setState(AlarmState::SENSOR_FAULT, "RS485 water level sensor not sending valid data.", "FAULT");
            return;
        }

        if (dangerCross) {
            if (delaySatisfied(true, _dangerStartMs, triggerDelayMs, now)) {
                setState(AlarmState::DANGER_CONFIRMED, "Danger triggered by RS485 water level sensor.", "DANGER");
            } else {
                setState(AlarmState::DANGER_PENDING, "Danger threshold crossed. Waiting trigger delay.", "DANGER");
            }
            return;
        }
        _dangerStartMs = 0;

        if (alertCross) {
            if (delaySatisfied(true, _alertStartMs, triggerDelayMs, now)) {
                setState(AlarmState::ALERT_ORANGE, "Alert triggered by RS485 water level sensor.", "ORANGE");
            } else {
                setState(AlarmState::ALERT_PENDING_VERIFICATION, "Alert threshold crossed. Waiting trigger delay.", "ORANGE");
            }
            return;
        }
        _alertStartMs = 0;
        setState(AlarmState::NORMAL, "Water level below alert threshold.", "NORMAL");
        return;
    }

    if (!rs485Enabled && switchEnabled) {
        if (switchL2) {
            if (delaySatisfied(true, _dangerStartMs, triggerDelayMs, now)) {
                setState(AlarmState::DANGER_CONFIRMED, "Danger triggered by Level 2 switch sensor.", "DANGER");
            } else {
                setState(AlarmState::DANGER_PENDING, "Level 2 switch closed. Waiting trigger delay.", "DANGER");
            }
            return;
        }
        _dangerStartMs = 0;

        if (switchL1) {
            if (delaySatisfied(true, _alertStartMs, triggerDelayMs, now)) {
                setState(AlarmState::ALERT_ORANGE, "Alert triggered by Level 1 switch sensor.", "ORANGE");
            } else {
                setState(AlarmState::ALERT_PENDING_VERIFICATION, "Level 1 switch closed. Waiting trigger delay.", "ORANGE");
            }
            return;
        }
        _alertStartMs = 0;
        setState(AlarmState::NORMAL, "Switch inputs normal.", "NORMAL");
        return;
    }

    // Dual-sensor mode (both enabled).
    if (rs485Fault) {
        if (switchL2) {
            if (delaySatisfied(true, _dangerStartMs, triggerDelayMs, now)) {
                setState(
                    AlarmState::DANGER_WITH_RS485_FAULT,
                    "Level 2 switch triggered but RS485 sensor is not sending data.",
                    "DANGER"
                );
            } else {
                setState(AlarmState::DANGER_PENDING, "Level 2 switch closed. Waiting trigger delay.", "DANGER");
            }
            return;
        }
        _dangerStartMs = 0;

        if (switchL1) {
            if (delaySatisfied(true, _alertStartMs, triggerDelayMs, now)) {
                setState(
                    AlarmState::ALERT_WITH_RS485_FAULT,
                    "Level 1 switch triggered but RS485 sensor is not sending data.",
                    "ORANGE"
                );
            } else {
                setState(AlarmState::ALERT_PENDING_VERIFICATION, "Level 1 switch closed. Waiting trigger delay.", "ORANGE");
            }
            return;
        }
        _alertStartMs = 0;
        setState(AlarmState::SENSOR_FAULT, "RS485 sensor fault in dual-sensor mode.", "FAULT");
        return;
    }

    if (dangerCross || switchL2) {
        const bool verified = dangerCross && switchL2;
        const bool mismatch = dangerCross && !switchL2;
        if (delaySatisfied(true, _dangerStartMs, triggerDelayMs, now)) {
            if (verified) {
                setState(AlarmState::DANGER_CONFIRMED, "Danger confirmed by RS485 and Level 2 switch.", "DANGER");
                _mismatchStartMs = 0;
                _switchFaultEventRaised = false;
            } else {
                setState(
                    AlarmState::DANGER_WITH_SENSOR_MISMATCH,
                    "RS485 crossed danger level but Level 2 switch did not verify.",
                    "DANGER"
                );

                if (_mismatchStartMs == 0) {
                    _mismatchStartMs = now;
                }
                if (!_switchFaultEventRaised && (now - _mismatchStartMs >= mismatchDelayMs)) {
                    _switchFaultEventRaised = true;
                }
            }
        } else {
            setState(AlarmState::DANGER_PENDING, "Danger condition active. Waiting trigger delay.", "DANGER");
        }

        if (mismatch && unstableHigh && risingFast) {
            _rs485ObstructionEventRaised = true;
        }
        return;
    }
    _dangerStartMs = 0;
    _mismatchStartMs = 0;
    _switchFaultEventRaised = false;

    if (alertCross || switchL1) {
        const bool verifiedAlert = alertCross && switchL1;
        const bool mismatchAlert = switchL1 && !alertCross;

        if (delaySatisfied(true, _alertStartMs, triggerDelayMs, now)) {
            if (verifiedAlert) {
                setState(AlarmState::ALERT_ORANGE_CONFIRMED, "Alert confirmed by RS485 and Level 1 switch.", "ORANGE");
            } else if (mismatchAlert) {
                setState(
                    AlarmState::ALERT_SENSOR_MISMATCH,
                    "Level 1 switch triggered but RS485 level is below alert threshold.",
                    "ORANGE"
                );
            } else {
                setState(
                    AlarmState::ALERT_PENDING_VERIFICATION,
                    "RS485 crossed alert threshold. Waiting for Level 1 switch verification.",
                    "ORANGE"
                );
            }
        } else {
            setState(AlarmState::ALERT_PENDING_VERIFICATION, "Alert condition active. Waiting trigger delay.", "ORANGE");
        }
        return;
    }

    _alertStartMs = 0;
    setState(AlarmState::NORMAL, "Water level below alert threshold.", "NORMAL");
}

AlarmState AlarmStateMachine::getState() const {
    return _state;
}

bool AlarmStateMachine::isDangerActive() const {
    return _state == AlarmState::DANGER_CONFIRMED ||
        _state == AlarmState::DANGER_WITH_SENSOR_MISMATCH ||
        _state == AlarmState::DANGER_WITH_RS485_FAULT ||
        _state == AlarmState::DANGER_PENDING ||
        _state == AlarmState::CLEAR_PENDING;
}

bool AlarmStateMachine::isAlertActive() const {
    return _state == AlarmState::ALERT_PENDING_VERIFICATION ||
        _state == AlarmState::ALERT_ORANGE ||
        _state == AlarmState::ALERT_ORANGE_CONFIRMED ||
        _state == AlarmState::ALERT_SENSOR_MISMATCH ||
        _state == AlarmState::ALERT_WITH_RS485_FAULT;
}

const char* AlarmStateMachine::getStatusNote() const {
    return _statusNote;
}

const char* AlarmStateMachine::getStatusColor() const {
    return _statusColor;
}

bool AlarmStateMachine::shouldRaiseSwitchFaultEvent() const {
    return _switchFaultEventRaised;
}

bool AlarmStateMachine::shouldRaiseRs485ObstructionEvent() const {
    return _rs485ObstructionEventRaised;
}

void AlarmStateMachine::setState(AlarmState state, const char* note, const char* color) {
    _state = state;
    std::snprintf(_statusNote, sizeof(_statusNote), "%s", note ? note : "");
    std::snprintf(_statusColor, sizeof(_statusColor), "%s", color ? color : "NORMAL");
}

bool AlarmStateMachine::delaySatisfied(bool condition, unsigned long& markerMs, uint32_t delayMs, unsigned long now) {
    if (!condition) {
        markerMs = 0;
        return false;
    }
    if (markerMs == 0) {
        markerMs = now;
        return false;
    }
    return (now - markerMs) >= delayMs;
}
