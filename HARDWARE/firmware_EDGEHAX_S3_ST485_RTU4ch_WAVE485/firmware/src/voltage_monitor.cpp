#include "voltage_monitor.h"

#include <Wire.h>

#include "device_profile.h"

namespace {
constexpr uint32_t kReadIntervalMs = 10000UL;
constexpr float    kLowBattV       = 11.5f;
constexpr float    kCritBattV      = 10.5f;

constexpr uint8_t  kRegConfig = 0x00;
constexpr uint8_t  kRegShunt  = 0x01;
constexpr uint8_t  kRegBus    = 0x02;
constexpr uint8_t  kRegCal    = 0x05;
// 32V bus, gain 8 (±320mV), 12-bit 128-sample avg, continuous
constexpr uint16_t kConfig32V2A = 0x2FFF;
// Cal = trunc(0.04096 / (0.0001A × 0.1Ω)) = 4096
constexpr uint16_t kCal32V2A   = 0x1000;
constexpr float    kRshuntOhm  = 0.1f;
// GY-219 module has a voltage divider on the VIN+ sense path.
// Measured 9.14V on a 13.52V supply => scale = 13.52/9.14 = 1.4793
constexpr float    kVBusScale  = 1.4793f;

bool sWireInit = false;

// Warm up both write and read paths on ESP32-S3 after Wire.begin().
// ~50 write probes arm the write state machine; one read with STOP arms the read path.
// Wire.begin() is called exactly once — Wire.end() is never called because it
// glitches the I2C lines and triggers INA219 power-on-reset.
void busWarmUp() {
    if (!sWireInit) {
        Wire.begin(PIN_INA219_SDA, PIN_INA219_SCL);
        sWireInit = true;
    }
    for (uint8_t a = 1; a < 50; a++) {
        Wire.beginTransmission(a);
        Wire.endTransmission(true);
    }
    Wire.requestFrom((uint8_t)INA219_I2C_ADDR, (uint8_t)2, (uint8_t)true);
    while (Wire.available()) Wire.read();
}

bool inaWrite(uint8_t reg, uint16_t val) {
    Wire.beginTransmission(INA219_I2C_ADDR);
    Wire.write(reg);
    Wire.write((uint8_t)(val >> 8));
    Wire.write((uint8_t)(val & 0xFF));
    return Wire.endTransmission(true) == 0;
}

bool inaRead(uint8_t reg, uint16_t& out) {
    Wire.beginTransmission(INA219_I2C_ADDR);
    Wire.write(reg);
    if (Wire.endTransmission(true) != 0) return false;
    if (Wire.requestFrom((uint8_t)INA219_I2C_ADDR, (uint8_t)2, (uint8_t)true) < 2) return false;
    out = ((uint16_t)Wire.read() << 8) | Wire.read();
    return true;
}

bool inaInit() {
    busWarmUp();
    Wire.beginTransmission(INA219_I2C_ADDR);
    if (Wire.endTransmission(true) != 0) {
        Serial.printf("[VMON] INA219 not on bus  SDA=GPIO%d SCL=GPIO%d\n",
                      PIN_INA219_SDA, PIN_INA219_SCL);
        return false;
    }
    if (!inaWrite(kRegConfig, kConfig32V2A) || !inaWrite(kRegCal, kCal32V2A)) {
        Serial.println("[VMON] INA219 register write failed");
        return false;
    }
    return true;
}
}  // namespace

VoltageMonitor& VoltageMonitor::getInstance() {
    static VoltageMonitor inst;
    return inst;
}

void VoltageMonitor::begin() {
    if (inaInit()) {
        _snap.ready = true;
        uint16_t busRaw = 0;
        inaRead(kRegBus, busRaw);
        const float busV = (float)((busRaw >> 3) & 0x1FFF) * 0.004f * kVBusScale;
        Serial.printf("[VMON] INA219 OK — SDA=GPIO%d SCL=GPIO%d  bus=%.2fV\n",
                      PIN_INA219_SDA, PIN_INA219_SCL, busV);
    } else {
        Serial.printf("[VMON] INA219 not found (SDA=GPIO%d SCL=GPIO%d) — will retry\n",
                      PIN_INA219_SDA, PIN_INA219_SCL);
    }
}

void VoltageMonitor::loop() {
    const uint32_t now = millis();

    if (!_snap.ready) {
        if (_lastReadMs != 0 && (now - _lastReadMs) < 30000UL) return;
        _lastReadMs = now;
        if (inaInit()) {
            _snap.ready = true;
            Serial.println("[VMON] INA219 ready");
        } else {
            Serial.println("[VMON] INA219 not found — will retry in 30s");
        }
        return;
    }

    if ((now - _lastReadMs) < kReadIntervalMs) return;
    _lastReadMs = now;

    busWarmUp();  // ESP32-S3 I2C goes cold after ~10s idle; re-warm before reads
    uint16_t busRaw = 0, shuntRaw = 0;
    const bool busOk   = inaRead(kRegBus,   busRaw);
    const bool shuntOk = inaRead(kRegShunt, shuntRaw);

    if (!busOk) {
        Serial.println("[VMON] read failed — will re-init");
        _snap.ready = false;
        return;
    }

    const float busV   = (float)((busRaw >> 3) & 0x1FFF) * 0.004f * kVBusScale;
    const float shuntV = shuntOk ? (float)(int16_t)shuntRaw * 0.00001f : 0.0f;
    const float v      = busV + shuntV;
    const float mA     = shuntOk ? (shuntV / kRshuntOhm) * 1000.0f : 0.0f;
    const float mW     = v * mA;

    _snap.voltage         = v;
    _snap.currentMa       = mA;
    _snap.powerMw         = mW;
    _snap.lowBattery      = v < kLowBattV  && v > 1.0f;
    _snap.criticalBattery = v < kCritBattV && v > 1.0f;

    Serial.printf("[VMON] bus=%.2fV shunt=%.4fV total=%.2fV  %.1fmA  %.0fmW  %s\n",
                  busV, shuntV, v, mA, mW,
                  _snap.criticalBattery ? "CRITICAL" : _snap.lowBattery ? "LOW" : "OK");
}
