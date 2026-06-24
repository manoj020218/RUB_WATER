#include "voltage_monitor.h"

#include "config_manager.h"
#include "device_profile.h"

namespace {
constexpr uint32_t kReadIntervalMs = 10000UL;  // read every 10 s
constexpr float kAdcMaxVoltage     = 3.3f;
constexpr uint16_t kAdcMax         = 4095;
constexpr float kLowBattThreshold  = 11.5f;
constexpr float kCritThreshold     = 10.5f;
}

VoltageMonitor& VoltageMonitor::getInstance() {
    static VoltageMonitor inst;
    return inst;
}

void VoltageMonitor::begin() {
    const auto& cfg = ConfigManager::getInstance().get();
    _divider   = cfg.batteryAdcDividerRatio;
    _calFactor = cfg.batteryAdcCalibrationFactor;
    analogReadResolution(12);
    analogSetAttenuation(ADC_11db);
    _snap.adcReady = true;
    Serial.printf("[VMON] ADC=GPIO%d divider=%.2f cal=%.3f\n",
                  PIN_MAIN_BATTERY_ADC, _divider, _calFactor);
}

void VoltageMonitor::loop() {
    const uint32_t now = millis();
    if ((now - _lastReadMs) < kReadIntervalMs) return;
    _lastReadMs = now;

    uint32_t sum = 0;
    for (uint8_t i = 0; i < BATTERY_ADC_SAMPLES; i++) {
        sum += analogRead(PIN_MAIN_BATTERY_ADC);
    }
    const uint16_t raw = (uint16_t)(sum / BATTERY_ADC_SAMPLES);
    const float adcV   = (raw / (float)kAdcMax) * kAdcMaxVoltage;
    const float v      = adcV * _divider * _calFactor;

    _snap.adcRaw         = raw;
    _snap.voltage        = v;
    _snap.adcReady       = true;
    _snap.lowBattery     = v < kLowBattThreshold && v > 1.0f;
    _snap.criticalBattery= v < kCritThreshold && v > 1.0f;
}

void VoltageMonitor::setCalibration(float divider, float calFactor) {
    _divider   = divider;
    _calFactor = calFactor;
}
