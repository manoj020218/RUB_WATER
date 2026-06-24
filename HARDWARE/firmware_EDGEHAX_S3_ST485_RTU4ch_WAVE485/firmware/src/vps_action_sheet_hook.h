#pragma once

#include <Arduino.h>

class VpsActionSheetHook {
public:
    static VpsActionSheetHook& getInstance();

    void begin(const char* deviceId, const char* hardwareId, const char* deviceToken);
    void loop();

private:
    VpsActionSheetHook() = default;

    char _deviceId[32]{};
    char _hardwareId[32]{};
    char _deviceToken[128]{};
    bool _started = false;
    uint32_t _lastPollMs = 0;

    bool fetchLatestSheet(String& payloadJson, uint32_t& version, String& syncAt);
    bool postReport(const char* status, const char* source, const char* reason = nullptr);
    void publishSheetReportEvent(const char* eventType, const char* source, const char* reason = nullptr);
};
