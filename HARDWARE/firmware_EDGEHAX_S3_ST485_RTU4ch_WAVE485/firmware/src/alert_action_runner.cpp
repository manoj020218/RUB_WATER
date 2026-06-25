#include "alert_action_runner.h"

#include <ArduinoJson.h>

#include "alert_action_sheet.h"
#include "config_manager.h"
#include "flood_state_machine.h"
#include "output_controller.h"
#include "remote_box_manager.h"
#include "telemetry_manager.h"

namespace {
bool isConfirmedStatus(AlertStatus status) {
    return status == AlertStatus::CONFIRMED
        || status == AlertStatus::CONFIRMED_BY_SINGLE_SENSOR;
}

const char* actionLevelStr(AlertActionLevel level) {
    return level == AlertActionLevel::RED ? "RED" : "ORANGE";
}
}

AlertActionRunner& AlertActionRunner::getInstance() {
    static AlertActionRunner inst;
    return inst;
}

void AlertActionRunner::begin(const char* deviceId, const char* hardwareId) {
    strncpy(_deviceId, deviceId, sizeof(_deviceId) - 1);
    strncpy(_hardwareId, hardwareId, sizeof(_hardwareId) - 1);
    _snap = {};
    _snap.level = AlertActionLevel::ORANGE;
    Serial.println("[ACT RUN] Ready");
}

void AlertActionRunner::loop() {
    const auto& fsm = FloodStateMachine::getInstance().snapshot();
    const auto& cfg = ConfigManager::getInstance().get();
    const uint32_t now = millis();
    const uint32_t currentSheetVersion = AlertActionSheetManager::getInstance().version();

    const bool redConfirmed = fsm.alertLevel == AlertLevel::DANGER && isConfirmedStatus(fsm.alertStatus);
    const bool orangeConfirmed = fsm.alertLevel == AlertLevel::ORANGE && isConfirmedStatus(fsm.alertStatus);

    if (redConfirmed) {
        if (!_latchedActive || _latchedLevel != AlertActionLevel::RED) {
            latchLevel(AlertActionLevel::RED, _latchedActive ? "ESCALATED" : "CONFIRMED");
        } else if (_snap.actionSheetVersion != currentSheetVersion) {
            _snap.activeSinceMs = now;
            _snap.actionSheetVersion = currentSheetVersion;
        }
        applyCurrentOutputs();
        return;
    }

    if (orangeConfirmed) {
        if (!_latchedActive) {
            latchLevel(AlertActionLevel::ORANGE, "CONFIRMED");
        } else if (_latchedLevel == AlertActionLevel::ORANGE && _snap.actionSheetVersion != currentSheetVersion) {
            _snap.activeSinceMs = now;
            _snap.actionSheetVersion = currentSheetVersion;
        }
        applyCurrentOutputs();
        return;
    }

    if (_latchedActive && _latchedLevel == AlertActionLevel::RED) {
        const bool keepRed = fsm.state == FloodState::CLEAR_PENDING
                          || fsm.state == FloodState::DANGER_WAITING_FOR_CONFIRMATION
                          || fsm.state == FloodState::DANGER_CONFIRMED
                          || fsm.state == FloodState::DANGER_WITH_CONFIRMATION_MISMATCH
                          || fsm.state == FloodState::DANGER_WITH_PRIMARY_SENSOR_FAULT
                          || fsm.waterLevelMm >= cfg.dangerClearLevelMm
                          || fsm.l2Active;
        if (keepRed) {
            applyCurrentOutputs();
            return;
        }
        clearLatchedLevel();
        return;
    }

    if (_latchedActive && _latchedLevel == AlertActionLevel::ORANGE) {
        const bool keepOrange = fsm.state == FloodState::CLEAR_PENDING
                             || fsm.state == FloodState::DANGER_WAITING_FOR_CONFIRMATION
                             || fsm.state == FloodState::DANGER_WITH_CONFIRMATION_MISMATCH
                             || fsm.state == FloodState::DANGER_WITH_PRIMARY_SENSOR_FAULT
                             || fsm.state == FloodState::ALERT_CONFIRMED
                             || fsm.state == FloodState::ALERT_WAITING_FOR_CONFIRMATION
                             || fsm.state == FloodState::ALERT_SENSOR_MISMATCH
                             || fsm.waterLevelMm >= cfg.alertLevelMm
                             || fsm.l1Active
                             || fsm.l2Active;
        if (keepOrange) {
            applyCurrentOutputs();
            return;
        }
        clearLatchedLevel();
        return;
    }

    resetOutputs();
}

void AlertActionRunner::resetOutputs() {
    OutputController::getInstance().setAutoOutputs(false, false, false);
    RemoteBoxManager::getInstance().setAutoOutputs(false, false, false);
    _snap.active = false;
    _snap.sirenOn = false;
    _snap.flashOn = false;
    _snap.voiceOn = false;
}

void AlertActionRunner::latchLevel(AlertActionLevel level, const char* actionStatus) {
    _latchedActive = true;
    _latchedLevel = level;
    _snap.active = true;
    _snap.level = level;
    _snap.activeSinceMs = millis();
    _snap.actionSheetVersion = AlertActionSheetManager::getInstance().version();
    applyCurrentOutputs();
    publishStateEvent(level == AlertActionLevel::RED && String(actionStatus) == "ESCALATED"
                        ? "ALERT_ACTION_ESCALATED"
                        : "ALERT_ACTION_APPLIED",
                      actionStatus);
}

void AlertActionRunner::clearLatchedLevel() {
    if (!_latchedActive) {
        resetOutputs();
        return;
    }
    publishStateEvent("ALERT_ACTION_CLEARED", "CLEARED");
    _latchedActive = false;
    resetOutputs();
}

void AlertActionRunner::applyCurrentOutputs() {
    if (!_latchedActive) {
        resetOutputs();
        return;
    }
    const uint32_t elapsedMs = millis() - _snap.activeSinceMs;
    const AlertLevelActionSheet& sheet = AlertActionSheetManager::getInstance().sheetFor(_latchedLevel);
    const bool sirenOn = computeRelayOutput(sheet.relays[0], elapsedMs);
    const bool flashOn = computeRelayOutput(sheet.relays[1], elapsedMs);
    const bool voiceOn = computeRelayOutput(sheet.relays[2], elapsedMs);

    _snap.active = true;
    _snap.level = _latchedLevel;
    _snap.sirenOn = sirenOn;
    _snap.flashOn = flashOn;
    _snap.voiceOn = voiceOn;
    _snap.actionSheetVersion = AlertActionSheetManager::getInstance().version();

    OutputController::getInstance().setAutoOutputs(sirenOn, flashOn, voiceOn);
    RemoteBoxManager::getInstance().setAutoOutputs(sirenOn, flashOn, voiceOn);
}

bool AlertActionRunner::computeRelayOutput(const AlertRelayAction& action, uint32_t elapsedMs) const {
    if (!action.enabled || action.mode == AlertRelayMode::OFF) {
        return false;
    }
    if (action.mode == AlertRelayMode::CONTINUOUS_ON) {
        return true;
    }

    const uint32_t onMs = (uint32_t)action.onTimeSec * 1000UL;
    const uint32_t offMs = (uint32_t)action.offTimeSec * 1000UL;
    if (onMs > 0 && offMs > 0) {
        const uint32_t cycleMs = onMs + offMs;
        return (elapsedMs % cycleMs) < onMs;
    }

    const uint32_t pulseMs = (uint32_t)action.pulseDurationSec * 1000UL;
    const uint32_t intervalMs = (uint32_t)action.repeatIntervalSec * 1000UL;
    if (pulseMs > 0 && intervalMs > pulseMs) {
        return (elapsedMs % intervalMs) < pulseMs;
    }
    return false;
}

void AlertActionRunner::publishStateEvent(const char* eventType, const char* actionStatus) {
    StaticJsonDocument<1536> doc;
    const auto& fsm = FloodStateMachine::getInstance().snapshot();
    const auto& sheetCfg = AlertActionSheetManager::getInstance().get();
    const AlertLevelActionSheet& sheet = AlertActionSheetManager::getInstance().sheetFor(_latchedLevel);

    doc["device_id"] = _deviceId;
    doc["hardware_id"] = _hardwareId;
    doc["event_type"] = eventType;
    doc["water_level_mm"] = fsm.waterLevelMm;
    doc["alert_level"] = actionLevelStr(_latchedLevel);
    doc["alert_status"] = actionStatus;
    doc["alert_source"] = alertSourceStr(fsm.alertSource);
    doc["triggered_by"] = "AUTO";
    doc["action_sheet_version"] = sheetCfg.actionSheetVersion;

    JsonObject details = doc.createNestedObject("details");
    details["flood_state"] = floodStateStr(fsm.state);
    details["sensor_source"] = alertSourceStr(fsm.alertSource);
    details["action_sheet_version"] = sheetCfg.actionSheetVersion;
    details["triggered_by"] = "AUTO";
    details["relay_action_source"] = sheetCfg.lastSyncSource;
    if (sheetCfg.lastSyncAt[0]) {
        details["action_sheet_last_sync_at"] = sheetCfg.lastSyncAt;
    }

    JsonArray relayActions = details.createNestedArray("relay_actions_applied");
    for (uint8_t relayIndex = 0; relayIndex < 3; relayIndex++) {
        const AlertRelayAction& action = sheet.relays[relayIndex];
        JsonObject relay = relayActions.createNestedObject();
        relay["relay_number"] = relayIndex + 1;
        relay["relay_name"] = AlertActionSheetManager::relayName(relayIndex);
        relay["enabled"] = action.enabled;
        relay["mode"] = AlertActionSheetManager::modeStr(action.mode);
        relay["on_time_sec"] = action.onTimeSec;
        relay["off_time_sec"] = action.offTimeSec;
        relay["repeat_interval_sec"] = action.repeatIntervalSec;
        relay["pulse_duration_sec"] = action.pulseDurationSec;
        relay["effective_state"] = (strcmp(actionStatus, "CLEARED") == 0)
            ? false
            : (relayIndex == 0 ? _snap.sirenOn : (relayIndex == 1 ? _snap.flashOn : _snap.voiceOn));
    }

    char payload[1536];
    serializeJson(doc, payload, sizeof(payload));
    TelemetryManager::getInstance().publishEventPayload(payload);
}
