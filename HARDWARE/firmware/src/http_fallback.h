#pragma once

#include <Arduino.h>
#include <HTTPClient.h>

class HttpFallbackService {
public:
    static HttpFallbackService& getInstance();

    void begin(const char* baseUrl, const char* deviceId);
    void updateCloudAuth(const char* baseUrl, const char* deviceToken, bool persistToNvs = true);
    bool postTelemetry(const char* payload);
    bool postEvent(const char* payload);
    bool postCommandAck(const char* commandAckPayload);
    bool postConfigAck(const char* configAckPayload);
    bool fetchPendingCommand(String& outCommand, String& outPayload);
    bool isVpsReachable() const { return _vpsReachable; }

private:
    HttpFallbackService() = default;
    char _baseUrl[128]{};
    char _deviceId[32]{};
    char _deviceToken[160]{};
    unsigned long _lastPollMs = 0;
    bool _vpsReachable = false;

    void loadPersistedCloudAuth();
    void persistCloudAuth();
    void applyAuthHeaders(HTTPClient& client);
    bool postJson(const String& path, const char* payload);
};
