#include "http_fallback.h"

#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <cstring>

namespace {
constexpr const char* kPrefsNamespace = "fgcfg";
constexpr const char* kPrefsHttpBaseUrlKey = "http_base_url";
constexpr const char* kPrefsDeviceTokenKey = "device_token";
constexpr uint32_t kHttpConnectTimeoutMs = 5000;
constexpr uint32_t kHttpRequestTimeoutMs = 8000;

void copyCString(char* out, size_t outSize, const String& value) {
    if (!out || outSize == 0) {
        return;
    }
    std::memset(out, 0, outSize);
    if (value.length() == 0) {
        return;
    }
    std::strncpy(out, value.c_str(), outSize - 1);
}

String normalizeBaseUrl(const String& raw) {
    String out = raw;
    out.trim();
    while (out.endsWith("/")) {
        out.remove(out.length() - 1);
    }
    return out;
}

bool beginHttpRequest(HTTPClient& client, WiFiClient& plainClient, WiFiClientSecure& secureClient, const String& url) {
    client.setConnectTimeout(kHttpConnectTimeoutMs);
    client.setTimeout(kHttpRequestTimeoutMs);
    client.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
    if (url.startsWith("https://")) {
        secureClient.setInsecure();
        return client.begin(secureClient, url);
    }
    return client.begin(plainClient, url);
}
}

HttpFallbackService& HttpFallbackService::getInstance() {
    static HttpFallbackService instance;
    return instance;
}

void HttpFallbackService::begin(const char* baseUrl, const char* deviceId) {
    std::memset(_baseUrl, 0, sizeof(_baseUrl));
    std::memset(_deviceId, 0, sizeof(_deviceId));
    std::memset(_deviceToken, 0, sizeof(_deviceToken));

    std::strncpy(_baseUrl, baseUrl ? baseUrl : "", sizeof(_baseUrl) - 1);
    std::strncpy(_deviceId, deviceId ? deviceId : "", sizeof(_deviceId) - 1);
    loadPersistedCloudAuth();
}

void HttpFallbackService::updateCloudAuth(const char* baseUrl, const char* deviceToken, bool persistToNvs) {
    if (baseUrl != nullptr) {
        const String normalized = normalizeBaseUrl(baseUrl);
        copyCString(_baseUrl, sizeof(_baseUrl), normalized);
    }
    if (deviceToken != nullptr) {
        String token = String(deviceToken);
        token.trim();
        copyCString(_deviceToken, sizeof(_deviceToken), token);
    }
    if (persistToNvs) {
        persistCloudAuth();
    }
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

bool HttpFallbackService::postConfigAck(const char* configAckPayload) {
    return postJson("/api/device/config_ack", configAckPayload);
}

bool HttpFallbackService::fetchPendingCommand(String& outCommand, String& outPayload) {
    outCommand = "";
    outPayload = "";

    if (_baseUrl[0] == '\0' || _deviceId[0] == '\0') {
        return false;
    }

    const unsigned long now = millis();
    if (now - _lastPollMs < 10000UL) {
        return false;
    }
    _lastPollMs = now;

    const String url = String(_baseUrl) + "/api/device/" + _deviceId + "/commands/pending";
    HTTPClient client;
    WiFiClient plainClient;
    WiFiClientSecure secureClient;
    if (!beginHttpRequest(client, plainClient, secureClient, url)) {
        return false;
    }

    applyAuthHeaders(client);
    const int code = client.GET();
    if (code < 200 || code >= 300) {
        client.end();
        return false;
    }

    const String response = client.getString();
    client.end();
    if (response.length() == 0) {
        return false;
    }

    DynamicJsonDocument doc(2048);
    if (deserializeJson(doc, response) != DeserializationError::Ok) {
        return false;
    }

    JsonArray data = doc["data"].as<JsonArray>();
    if (data.isNull() || data.size() == 0) {
        return false;
    }

    JsonObject item = data[0];
    const char* command = item["command"] | "";
    if (command[0] == '\0') {
        return false;
    }

    StaticJsonDocument<1024> payloadDoc;
    payloadDoc["command_id"] = item["command_id"] | "";
    payloadDoc["command"] = command;
    payloadDoc["issued_by"] = item["issued_by"] | "";
    payloadDoc["location_id"] = item["location_id"] | "";
    if (item.containsKey("payload")) {
        payloadDoc["config"] = item["payload"];
    }
    if (item.containsKey("payload") && item["payload"].is<JsonObject>()) {
        JsonObject payloadObj = item["payload"].as<JsonObject>();
        if (payloadObj.containsKey("config")) {
            payloadDoc["config"] = payloadObj["config"];
        }
    }

    char payload[1024]{};
    serializeJson(payloadDoc, payload, sizeof(payload));
    outCommand = String(command);
    outPayload = String(payload);
    return true;
}

bool HttpFallbackService::postJson(const String& path, const char* payload) {
    if (_baseUrl[0] == '\0') {
        return false;
    }

    const String url = String(_baseUrl) + path;
    HTTPClient client;
    WiFiClient plainClient;
    WiFiClientSecure secureClient;
    if (!beginHttpRequest(client, plainClient, secureClient, url)) {
        return false;
    }

    client.addHeader("Content-Type", "application/json");
    applyAuthHeaders(client);
    const int code = client.POST(payload ? payload : "{}");
    client.end();
    return code >= 200 && code < 300;
}

void HttpFallbackService::loadPersistedCloudAuth() {
    Preferences prefs;
    if (!prefs.begin(kPrefsNamespace, true)) {
        return;
    }

    const String savedBaseUrl = normalizeBaseUrl(prefs.getString(kPrefsHttpBaseUrlKey, ""));
    const String savedToken = prefs.getString(kPrefsDeviceTokenKey, "");
    prefs.end();

    if (savedBaseUrl.length() > 0) {
        copyCString(_baseUrl, sizeof(_baseUrl), savedBaseUrl);
    }

    if (savedToken.length() > 0) {
        copyCString(_deviceToken, sizeof(_deviceToken), savedToken);
    }
}

void HttpFallbackService::persistCloudAuth() {
    Preferences prefs;
    if (!prefs.begin(kPrefsNamespace, false)) {
        return;
    }

    prefs.putString(kPrefsHttpBaseUrlKey, String(_baseUrl));
    prefs.putString(kPrefsDeviceTokenKey, String(_deviceToken));
    prefs.end();
}

void HttpFallbackService::applyAuthHeaders(HTTPClient& client) {
    client.addHeader("x-device-id", String(_deviceId));
    if (_deviceToken[0] != '\0') {
        client.addHeader("x-device-key", String(_deviceToken));
        client.addHeader("x-device-token", String(_deviceToken));
    }
}
