#include "internal_flash_fifo.h"

InternalFlashFifo& InternalFlashFifo::getInstance() {
    static InternalFlashFifo inst;
    return inst;
}

void InternalFlashFifo::begin() {
    if (!_buf) {
        // Allocate in PSRAM when available to preserve internal heap for networking
        _buf = (FifoRecord*)ps_malloc(sizeof(FifoRecord) * kCapacity);
        if (!_buf) {
            _buf = (FifoRecord*)malloc(sizeof(FifoRecord) * kCapacity);
        }
    }
    _head  = 0;
    _tail  = 0;
    _count = 0;
    Serial.printf("[FIFO] Internal FIFO ready, capacity=%u records (%.1f KB)\n",
                  kCapacity, (sizeof(FifoRecord) * kCapacity) / 1024.0f);
}

bool InternalFlashFifo::push(const char* type, const char* payload) {
    if (!_buf) return false;
    if (_count >= kCapacity) {
        // Drop oldest to make room (oldest-first eviction when full)
        _head  = (_head + 1) % kCapacity;
        _count--;
    }
    FifoRecord& r = _buf[_tail];
    r.timestampMs = millis();
    strncpy(r.type,    type,    sizeof(r.type)    - 1); r.type[sizeof(r.type)-1]    = '\0';
    strncpy(r.payload, payload, sizeof(r.payload) - 1); r.payload[sizeof(r.payload)-1] = '\0';
    _tail  = (_tail + 1) % kCapacity;
    _count++;
    return true;
}

bool InternalFlashFifo::peek(FifoRecord& out) const {
    if (!_buf || _count == 0) return false;
    out = _buf[_head];
    return true;
}

bool InternalFlashFifo::pop() {
    if (_count == 0) return false;
    _head  = (_head + 1) % kCapacity;
    _count--;
    return true;
}

void InternalFlashFifo::clear() {
    _head  = 0;
    _tail  = 0;
    _count = 0;
}
