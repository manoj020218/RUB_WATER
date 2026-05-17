#include "watchdog.h"

WatchdogService& WatchdogService::getInstance() {
    static WatchdogService instance;
    return instance;
}

void WatchdogService::begin() {
    _lastFeedMs = millis();
}

void WatchdogService::feed() {
    _lastFeedMs = millis();
}

void WatchdogService::loop() {
    const unsigned long now = millis();
    if (now - _lastFeedMs > 120000UL) {
        ESP.restart();
    }
}

