#pragma once

#include <Arduino.h>

struct SdStatus {
    bool    mounted;
    bool    faultReported;
    uint8_t cardType;
    uint64_t cardSizeBytes;
    uint64_t usedBytes;
    uint32_t recordCount;
};

// microSD FIFO — SDMMC 4-bit, Edgehax onboard slot.
// Falls back to InternalFlashFifo when SD is absent or faulted.
class SdFifo {
public:
    static SdFifo& getInstance();

    void begin();
    void loop();   // periodic flush/mount retry

    bool push(const char* type, const char* payload);
    bool syncNext(bool mqttOk, bool httpOk);  // transmit oldest record, called by TelemetryManager
    void ack();    // delete last successfully transmitted record

    const SdStatus& status() const { return _status; }

private:
    SdFifo() = default;
    SdStatus _status{};
    uint32_t _lastMountAttemptMs = 0;
    uint32_t _lastWriteMs        = 0;
    bool     _pendingAck         = false;
    char     _ackPath[64]{};

    bool mountCard();
    uint32_t countRecords();
};
