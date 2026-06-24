#pragma once

#include <Arduino.h>

struct FifoRecord {
    uint32_t timestampMs;
    char     type[16];     // "telemetry" or "event"
    char     payload[384];
};

// 500-record ring buffer in PSRAM/heap for offline queuing when SD is absent.
class InternalFlashFifo {
public:
    static InternalFlashFifo& getInstance();

    void begin();
    bool push(const char* type, const char* payload);
    bool peek(FifoRecord& out) const;
    bool pop();
    void clear();

    uint16_t count() const { return _count; }
    bool     full()  const { return _count >= kCapacity; }

private:
    InternalFlashFifo() = default;
    static constexpr uint16_t kCapacity = 500;
    FifoRecord* _buf = nullptr;
    uint16_t    _head = 0;
    uint16_t    _tail = 0;
    uint16_t    _count = 0;
};
