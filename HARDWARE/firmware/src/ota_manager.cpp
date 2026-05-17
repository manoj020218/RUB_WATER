#include "ota_manager.h"

#include <cstring>

OtaManager& OtaManager::getInstance() {
    static OtaManager instance;
    return instance;
}

void OtaManager::begin(const char* firmwareVersion) {
    std::memset(_currentVersion, 0, sizeof(_currentVersion));
    std::strncpy(_currentVersion, firmwareVersion ? firmwareVersion : "", sizeof(_currentVersion) - 1);
    _lastCheckMs = 0;
}

void OtaManager::loop(bool dangerActive) {
    if (dangerActive) {
        return;
    }

    const unsigned long now = millis();
    if (now - _lastCheckMs < 86400000UL) {
        return;
    }
    _lastCheckMs = now;
}

