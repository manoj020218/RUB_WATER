#include "voltage_monitor.h"

#include <Wire.h>
#include <Adafruit_INA219.h>

#include "device_profile.h"

namespace {
constexpr uint32_t kReadIntervalMs  = 10000UL;
constexpr float    kLowBattV        = 11.5f;
constexpr float    kCritBattV       = 10.5f;
}

static Adafruit_INA219 sIna(INA219_I2C_ADDR);

VoltageMonitor& VoltageMonitor::getInstance() {
    static VoltageMonitor inst;
    return inst;
}

void VoltageMonitor::begin() {
    Wire.begin(PIN_INA219_SDA, PIN_INA219_SCL);
    if (!sIna.begin(&Wire)) {
        Serial.println("[VMON] INA219 not found — check SDA=GPIO47 SCL=GPIO46 wiring");
        _snap.ready = false;
        return;
    }
    // 32 V bus range, ±2 A / 0.1 Ω shunt → ±320 mV shunt range, 0.1 mA resolution.
    // Covers 12 V lead-acid (max ~14.4 V charge) and 1 A max load comfortably.
    sIna.setCalibration_32V_2A();
    _snap.ready = true;
    Serial.printf("[VMON] INA219 OK — SDA=GPIO%d SCL=GPIO%d addr=0x%02X  32V/2A cal\n",
                  PIN_INA219_SDA, PIN_INA219_SCL, INA219_I2C_ADDR);
}

void VoltageMonitor::loop() {
    if (!_snap.ready) return;
    const uint32_t now = millis();
    if ((now - _lastReadMs) < kReadIntervalMs) return;
    _lastReadMs = now;

    // Bus voltage = load-side terminal; add shunt drop for true battery voltage.
    const float busV   = sIna.getBusVoltage_V();
    const float shuntV = sIna.getShuntVoltage_mV() / 1000.0f;
    const float v      = busV + shuntV;
    const float mA     = sIna.getCurrent_mA();
    const float mW     = sIna.getPower_mW();

    _snap.voltage         = v;
    _snap.currentMa       = mA;
    _snap.powerMw         = mW;
    _snap.lowBattery      = v < kLowBattV  && v > 1.0f;
    _snap.criticalBattery = v < kCritBattV && v > 1.0f;
}
