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
    static constexpr size_t MAX_EVENTS = 500;
    QueuedEvent _events[MAX_EVENTS]{};
    size_t _head = 0;
    size_t _tail = 0;
    size_t _count = 0;
};
