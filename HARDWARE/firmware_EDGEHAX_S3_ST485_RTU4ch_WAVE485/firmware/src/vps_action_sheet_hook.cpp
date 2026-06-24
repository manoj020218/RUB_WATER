#include "vps_action_sheet_hook.h"

#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>

#include "alert_action_sheet.h"
#include "device_profile.h"
#include "telemetry_manager.h"
#include "wifi_manager.h"

namespace {
constexpr uint32_t kPollIntervalMs = 60000UL;
constexpr uint16_t kHttpConnectTimeoutMs = 8000;
constexpr uint16_t kHttpReadTimeoutMs    = 12000;

const char kApiTlsRootCa[] PROGMEM = R"PEM(
-----BEGIN CERTIFICATE-----
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
-----END CERTIFICATE-----
)PEM";

String apiBaseUrl() {
    return String("https://") + DEFAULT_MQTT_HOST;
}
}

VpsActionSheetHook& VpsActionSheetHook::getInstance() {
    static VpsActionSheetHook inst;
    return inst;
}

void VpsActionSheetHook::begin(const char* deviceId, const char* hardwareId, const char* deviceToken) {
    if (_started) return;
    _started = true;
    strncpy(_deviceId, deviceId, sizeof(_deviceId) - 1);
    strncpy(_hardwareId, hardwareId, sizeof(_hardwareId) - 1);
    strncpy(_deviceToken, deviceToken, sizeof(_deviceToken) - 1);
    Serial.println("[VPS ACT] Ready");
}

void VpsActionSheetHook::loop() {
    if (!_started) return;
    if (!WifiManager::getInstance().isConnected()) return;

    const uint32_t now = millis();
    if ((now - _lastPollMs) < kPollIntervalMs) return;
    _lastPollMs = now;

    String payloadJson;
    String syncAt;
    uint32_t version = 0;
    if (!fetchLatestSheet(payloadJson, version, syncAt)) {
        return;
    }
    if (version == 0 || version <= AlertActionSheetManager::getInstance().version()) {
        return;
    }

    String reason;
    if (!AlertActionSheetManager::getInstance().applyJson(payloadJson.c_str(), reason, "VPS_PULL", syncAt.c_str(), false, true)) {
        Serial.printf("[VPS ACT] apply failed: %s\n", reason.c_str());
        postReport("FAILED", "VPS_PULL", reason.c_str());
        publishSheetReportEvent("DEVICE_ACTION_SHEET_REPORT", "VPS_PULL_FAILED", reason.c_str());
        return;
    }

    Serial.printf("[VPS ACT] synced action sheet version=%lu\n",
                  (unsigned long)AlertActionSheetManager::getInstance().version());
    postReport("SUCCESS", "VPS_PULL", nullptr);
    publishSheetReportEvent("DEVICE_ACTION_SHEET_REPORT", "VPS_PULL", nullptr);
}

bool VpsActionSheetHook::fetchLatestSheet(String& payloadJson, uint32_t& version, String& syncAt) {
    payloadJson = "";
    syncAt = "";
    version = 0;

    WiFiClientSecure client;
    client.setCACert(kApiTlsRootCa);

    HTTPClient http;
    http.setConnectTimeout(kHttpConnectTimeoutMs);
    http.setTimeout(kHttpReadTimeoutMs);
    http.setReuse(false);

    const char* stableRef = _hardwareId[0] ? _hardwareId : _deviceId;
    const String url = apiBaseUrl() + "/api/device/" + stableRef + "/action-sheet"
                     + "?current_version=" + String(AlertActionSheetManager::getInstance().version())
                     + "&device_id=" + String(_deviceId);
    if (!http.begin(client, url)) {
        return false;
    }
    http.addHeader("x-device-token", _deviceToken);
    http.addHeader("x-hardware-id", _hardwareId);

    const int code = http.GET();
    if (code != HTTP_CODE_OK) {
        http.end();
        return false;
    }

    StaticJsonDocument<4096> doc;
    const auto err = deserializeJson(doc, http.getStream());
    http.end();
    if (err != DeserializationError::Ok) {
        return false;
    }

    JsonVariantConst data = doc["data"];
    if (!data["pending"].as<bool>()) {
        return false;
    }

    version = data["action_sheet_version"] | data["current_action_sheet_version"] | 0;
    syncAt = String(data["updated_at"] | data["last_sync_at"] | "");
    if (data["action_sheet"].isNull()) {
        return false;
    }
    serializeJson(data["action_sheet"], payloadJson);
    return payloadJson.length() > 0;
}

bool VpsActionSheetHook::postReport(const char* status, const char* source, const char* reason) {
    WiFiClientSecure client;
    client.setCACert(kApiTlsRootCa);

    HTTPClient http;
    http.setConnectTimeout(kHttpConnectTimeoutMs);
    http.setTimeout(kHttpReadTimeoutMs);
    http.setReuse(false);

    const char* stableRef = _hardwareId[0] ? _hardwareId : _deviceId;
    const String url = apiBaseUrl() + "/api/device/" + stableRef + "/action-sheet/report";
    if (!http.begin(client, url)) {
        return false;
    }
    http.addHeader("Content-Type", "application/json");
    http.addHeader("x-device-token", _deviceToken);
    http.addHeader("x-hardware-id", _hardwareId);

    static char sheetJson[2048];
    if (!AlertActionSheetManager::getInstance().buildJson(sheetJson, sizeof(sheetJson))) {
        http.end();
        return false;
    }

    static StaticJsonDocument<3072> doc;
    doc.clear();
    doc["device_id"] = _deviceId;
    doc["hardware_id"] = _hardwareId;
    doc["status"] = status;
    doc["source"] = source;
    doc["action_sheet_version"] = AlertActionSheetManager::getInstance().version();
    static StaticJsonDocument<2048> sheetDoc;
    if (deserializeJson(sheetDoc, sheetJson) == DeserializationError::Ok) {
        doc["action_sheet"] = sheetDoc.as<JsonVariantConst>();
    }
    if (reason && reason[0]) {
        doc["reason"] = reason;
    }

    String body;
    serializeJson(doc, body);
    const int code = http.POST(body);
    http.end();
    return code >= 200 && code < 300;
}

void VpsActionSheetHook::publishSheetReportEvent(const char* eventType, const char* source, const char* reason) {
    static char sheetJson[2048];
    if (!AlertActionSheetManager::getInstance().buildJson(sheetJson, sizeof(sheetJson))) {
        return;
    }

    static StaticJsonDocument<3072> doc;
    doc.clear();
    doc["device_id"] = _deviceId;
    doc["hardware_id"] = _hardwareId;
    doc["event_type"] = eventType;
    doc["action_sheet_version"] = AlertActionSheetManager::getInstance().version();
    doc["source"] = source;

    JsonObject details = doc.createNestedObject("details");
    details["action_sheet_version"] = AlertActionSheetManager::getInstance().version();
    details["source"] = source;
    if (reason && reason[0]) {
        details["reason"] = reason;
        doc["reason"] = reason;
    }

    static StaticJsonDocument<2048> sheetDoc;
    if (deserializeJson(sheetDoc, sheetJson) == DeserializationError::Ok) {
        details["action_sheet"] = sheetDoc.as<JsonVariantConst>();
    }

    static char payload[3072];
    serializeJson(doc, payload, sizeof(payload));
    TelemetryManager::getInstance().publishEventPayload(payload);
}
