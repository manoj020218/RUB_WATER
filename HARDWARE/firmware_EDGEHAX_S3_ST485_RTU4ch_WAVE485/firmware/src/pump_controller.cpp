#include "pump_controller.h"

#include "config_manager.h"
#include "dyp_sensor.h"
#include "flood_state_machine.h"
#include "output_controller.h"

PumpController& PumpController::getInstance() {
    static PumpController inst;
    return inst;
}

void PumpController::begin() {
    _running   = false;
    _mode      = PumpMode::AUTO;
    _snap      = {};
    Serial.println("[PUMP] Controller started in AUTO mode");
}

void PumpController::loop() {
    const auto& cfg = ConfigManager::getInstance().get();
    const auto& dyp = DypSensor::getInstance().snapshot();
    const uint32_t now = millis();

    const uint32_t maxRtMs = (uint32_t)cfg.pumpMaxRuntimeMinutes * 60000UL;
    const uint32_t lowStopMs = (uint32_t)cfg.pumpLowStopDelaySeconds * 1000UL;

    // Maximum runtime protection (applies in all modes)
    if (_running && (now - _startMs) >= maxRtMs) {
        stopPump("max_runtime_reached");
        _snap.maxRuntimeReached = true;
    }

    // Dry-run low-level stop (applies in all modes)
    const bool levelLow = dyp.valid && (dyp.waterLevelMm <= cfg.pumpAutoStopLevelMm);
    if (_running) {
        if (levelLow) {
            if (!_lowLevelTracking) {
                _lowLevelTracking = true;
                _lowLevelSinceMs  = now;
            } else if ((now - _lowLevelSinceMs) >= lowStopMs) {
                stopPump("dry_run_low_level");
                _snap.dryRunStop = true;
            }
        } else {
            _lowLevelTracking = false;
        }
    }

    if (_mode != PumpMode::AUTO) {
        _snap.mode    = _mode;
        _snap.running = _running;
        _snap.runtimeMs = _running ? (now - _startMs) : 0;
        return;
    }

    // Auto mode
    const bool confirmed = isAlertOrDanger(FloodStateMachine::getInstance().snapshot().state);
    const bool levelHigh = dyp.valid && (dyp.waterLevelMm >= cfg.pumpAutoStartLevelMm);

    if (!_running && confirmed && levelHigh) {
        startPump();
    } else if (_running && !confirmed && levelLow) {
        // Only auto-stop in AUTO mode when confirmed alert/danger is gone AND level is low
        // (dry-run stop above covers the timed version)
    }

    _snap.mode    = _mode;
    _snap.running = _running;
    _snap.runtimeMs = _running ? (now - _startMs) : 0;
}

void PumpController::setManualOn() {
    _mode = PumpMode::MANUAL_ON;
    if (!_running) startPump();
    Serial.println("[PUMP] Manual ON");
}

void PumpController::setManualOff() {
    _mode = PumpMode::MANUAL_OFF;
    if (_running) stopPump("manual_off");
    Serial.println("[PUMP] Manual OFF");
}

void PumpController::setAutoMode() {
    _mode = PumpMode::AUTO;
    Serial.println("[PUMP] Auto mode");
}

void PumpController::startPump() {
    _running          = true;
    _startMs          = millis();
    _lowLevelTracking = false;
    _snap.maxRuntimeReached = false;
    _snap.dryRunStop        = false;
    OutputController::getInstance().setSumpPump(true);
    Serial.println("[PUMP] Started");
}

void PumpController::stopPump(const char* reason) {
    _running          = false;
    _lowLevelTracking = false;
    OutputController::getInstance().setSumpPump(false);
    Serial.printf("[PUMP] Stopped: %s\n", reason);
}
