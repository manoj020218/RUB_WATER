#pragma once

#include <Arduino.h>

class HttpFallbackService {
public:
    static HttpFallbackService& getInstance();

    void begin(const char* baseUrl, const char* deviceId);
    bool postTelemetry(const char* payload);
    bool postEvent(const char* payload);
    bool postCommandAck(const char* commandAckPayload);
    bool postConfigAck(const char* configAckPayload);
    bool fetchPendingCommand(String& outCommand, String& outPayload);

private:
    HttpFallbackService() = default;
    char _baseUrl[128]{};
    char _deviceId[32]{};
    unsigned long _lastPollMs = 0;

    bool postJson(const String& path, const char* payload);
};
