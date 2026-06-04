#include "http_fallback.h"

#include <HTTPClient.h>
#include <WiFiClient.h>

#include "device_profile.h"
#include "wifi_manager.h"

namespace {
constexpr uint32_t kRetryMs = 10000UL;
}

HttpFallback& HttpFallback::getInstance() {
    static HttpFallback inst;
    return inst;
}

void HttpFallback::begin(const char* deviceId, const char* token) {
    strncpy(_deviceId, deviceId, sizeof(_deviceId) - 1);
    strncpy(_token,    token,    sizeof(_token) - 1);
}

bool HttpFallback::queue(const char* type, const char* payload) {
    strncpy(_pendingType,    type,    sizeof(_pendingType)    - 1);
    strncpy(_pendingPayload, payload, sizeof(_pendingPayload) - 1);
    _hasPending = true;
    return true;
}

void HttpFallback::loop() {
    if (!_hasPending) return;
    if (!WifiManager::getInstance().isConnected()) return;
    const uint32_t now = millis();
    if ((now - _lastAttemptMs) < kRetryMs) return;
    _lastAttemptMs = now;
    if (postNow(_pendingType, _pendingPayload)) {
        _hasPending = false;
        _lastOk     = true;
    }
}

bool HttpFallback::postNow(const char* type, const char* payload) {
    char url[128];
    snprintf(url, sizeof(url), "%s/api/device/%s/%s",
             DEFAULT_HTTP_BASE_URL, _deviceId,
             strcmp(type, "event") == 0 ? "event" : "telemetry");

    WiFiClient client;
    HTTPClient http;
    http.setTimeout(8000);
    http.setConnectTimeout(5000);
    if (!http.begin(client, url)) return false;
    http.addHeader("Content-Type", "application/json");
    http.addHeader("x-device-token", _token);
    const int code = http.POST(payload);
    http.end();
    return code >= 200 && code < 300;
}
