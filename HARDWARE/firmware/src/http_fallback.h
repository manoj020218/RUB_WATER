#pragma once

#include <Arduino.h>

class HttpFallbackService {
public:
    static HttpFallbackService& getInstance();

    void begin(const char* baseUrl, const char* deviceId);
    bool postTelemetry(const char* payload);
    bool postEvent(const char* payload);
    bool postCommandAck(const char* commandAckPayload);

private:
    HttpFallbackService() = default;
    char _baseUrl[128]{};
    char _deviceId[32]{};

    bool postJson(const String& path, const char* payload);
};

