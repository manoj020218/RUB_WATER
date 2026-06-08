#include "dyp_sensor.h"

#include <HardwareSerial.h>
#include <Preferences.h>

#include "device_profile.h"

namespace {
static HardwareSerial dypSerial(2);    // UART2 dedicated to DYP sensor (matches old working firmware)
constexpr uint32_t kBaud          = 9600;
constexpr int32_t  kMinDistMm     = 280;
constexpr int32_t  kMaxDistMm     = 2500;
constexpr uint32_t kDetectGraceMs = 20000UL;
constexpr uint32_t kReadTimeoutMs = 3000UL;
}

DypSensor& DypSensor::getInstance() {
    static DypSensor inst;
    return inst;
}

void DypSensor::begin() {
    loadZeroFromNvs();
    _graceStartMs = millis();
    _snap = {};
    _snap.enabled = true;

    dypSerial.begin(kBaud, SERIAL_8N1, PIN_PRIMARY_DYP_RX, PIN_PRIMARY_DYP_TX);
    _uartReady = true;
    Serial.printf("[DYP] UART1 RX=GPIO%d baud=%u zero=%d mm\n",
                  PIN_PRIMARY_DYP_RX, kBaud, (int)_zeroDist);
}

void DypSensor::loop() {
    if (!_uartReady) return;
    const uint32_t now = millis();
    int32_t dist = 0;

#ifdef SENSOR_TEST_MODE
    {
        static uint32_t sRawLogMs = 0;
        const int avail = dypSerial.available();
        if (avail > 0) {
            Serial.printf("[DYP_RAW] avail=%d  first=0x%02X\n", avail, (uint8_t)dypSerial.peek());
        } else if (now - sRawLogMs >= 5000UL) {
            sRawLogMs = now;
            Serial.println("[DYP_RAW] 0 bytes on UART1/GPIO21");
        }
    }
#endif

#ifdef DUMMY_DYP_MM
    dist = DUMMY_DYP_MM;
    const bool frameOk = true;
#else
    const bool frameOk = readFrame(dist);
#endif
    if (frameOk) {
        _snap.distanceMm   = dist;
        const int32_t lvl  = _zeroDist - dist;
        _snap.waterLevelMm = lvl > 0 ? lvl : 0;
        _snap.valid        = true;
        _snap.fault        = false;
        _snap.detected     = true;
        _snap.lastValidMs  = now;
        _lastReadMs        = now;
        return;
    }

    const bool fresh = _snap.lastValidMs > 0 && (now - _snap.lastValidMs) < kReadTimeoutMs;
    if (fresh) return;

    // Sensor not responding
    if (now - _lastLogMs >= 5000UL || _lastLogMs == 0) {
        _lastLogMs = now;
        const uint32_t elapsed = _snap.lastValidMs > 0
            ? (now - _snap.lastValidMs) / 1000UL
            : (now - _graceStartMs) / 1000UL;
        Serial.printf("[DYP] No frame for %us\n", (unsigned)elapsed);
    }

    _snap.distanceMm   = 0;
    _snap.waterLevelMm = 0;
    _snap.valid        = false;
    _snap.fault        = false;

    if ((now - _graceStartMs) >= kDetectGraceMs) {
        _snap.detected = false;
    }
}

bool DypSensor::readFrame(int32_t& distOut) {
    bool got = false;
    while (dypSerial.available() >= 1) {
        if (dypSerial.peek() != (int)0xFF) {
            dypSerial.read();
            continue;
        }
        if (dypSerial.available() < 4) {
            const uint32_t t0 = millis();
            while (dypSerial.available() < 4 && (millis() - t0) < 300UL) { yield(); }
            if (dypSerial.available() < 4) break;
        }
        uint8_t b[4];
        for (int i = 0; i < 4; i++) b[i] = (uint8_t)dypSerial.read();
        const uint8_t csum = (b[0] + b[1] + b[2]) & 0xFF;
#ifdef SENSOR_TEST_MODE
        const int32_t dRaw = (int32_t)b[1] * 256 + b[2];
        Serial.printf("[DYP_FRAME] %02X %02X %02X %02X  csum_ok=%c  d=%dmm\n",
                      b[0], b[1], b[2], b[3], csum == b[3] ? 'Y' : 'N', (int)dRaw);
#endif
        if (csum != b[3]) continue;
        const int32_t d = (int32_t)b[1] * 256 + b[2];
        if (d < kMinDistMm || d > kMaxDistMm) continue;
        distOut = d;
        got = true;
    }
    return got;
}

bool DypSensor::setZeroFromCurrentReading(String& reason) {
    if (!_snap.valid || _snap.distanceMm <= 0) {
        reason = "no_valid_reading";
        return false;
    }
    _zeroDist = _snap.distanceMm;
    saveZeroToNvs();
    Serial.printf("[DYP] Zero set to %d mm\n", (int)_zeroDist);
    return true;
}

void DypSensor::loadZeroFromNvs() {
    Preferences prefs;
    if (!prefs.begin(NVS_NS_MAIN, true)) return;
    const int32_t v = prefs.getInt("dyp_zero_mm", 0);
    prefs.end();
    if (v > 0) _zeroDist = v;
}

void DypSensor::saveZeroToNvs() {
    Preferences prefs;
    if (!prefs.begin(NVS_NS_MAIN, false)) return;
    prefs.putInt("dyp_zero_mm", _zeroDist);
    prefs.end();
}
