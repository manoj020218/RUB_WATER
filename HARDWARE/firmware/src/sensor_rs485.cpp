#include "sensor_rs485.h"
#include "device_profile.h"

#include <HardwareSerial.h>
#include <Preferences.h>

namespace {
constexpr const char* kNvsNamespace    = "fgcfg";
constexpr const char* kNvsZeroKey      = "rs485_zero_mm";
constexpr unsigned long kDetectGraceMs = 20000UL;  // wait 20 s before declaring absent
constexpr unsigned long kReadTimeoutMs = 3000UL;   // no frame for 3 s → sensor lost
constexpr uint32_t kBaud               = 9600;
constexpr int32_t  kMinDistMm          = 280;
constexpr int32_t  kMaxDistMm          = 2500;

// UART2 — dedicated to the RS485 sensor bus
static HardwareSerial rs485Serial(2);
}  // namespace

// ── Singleton ──────────────────────────────────────────────────────────────
SensorRs485& SensorRs485::getInstance() {
    static SensorRs485 instance;
    return instance;
}

// ── begin ──────────────────────────────────────────────────────────────────
void SensorRs485::begin(int32_t sensorMountHeightMm, bool enabled) {
    _mountHeightMm  = sensorMountHeightMm;
    _zeroDistanceMm = sensorMountHeightMm;
    loadZeroFromNvs();
    _enabled       = enabled;
    _detected      = false;
    _uartReady     = false;
    _graceStartMs  = millis();
    _lastReadMs    = 0;
    _snapshot      = {};
    _snapshot.enabled  = enabled;

    if (!enabled) return;

    // DE/RE pin LOW = receive mode (DYP auto-sends, no TX needed)
    pinMode(DeviceProfile::RS485_DERE_PIN, OUTPUT);
    digitalWrite(DeviceProfile::RS485_DERE_PIN, LOW);

    rs485Serial.begin(kBaud, SERIAL_8N1,
                      DeviceProfile::RS485_RX_PIN,
                      DeviceProfile::RS485_TX_PIN);
    _uartReady = true;
}

// ── readDypFrame ───────────────────────────────────────────────────────────
// Drain the UART buffer; return the last valid DYP frame found.
// DYP-A01 auto-mode frame: 0xFF  H  L  SUM   (4 bytes, ~1 frame/sec)
bool SensorRs485::readDypFrame(int32_t& distOut) {
    bool got = false;
    while (rs485Serial.available() >= 1) {
        // Sync on start byte
        if (rs485Serial.peek() != (int)0xFF) {
            rs485Serial.read();
            continue;
        }
        if (rs485Serial.available() < 4) break;  // wait for full frame

        uint8_t b[4];
        for (int i = 0; i < 4; i++) b[i] = (uint8_t)rs485Serial.read();

        const uint8_t csum = (uint8_t)((b[0] + b[1] + b[2]) & 0xFF);
        if (csum != b[3]) continue;  // bad checksum — discard

        const int32_t d = (int32_t)b[1] * 256 + (int32_t)b[2];
        if (d < kMinDistMm || d > kMaxDistMm) continue;  // out of range

        distOut = d;
        got = true;
        // Keep draining to consume the freshest frame in the buffer
    }
    return got;
}

// ── loop ───────────────────────────────────────────────────────────────────
void SensorRs485::loop() {
    _snapshot.enabled  = _enabled;
    _snapshot.detected = _detected;

    if (!_enabled || !_uartReady) {
        _snapshot.valid        = false;
        _snapshot.fault        = false;
        _snapshot.detected     = false;
        _snapshot.distanceMm   = 0;
        _snapshot.waterLevelMm = 0;
        return;
    }

    const unsigned long now = millis();
    int32_t rawDist = 0;

    if (readDypFrame(rawDist)) {
        _snapshot.distanceMm   = rawDist;
        const int32_t lvl      = _zeroDistanceMm - rawDist;
        _snapshot.waterLevelMm = lvl > 0 ? lvl : 0;
        _snapshot.valid        = true;
        _snapshot.fault        = false;
        _detected              = true;
        _snapshot.detected     = true;
        _snapshot.lastValidMs  = now;
        _lastReadMs            = now;
        return;
    }

    // No new frame this cycle — check if the last one is still fresh enough
    const bool recentFrame = (_snapshot.lastValidMs > 0)
                             && ((now - _snapshot.lastValidMs) < kReadTimeoutMs);
    if (recentFrame) {
        return;  // keep last reading, still valid
    }

    // Timeout — sensor not responding
    _snapshot.distanceMm   = 0;
    _snapshot.waterLevelMm = 0;
    _snapshot.valid        = false;
    _snapshot.fault        = false;

    const bool inGrace = (now - _graceStartMs < kDetectGraceMs);
    if (!inGrace) {
        _detected          = false;
        _snapshot.detected = false;
    }
}

// ── setEnabled ─────────────────────────────────────────────────────────────
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

// ── zero calibration ───────────────────────────────────────────────────────
bool SensorRs485::setZeroFromCurrentReading(String& reason) {
    if (!_enabled) { reason = "RS485 sensor not enabled"; return false; }
    if (!_detected || !_snapshot.valid) { reason = "No valid sensor reading available"; return false; }
    if (_snapshot.distanceMm <= 0) { reason = "No valid reading available"; return false; }
    _zeroDistanceMm = _snapshot.distanceMm;
    persistZeroToNvs();
    reason = "";
    return true;
}

int32_t SensorRs485::zeroDistanceMm() const { return _zeroDistanceMm; }

void SensorRs485::loadZeroFromNvs() {
    Preferences prefs;
    if (!prefs.begin(kNvsNamespace, true)) return;
    const int32_t saved = prefs.getInt(kNvsZeroKey, 0);
    prefs.end();
    if (saved > 0) _zeroDistanceMm = saved;
}

void SensorRs485::persistZeroToNvs() {
    Preferences prefs;
    if (!prefs.begin(kNvsNamespace, false)) return;
    prefs.putInt(kNvsZeroKey, _zeroDistanceMm);
    prefs.end();
}
