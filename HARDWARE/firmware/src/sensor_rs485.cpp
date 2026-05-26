#include "sensor_rs485.h"

#include <Preferences.h>

namespace {
constexpr const char* kNvsNamespace = "fgcfg";
constexpr const char* kNvsZeroKey   = "rs485_zero_mm";
// Give the sensor 20 s to respond after boot before marking it absent.
constexpr unsigned long kDetectionGraceMs = 20000UL;
}

SensorRs485& SensorRs485::getInstance() {
    static SensorRs485 instance;
    return instance;
}

void SensorRs485::begin(int32_t sensorMountHeightMm, bool enabled) {
    _mountHeightMm   = sensorMountHeightMm;
    _zeroDistanceMm  = sensorMountHeightMm;
    loadZeroFromNvs();
    _enabled         = enabled;
    _detected        = false;
    _graceStartMs    = millis();
    _lastReadMs      = 0;

    _snapshot        = {};
    _snapshot.enabled  = enabled;
    _snapshot.detected = false;
    _snapshot.valid    = false;
    _snapshot.fault    = false;
    _snapshot.distanceMm    = 0;
    _snapshot.waterLevelMm  = 0;
    _snapshot.lastValidMs   = 0;
}

void SensorRs485::loop() {
    _snapshot.enabled  = _enabled;
    _snapshot.detected = _detected;

    if (!_enabled) {
        _snapshot.valid        = false;
        _snapshot.fault        = false;
        _snapshot.detected     = false;
        _snapshot.distanceMm   = 0;
        _snapshot.waterLevelMm = 0;
        return;
    }

    const unsigned long now = millis();
    if (now - _lastReadMs < 2000UL) {
        return;
    }
    _lastReadMs = now;

    // ── Real Modbus read will go here in a future firmware revision ──
    // bool gotReading = modbusRead(&rawDistanceMm);
    // For now: no physical sensor wired → always no reading.
    constexpr bool gotReading = false;

    if (gotReading) {
        // Process real Modbus distance reading (placeholder).
        // int32_t rawDistanceMm = ...;
        // _snapshot.distanceMm   = rawDistanceMm;
        // const int32_t rawLevel = _zeroDistanceMm - rawDistanceMm;
        // _snapshot.waterLevelMm = rawLevel > 0 ? rawLevel : 0;
        // _snapshot.valid        = rawDistanceMm > 0 && rawDistanceMm <= _zeroDistanceMm;
        // _snapshot.fault        = !_snapshot.valid;
        // if (_snapshot.valid) {
        //     _detected = true;
        //     _snapshot.detected    = true;
        //     _snapshot.lastValidMs = now;
        // }
    } else {
        // No response from the RS485 bus.
        _snapshot.distanceMm   = 0;
        _snapshot.waterLevelMm = 0;

        const bool inGrace = (now - _graceStartMs < kDetectionGraceMs);
        if (inGrace) {
            // Still within the startup grace window — stay neutral so the
            // alarm state machine doesn't react while the bus is initialising.
            _snapshot.valid = false;
            _snapshot.fault = false;
        } else {
            // Grace period expired with no sensor response: sensor is absent.
            // fault stays false — "absent" is different from "broken".
            _snapshot.valid    = false;
            _snapshot.fault    = false;
            _snapshot.detected = false;
        }
    }
}

void SensorRs485::setEnabled(bool enabled) {
    _enabled           = enabled;
    _snapshot.enabled  = enabled;
    if (!enabled) {
        _detected          = false;
        _snapshot.detected = false;
    }
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
    if (!_detected || _snapshot.fault) {
        reason = "No valid sensor reading available";
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
