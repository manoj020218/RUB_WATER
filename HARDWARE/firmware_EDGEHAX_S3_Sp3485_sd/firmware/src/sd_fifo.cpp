#include "sd_fifo.h"

#include <SD_MMC.h>

#include "device_profile.h"
#include "internal_flash_fifo.h"

namespace {
constexpr uint32_t kMountRetryMs = 30000UL;
constexpr const char* kDir       = "/sdcard/fifo";
}

SdFifo& SdFifo::getInstance() {
    static SdFifo inst;
    return inst;
}

void SdFifo::begin() {
    SD_MMC.setPins(PIN_SD_CLK, PIN_SD_CMD, PIN_SD_D0, PIN_SD_D1, PIN_SD_D2, PIN_SD_D3);
    if (mountCard()) {
        Serial.printf("[SD] Mounted: %.1f GB used=%.1f MB records=%u\n",
                      _status.cardSizeBytes / 1e9,
                      _status.usedBytes / 1e6,
                      (unsigned)_status.recordCount);
        // Create FIFO directory if absent
        if (!SD_MMC.exists(kDir)) SD_MMC.mkdir(kDir);
    } else {
        Serial.println("[SD] Card absent or mount failed — using internal FIFO");
        InternalFlashFifo::getInstance().begin();
    }
}

void SdFifo::loop() {
    if (_status.mounted) return;
    const uint32_t now = millis();
    if ((now - _lastMountAttemptMs) < kMountRetryMs) return;
    _lastMountAttemptMs = now;
    if (mountCard()) {
        Serial.println("[SD] Card mounted after retry");
        if (!SD_MMC.exists(kDir)) SD_MMC.mkdir(kDir);
    }
}

bool SdFifo::push(const char* type, const char* payload) {
    if (!_status.mounted) {
        return InternalFlashFifo::getInstance().push(type, payload);
    }
    // Write to SD as a sequentially-named JSON file
    char path[64];
    snprintf(path, sizeof(path), "%s/%010lu.json", kDir, (unsigned long)millis());
    File f = SD_MMC.open(path, FILE_WRITE);
    if (!f) {
        _status.faultReported = true;
        return InternalFlashFifo::getInstance().push(type, payload);
    }
    f.printf("{\"ts\":%lu,\"type\":\"%s\",\"d\":%s}\n",
             (unsigned long)millis(), type, payload);
    f.close();
    _status.recordCount++;
    return true;
}

bool SdFifo::syncNext(bool mqttOk, bool httpOk) {
    if (!mqttOk && !httpOk) return false;
    if (_pendingAck) return false;  // previous record not ACKed yet

    if (!_status.mounted) {
        // Sync from internal FIFO
        FifoRecord rec;
        if (!InternalFlashFifo::getInstance().peek(rec)) return false;
        // Caller (TelemetryManager) reads the record and sends it
        return true;
    }
    return false;
}

void SdFifo::ack() {
    if (_status.mounted && _ackPath[0]) {
        SD_MMC.remove(_ackPath);
        _ackPath[0] = '\0';
        if (_status.recordCount > 0) _status.recordCount--;
    } else {
        InternalFlashFifo::getInstance().pop();
    }
    _pendingAck = false;
}

bool SdFifo::mountCard() {
    _lastMountAttemptMs = millis();
    // Try 4-bit at 4 MHz — SDXC (64GB+) cards need lower clock for SCR handshake.
    bool ok = SD_MMC.begin("/sdcard", false, false, 4000);
    if (!ok) {
        Serial.println("[SD] 4-bit 4MHz failed, trying 1-bit 4MHz");
        SD_MMC.end();
        ok = SD_MMC.begin("/sdcard", true, false, 4000);
        if (ok) Serial.println("[SD] Mounted in 1-bit mode");
    } else {
        Serial.println("[SD] Mounted in 4-bit mode");
    }
    if (!ok) {
        _status.mounted = false;
        return false;
    }
    const uint8_t ct = SD_MMC.cardType();
    if (ct == CARD_NONE) {
        SD_MMC.end();
        _status.mounted = false;
        return false;
    }
    _status.mounted        = true;
    _status.faultReported  = false;
    _status.cardType       = ct;
    _status.cardSizeBytes  = SD_MMC.cardSize();
    _status.usedBytes      = SD_MMC.usedBytes();
    _status.recordCount    = countRecords();
    return true;
}

uint32_t SdFifo::countRecords() {
    if (!SD_MMC.exists(kDir)) return 0;
    File dir = SD_MMC.open(kDir);
    if (!dir || !dir.isDirectory()) return 0;
    uint32_t n = 0;
    File f = dir.openNextFile();
    while (f) { n++; f = dir.openNextFile(); }
    return n;
}
