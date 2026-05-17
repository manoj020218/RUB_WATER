#include "http_fallback.h"

#include <HTTPClient.h>
#include <cstring>

HttpFallbackService& HttpFallbackService::getInstance() {
    static HttpFallbackService instance;
    return instance;
}

void HttpFallbackService::begin(const char* baseUrl, const char* deviceId) {
    std::memset(_baseUrl, 0, sizeof(_baseUrl));
    std::memset(_deviceId, 0, sizeof(_deviceId));
    std::strncpy(_baseUrl, baseUrl ? baseUrl : "", sizeof(_baseUrl) - 1);
    std::strncpy(_deviceId, deviceId ? deviceId : "", sizeof(_deviceId) - 1);
}

bool HttpFallbackService::postTelemetry(const char* payload) {
    return postJson("/api/device/telemetry", payload);
}

bool HttpFallbackService::postEvent(const char* payload) {
    return postJson("/api/device/event", payload);
}

bool HttpFallbackService::postCommandAck(const char* commandAckPayload) {
    return postJson("/api/device/command_ack", commandAckPayload);
}

bool HttpFallbackService::postJson(const String& path, const char* payload) {
    if (_baseUrl[0] == '\0') {
        return false;
    }

    HTTPClient client;
    const String url = String(_baseUrl) + path;
    if (!client.begin(url)) {
        return false;
    }

    client.addHeader("Content-Type", "application/json");
    const int code = client.POST(payload ? payload : "{}");
    client.end();
    return code >= 200 && code < 300;
}

