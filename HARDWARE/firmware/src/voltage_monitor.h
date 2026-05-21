#pragma once

#include <Arduino.h>

class VoltageMonitor {
public:
    static VoltageMonitor& getInstance();

    void begin();
    float readSupplyVoltage();
    bool updateCalibration(float dividerRatio, float calibrationFactor, bool persistToNvs, String& reason);

    float dividerRatio() const;
    float calibrationFactor() const;
    bool isAdcReady() const;

private:
    VoltageMonitor() = default;

    bool isDividerValid(float ratio) const;
    bool isCalibrationValid(float factor) const;
    void loadCalibrationFromNvs();
    void persistCalibrationToNvs();

    bool _adcConfigured = false;
    float _dividerRatio = 1.0f;
    float _calibrationFactor = 1.0f;
    float _lastVoltage = 0.0f;
};
