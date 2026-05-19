#include "http_fallback.h"

#include <ArduinoJson.h>
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

    HTTPClient client;
    const String url = String(_baseUrl) + "/api/device/" + _deviceId + "/commands/pending";
    if (!client.begin(url)) {
        return false;
    }

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
