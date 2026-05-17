#pragma once

#include <Arduino.h>

class WatchdogService {
public:
    static WatchdogService& getInstance();
    void begin();
    void feed();
    void loop();

private:
    WatchdogService() = default;
    unsigned long _lastFeedMs = 0;
};

