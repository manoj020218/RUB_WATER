#pragma once

#include <Arduino.h>

class TimeSyncService {
public:
    static TimeSyncService& getInstance();
    void begin();
    void loop(bool wifiConnected);
    bool isTimeSynced() const;

private:
    TimeSyncService() = default;
    bool _timeSynced = false;
    unsigned long _lastSyncAttemptMs = 0;
};

