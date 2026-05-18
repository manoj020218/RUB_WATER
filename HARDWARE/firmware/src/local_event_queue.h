#pragma once

#include <Arduino.h>

struct QueuedEvent {
    char topic[96];
    char payload[512];
};

class LocalEventQueue {
public:
    static LocalEventQueue& getInstance();

    void begin();
    bool enqueue(const char* topic, const char* payload);
    bool dequeue(QueuedEvent& outEvent);
    size_t size() const;
    bool empty() const;

private:
    LocalEventQueue() = default;
    // 500+ events is the target with external storage/PSRAM.
    // On ESP32-S3 N8 (no PSRAM), keep this lower to fit internal DRAM.
    static constexpr size_t MAX_EVENTS = 250;
    QueuedEvent _events[MAX_EVENTS]{};
    size_t _head = 0;
    size_t _tail = 0;
    size_t _count = 0;
};
