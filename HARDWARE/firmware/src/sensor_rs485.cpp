#include "sensor_rs485.h"

#include <Preferences.h>

namespace {
constexpr const char* kNvsNamespace = "fgcfg";
constexpr const char* kNvsZeroKey   = "rs485_zero_mm";
}

SensorRs485& SensorRs485::getInstance() {
    static SensorRs485 instance;
    return instance;
}

void SensorRs485::begin(int32_t sensorMountHeightMm, bool enabled) {
    _mountHeightMm = sensorMountHeightMm;
    _zeroDistanceMm = sensorMountHeightMm;  // use config value until NVS overrides
    loadZeroFromNvs();
    _enabled = enabled;
    _snapshot.enabled = enabled;
    _snapshot.valid = enabled;
    _snapshot.fault = false;
    _snapshot.distanceMm = 932;
    const int32_t initLevel = _zeroDistanceMm - _snapshot.distanceMm;
    _snapshot.waterLevelMm = initLevel > 0 ? initLevel : 0;
    _snapshot.lastValidMs = millis();
    _lastReadMs = 0;
}

void SensorRs485::loop() {
    _snapshot.enabled = _enabled;
    if (!_enabled) {
        _snapshot.valid = false;
        _snapshot.fault = false;
        _snapshot.distanceMm = 0;
        _snapshot.waterLevelMm = 0;
        return;
    }

    const unsigned long now = millis();
    if (now - _lastReadMs < 2000UL) {
        return;
    }
    _lastReadMs = now;

    // Placeholder simulated value until RS485 Modbus integration is added.
    _simulatedDistanceMm += static_cast<float>(_simDirection) * 4.0f;
    if (_simulatedDistanceMm > 980.0f) {
        _simDirection = -1;
    } else if (_simulatedDistanceMm < 650.0f) {
        _simDirection = 1;
    }

    _snapshot.distanceMm = static_cast<int32_t>(_simulatedDistanceMm);
    const int32_t rawLevel = _zeroDistanceMm - _snapshot.distanceMm;
    _snapshot.waterLevelMm = rawLevel > 0 ? rawLevel : 0;
    _snapshot.valid = _snapshot.distanceMm > 0 && _snapshot.distanceMm <= _zeroDistanceMm;
    _snapshot.fault = !_snapshot.valid;
    if (_snapshot.valid) {
        _snapshot.lastValidMs = now;
    }
}

void SensorRs485::setEnabled(bool enabled) {
    _enabled = enabled;
    _snapshot.enabled = enabled;
}

void SensorRs485::setMountHeightMm(int32_t sensorMountHeightMm) {
    _mountHeightMm = sensorMountHeightMm;
}

const SensorSnapshot& SensorRs485::getSnapshot() const {
    return _snapshot;
}

bool SensorRs485::setZeroFromCurrentReading(String& reason) {
    if (!_enabled) {
        reason = "RS485 sensor not enabled";
        return false;
    }
    if (_snapshot.fault) {
        reason = "Sensor fault — cannot set zero";
        return false;
    }
    if (_snapshot.distanceMm <= 0) {
        reason = "No valid reading available";
        return false;
    }
    _zeroDistanceMm = _snapshot.distanceMm;
    persistZeroToNvs();
    reason = "";
    return true;
}

int32_t SensorRs485::zeroDistanceMm() const {
    return _zeroDistanceMm;
}

void SensorRs485::loadZeroFromNvs() {
    Preferences prefs;
    if (!prefs.begin(kNvsNamespace, true)) return;
    const int32_t saved = prefs.getInt(kNvsZeroKey, 0);
    prefs.end();
    if (saved > 0) {
        _zeroDistanceMm = saved;
    }
}

void SensorRs485::persistZeroToNvs() {
    Preferences prefs;
    if (!prefs.begin(kNvsNamespace, false)) return;
    prefs.putInt(kNvsZeroKey, _zeroDistanceMm);
    prefs.end();
}
