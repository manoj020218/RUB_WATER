#include "local_event_queue.h"

#include <cstring>

LocalEventQueue& LocalEventQueue::getInstance() {
    static LocalEventQueue instance;
    return instance;
}

void LocalEventQueue::begin() {
    _head = 0;
    _tail = 0;
    _count = 0;
}

bool LocalEventQueue::enqueue(const char* topic, const char* payload) {
    if (_count >= MAX_EVENTS) {
        return false;
    }
    if (!topic || !payload) {
        return false;
    }
    if (std::strlen(topic) >= sizeof(_events[_tail].topic) ||
        std::strlen(payload) >= sizeof(_events[_tail].payload)) {
        return false;
    }

    std::memset(&_events[_tail], 0, sizeof(QueuedEvent));
    std::strncpy(_events[_tail].topic, topic, sizeof(_events[_tail].topic) - 1);
    std::strncpy(_events[_tail].payload, payload, sizeof(_events[_tail].payload) - 1);

    _tail = (_tail + 1) % MAX_EVENTS;
    ++_count;
    return true;
}

bool LocalEventQueue::dequeue(QueuedEvent& outEvent) {
    if (_count == 0) {
        return false;
    }

    outEvent = _events[_head];
    _head = (_head + 1) % MAX_EVENTS;
    --_count;
    return true;
}

size_t LocalEventQueue::size() const {
    return _count;
}

bool LocalEventQueue::empty() const {
    return _count == 0;
}
