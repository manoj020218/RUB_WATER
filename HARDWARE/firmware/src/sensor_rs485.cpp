#include "sensor_rs485.h"

SensorRs485& SensorRs485::getInstance() {
    static SensorRs485 instance;
    return instance;
}

void SensorRs485::begin(int32_t sensorMountHeightMm, bool enabled) {
    _mountHeightMm = sensorMountHeightMm;
    _enabled = enabled;
    _snapshot.enabled = enabled;
    _snapshot.valid = enabled;
    _snapshot.fault = false;
    _snapshot.distanceMm = 932;
    _snapshot.waterLevelMm = _mountHeightMm - _snapshot.distanceMm;
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
    _snapshot.waterLevelMm = _mountHeightMm - _snapshot.distanceMm;
    _snapshot.valid = _snapshot.distanceMm > 0 && _snapshot.distanceMm <= _mountHeightMm;
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
