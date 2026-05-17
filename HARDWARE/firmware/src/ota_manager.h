#pragma once

#include <Arduino.h>

class OtaManager {
public:
    static OtaManager& getInstance();
    void begin(const char* firmwareVersion);
    void loop(bool dangerActive);

private:
    OtaManager() = default;
    char _currentVersion[32]{};
    unsigned long _lastCheckMs = 0;
};

