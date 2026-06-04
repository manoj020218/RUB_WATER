#include "flood_state_machine.h"

#include "config_manager.h"
#include "confirmation_inputs.h"
#include "dyp_sensor.h"

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

bool isAlertOrDanger(FloodState s) {
    return s == FloodState::ALERT_CONFIRMED
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
    _snap.state         = FloodState::NORMAL;
    _snap.prevState     = FloodState::NORMAL;
    _snap.stateChanged  = false;
    _stateStartMs       = millis();
    Serial.println("[FSM] Flood state machine started");
}

void FloodStateMachine::loop() {
    const auto& cfg    = ConfigManager::getInstance().get();
    const auto& dyp    = DypSensor::getInstance().snapshot();
    const auto& conf   = ConfirmationInputs::getInstance().snapshot();

    _snap.stateChanged  = false;
    _snap.sensorValid   = dyp.valid;
    _snap.distanceMm    = dyp.distanceMm;
    _snap.waterLevelMm  = dyp.waterLevelMm;
    _snap.l1Active      = conf.level1Active;
    _snap.l2Active      = conf.level2Active;

    evaluate(dyp.waterLevelMm, dyp.valid, conf.level1Active, conf.level2Active,
             cfg.alertLevelMm, cfg.dangerLevelMm, cfg.dangerClearLevelMm,
             cfg.triggerDelaySeconds, cfg.alarmClearDelaySeconds);
}

bool FloodStateMachine::isDangerOutputRequired() const {
    return isDanger(_snap.state);
}

bool FloodStateMachine::isAlertOutputRequired() const {
    return isAlertOrDanger(_snap.state);
}

void FloodStateMachine::transitionTo(FloodState next, const char* note) {
    if (_snap.state == next) return;
    Serial.printf("[FSM] %s -> %s%s%s\n",
                  floodStateStr(_snap.state), floodStateStr(next),
                  note ? " | " : "", note ? note : "");
    _snap.prevState    = _snap.state;
    _snap.state        = next;
    _snap.stateChanged = true;
    _snap.stateEnteredMs = millis();
    _stateStartMs      = millis();
    if (note) strncpy(_snap.note, note, sizeof(_snap.note) - 1);
    else _snap.note[0] = '\0';
}

void FloodStateMachine::evaluate(
        int32_t levelMm, bool sensorValid, bool l1, bool l2,
        uint16_t alertMm, uint16_t dangerMm, uint16_t dangerClearMm,
        uint32_t trigDelaySec, uint32_t clearDelaySec)
{
    const uint32_t now        = millis();
    const uint32_t inStateMs  = now - _stateStartMs;
    const uint32_t trigMs     = (uint32_t)trigDelaySec * 1000UL;
    const uint32_t clearMs    = (uint32_t)clearDelaySec * 1000UL;

    switch (_snap.state) {

    case FloodState::NORMAL:
        if (!sensorValid) {
            transitionTo(FloodState::SENSOR_FAULT, "primary_sensor_lost");
        } else if (levelMm >= dangerMm) {
            if (l2) transitionTo(FloodState::DANGER_WAITING_FOR_CONFIRMATION);
            else    transitionTo(FloodState::DANGER_WAITING_FOR_CONFIRMATION, "l2_inactive");
        } else if (levelMm >= alertMm) {
            if (l1) transitionTo(FloodState::ALERT_WAITING_FOR_CONFIRMATION);
            else    transitionTo(FloodState::ALERT_WAITING_FOR_CONFIRMATION, "l1_inactive");
        } else if (l1 || l2) {
            transitionTo(FloodState::ALERT_SENSOR_MISMATCH, "input_without_sensor");
        }
        break;

    case FloodState::ALERT_WAITING_FOR_CONFIRMATION:
        if (!sensorValid) {
            transitionTo(FloodState::SENSOR_FAULT); break;
        }
        if (levelMm < alertMm) { transitionTo(FloodState::NORMAL); break; }
        if (levelMm >= dangerMm) { transitionTo(FloodState::DANGER_WAITING_FOR_CONFIRMATION); break; }
        if (!l1) { transitionTo(FloodState::ALERT_SENSOR_MISMATCH, "l1_absent"); break; }
        if (inStateMs >= trigMs) transitionTo(FloodState::ALERT_CONFIRMED);
        break;

    case FloodState::ALERT_CONFIRMED:
        if (!sensorValid) { transitionTo(FloodState::SENSOR_FAULT); break; }
        if (levelMm >= dangerMm) { transitionTo(FloodState::DANGER_WAITING_FOR_CONFIRMATION); break; }
        if (levelMm < dangerClearMm && !l1) {
            transitionTo(FloodState::CLEAR_PENDING);
        }
        break;

    case FloodState::ALERT_SENSOR_MISMATCH:
        if (!l1 && !l2 && levelMm < alertMm) {
            transitionTo(FloodState::NORMAL);
        } else if (levelMm >= alertMm && l1) {
            transitionTo(FloodState::ALERT_WAITING_FOR_CONFIRMATION);
        }
        break;

    case FloodState::DANGER_WAITING_FOR_CONFIRMATION:
        if (!sensorValid) {
            if (l2 && inStateMs >= trigMs) {
                transitionTo(FloodState::DANGER_WITH_PRIMARY_SENSOR_FAULT, "sensor_lost_l2_active");
            } else {
                transitionTo(FloodState::SENSOR_FAULT);
            }
            break;
        }
        if (levelMm < alertMm && !l1 && !l2) { transitionTo(FloodState::NORMAL); break; }
        if (levelMm < dangerMm) { transitionTo(FloodState::ALERT_WAITING_FOR_CONFIRMATION); break; }
        if (!l2 && inStateMs >= trigMs) {
            transitionTo(FloodState::DANGER_WITH_CONFIRMATION_MISMATCH, "l2_not_confirmed");
            break;
        }
        if (l2 && inStateMs >= trigMs) {
            transitionTo(FloodState::DANGER_CONFIRMED);
        }
        break;

    case FloodState::DANGER_CONFIRMED:
        if (levelMm < dangerClearMm && !l2) {
            transitionTo(FloodState::CLEAR_PENDING);
        }
        break;

    case FloodState::DANGER_WITH_CONFIRMATION_MISMATCH:
        // Outputs remain active; auto-clear only when both primary and confirmation normalize
        if (sensorValid && levelMm < dangerClearMm && !l2) {
            transitionTo(FloodState::CLEAR_PENDING, "mismatch_cleared");
        }
        break;

    case FloodState::DANGER_WITH_PRIMARY_SENSOR_FAULT:
        if (sensorValid) {
            if (levelMm < dangerClearMm && !l2) transitionTo(FloodState::CLEAR_PENDING);
            else transitionTo(FloodState::DANGER_WAITING_FOR_CONFIRMATION, "sensor_recovered");
        } else if (!l2 && inStateMs >= clearMs) {
            transitionTo(FloodState::SENSOR_FAULT, "l2_cleared_sensor_still_fault");
        }
        break;

    case FloodState::CLEAR_PENDING:
        if (!sensorValid) { transitionTo(FloodState::SENSOR_FAULT); break; }
        if (levelMm >= dangerMm) { transitionTo(FloodState::DANGER_WAITING_FOR_CONFIRMATION); break; }
        if (levelMm >= alertMm)  { transitionTo(FloodState::ALERT_WAITING_FOR_CONFIRMATION); break; }
        if (inStateMs >= clearMs) transitionTo(FloodState::NORMAL, "cleared");
        break;

    case FloodState::SENSOR_FAULT:
        if (sensorValid) {
            transitionTo(levelMm >= dangerMm ? FloodState::DANGER_WAITING_FOR_CONFIRMATION
                       : levelMm >= alertMm  ? FloodState::ALERT_WAITING_FOR_CONFIRMATION
                                             : FloodState::NORMAL, "sensor_recovered");
        } else if (l2 && inStateMs >= trigMs) {
            transitionTo(FloodState::DANGER_WITH_PRIMARY_SENSOR_FAULT, "l2_active_sensor_fault");
        }
        break;
    }
}
