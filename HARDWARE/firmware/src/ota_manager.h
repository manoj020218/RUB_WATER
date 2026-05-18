#pragma once

#include <Arduino.h>

#include "config_manager.h"

class OtaManager {
public:
    static OtaManager& getInstance();
    void begin(const DeviceConfig& config);
    void loop(bool dangerActive, bool wifiConnected);

    bool requestCheck(bool applyIfAvailable);
    bool requestDirectUpdate(const char* firmwareUrl, const char* targetVersion);
    bool setOtaHost(const char* hostOrBaseUrl);
    const char* otaHost() const;
    const char* lastStatus() const;

private:
    OtaManager() = default;
    struct UpdateManifest {
        bool updateAvailable = false;
        char version[32]{};
        char firmwareUrl[256]{};
        bool force = false;
    };

    char _productPid[32]{};
    char _hardwareCode[32]{};
    char _deviceId[32]{};
    char _locationId[32]{};
    char _currentVersion[32]{};
    char _otaBaseUrl[128]{};
    char _manifestPath[64]{};
    char _channel[24]{};
    char _pendingUrl[256]{};
    char _pendingVersion[32]{};
    char _status[128]{};

    uint32_t _checkIntervalMs = 86400000UL;
    unsigned long _lastCheckMs = 0;
    bool _pendingCheck = false;
    bool _pendingApply = false;
    bool _pendingDirectUpdate = false;
    bool _updating = false;

    bool runManifestCheck(bool applyIfAvailable);
    bool fetchManifest(UpdateManifest& manifest);
    bool performUpdate(const char* firmwareUrl, const char* targetVersion);
    String buildManifestUrl() const;
    String resolveFirmwareUrl(const char* raw) const;
    static int compareVersion(const char* candidate, const char* current);
    static void copyTrimmed(char* out, size_t outSize, const char* in);
    void setStatus(const char* status);
    void loadPersistedHost();
    void persistHost() const;
};
