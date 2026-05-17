#include "time_sync.h"

#include <time.h>

TimeSyncService& TimeSyncService::getInstance() {
    static TimeSyncService instance;
    return instance;
}

void TimeSyncService::begin() {
    _timeSynced = false;
    _lastSyncAttemptMs = 0;
}

void TimeSyncService::loop(bool wifiConnected) {
    if (!wifiConnected) {
        return;
    }

    const unsigned long now = millis();
    if (now - _lastSyncAttemptMs < 30000UL) {
        return;
    }
    _lastSyncAttemptMs = now;

    configTime(19800, 0, "pool.ntp.org", "time.google.com");
    time_t nowEpoch = time(nullptr);
    _timeSynced = (nowEpoch > 1700000000);
}

bool TimeSyncService::isTimeSynced() const {
    return _timeSynced;
}

