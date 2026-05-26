#include "voltage_monitor.h"

#include <Preferences.h>
#include <cmath>

#include "device_profile.h"

namespace {
constexpr const char* kPrefsNamespace = "fgcfg";
constexpr const char* kPrefsDividerKey = "adc_ratio";
constexpr const char* kPrefsCalibrationKey = "adc_calib";

constexpr float kDividerMin = 1.0f;
constexpr float kDividerMax = 25.0f;
constexpr float kCalibrationMin = 0.5f;
constexpr float kCalibrationMax = 1.8f;
}  // namespace

VoltageMonitor& VoltageMonitor::getInstance() {
    static VoltageMonitor instance;
    return instance;
}

void VoltageMonitor::begin() {
    _dividerRatio = DeviceProfile::BATTERY_ADC_DIVIDER_RATIO;
    _calibrationFactor = DeviceProfile::BATTERY_ADC_CALIBRATION;
    _lastVoltage = 0.0f;

    loadCalibrationFromNvs();

#if defined(ARDUINO_ARCH_ESP32)
    pinMode(DeviceProfile::BATTERY_ADC_PIN, INPUT);
    analogReadResolution(12);
    analogSetPinAttenuation(DeviceProfile::BATTERY_ADC_PIN, ADC_11db);
    _adcConfigured = true;
#else
    _adcConfigured = false;
#endif
}

float VoltageMonitor::readSupplyVoltage() {
    if (!_adcConfigured) {
        return 0.0f;
    }

    const uint8_t sampleCount = (DeviceProfile::BATTERY_ADC_SAMPLES == 0)
        ? 1
        : DeviceProfile::BATTERY_ADC_SAMPLES;
    uint32_t sumMilliVolts = 0;
    for (uint8_t i = 0; i < sampleCount; ++i) {
        sumMilliVolts += static_cast<uint32_t>(analogReadMilliVolts(DeviceProfile::BATTERY_ADC_PIN));
    }

    const float adcVolts = static_cast<float>(sumMilliVolts) / static_cast<float>(sampleCount) / 1000.0f;
    _lastAdcVolts = adcVolts;
    float supplyVolts = adcVolts * _dividerRatio * _calibrationFactor;
    if (!std::isfinite(supplyVolts) || supplyVolts < 0.0f) {
        supplyVolts = 0.0f;
    }
    if (supplyVolts < 0.05f) {
        supplyVolts = 0.0f;
    }

    if (_lastVoltage <= 0.0f) {
        _lastVoltage = supplyVolts;
    } else {
        // Smooth noisy ADC readings so dashboard voltage is stable.
        _lastVoltage = (_lastVoltage * 0.75f) + (supplyVolts * 0.25f);
    }

    return _lastVoltage;
}

bool VoltageMonitor::updateCalibration(float dividerRatio, float calibrationFactor, bool persistToNvs, String& reason) {
    if (!isDividerValid(dividerRatio)) {
        reason = "adc divider ratio must be between 1.0 and 25.0";
        return false;
    }
    if (!isCalibrationValid(calibrationFactor)) {
        reason = "adc calibration factor must be between 0.5 and 1.8";
        return false;
    }

    _dividerRatio = dividerRatio;
    _calibrationFactor = calibrationFactor;
    _lastVoltage = 0.0f;

    if (persistToNvs) {
        persistCalibrationToNvs();
    }

    reason = "";
    return true;
}

float VoltageMonitor::dividerRatio() const {
    return _dividerRatio;
}

float VoltageMonitor::calibrationFactor() const {
    return _calibrationFactor;
}

bool VoltageMonitor::isAdcReady() const {
    return _adcConfigured;
}

bool VoltageMonitor::isDividerValid(float ratio) const {
    return std::isfinite(ratio) && ratio >= kDividerMin && ratio <= kDividerMax;
}

bool VoltageMonitor::isCalibrationValid(float factor) const {
    return std::isfinite(factor) && factor >= kCalibrationMin && factor <= kCalibrationMax;
}

void VoltageMonitor::loadCalibrationFromNvs() {
    Preferences prefs;
    if (!prefs.begin(kPrefsNamespace, true)) {
        return;
    }

    const float savedRatio = prefs.getFloat(kPrefsDividerKey, _dividerRatio);
    const float savedCalibration = prefs.getFloat(kPrefsCalibrationKey, _calibrationFactor);
    prefs.end();

    if (isDividerValid(savedRatio)) {
        _dividerRatio = savedRatio;
    }
    if (isCalibrationValid(savedCalibration)) {
        _calibrationFactor = savedCalibration;
    }
}

void VoltageMonitor::persistCalibrationToNvs() {
    Preferences prefs;
    if (!prefs.begin(kPrefsNamespace, false)) {
        return;
    }
    prefs.putFloat(kPrefsDividerKey, _dividerRatio);
    prefs.putFloat(kPrefsCalibrationKey, _calibrationFactor);
    prefs.end();
}

float VoltageMonitor::lastAdcVolts() const {
    return _lastAdcVolts;
}

bool VoltageMonitor::setActualVoltage(float actualVoltage, String& reason) {
    if (!_adcConfigured) {
        reason = "ADC not ready";
        return false;
    }
    if (actualVoltage < 1.0f || actualVoltage > 30.0f) {
        reason = "actual_voltage must be between 1.0 and 30.0 V";
        return false;
    }

    const uint8_t sampleCount = (DeviceProfile::BATTERY_ADC_SAMPLES == 0)
        ? 1 : DeviceProfile::BATTERY_ADC_SAMPLES;
    uint32_t sumMilliVolts = 0;
    for (uint8_t i = 0; i < sampleCount; ++i) {
        sumMilliVolts += static_cast<uint32_t>(analogReadMilliVolts(DeviceProfile::BATTERY_ADC_PIN));
    }
    const float adcVolts = static_cast<float>(sumMilliVolts) / static_cast<float>(sampleCount) / 1000.0f;

    if (adcVolts < 0.05f) {
        reason = "ADC reading too low — check wiring at G10";
        return false;
    }

    const float newRatio = actualVoltage / adcVolts;
    if (!isDividerValid(newRatio)) {
        reason = "computed ratio out of range (1.0–25.0) — verify wiring or entered voltage";
        return false;
    }

    _dividerRatio = newRatio;
    _calibrationFactor = 1.0f;
    _lastVoltage = 0.0f;
    _lastAdcVolts = adcVolts;
    persistCalibrationToNvs();
    reason = "";
    return true;
}
