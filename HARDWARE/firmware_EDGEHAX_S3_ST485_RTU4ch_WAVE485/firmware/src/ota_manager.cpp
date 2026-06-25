#include "ota_manager.h"

#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <Update.h>
#include <WiFiClientSecure.h>

#include "flood_state_machine.h"
#include "mqtt_manager.h"

OtaManager& OtaManager::getInstance() {
    static OtaManager inst;
    return inst;
}

void OtaManager::begin() {
    Serial.println("[OTA] Manager ready");
}

void OtaManager::loop() {
    // Remote OTA check can be added here; local upload handled via webserver
}

bool OtaManager::isSafeToOta() const {
    const FloodState fs = FloodStateMachine::getInstance().snapshot().state;
    // Only block on confirmed active flood — mismatch/fault states are not emergencies
    if (fs == FloodState::ALERT_CONFIRMED    ||
        fs == FloodState::DANGER_CONFIRMED   ||
        fs == FloodState::DANGER_WAITING_FOR_CONFIRMATION ||
        fs == FloodState::DANGER_WITH_CONFIRMATION_MISMATCH ||
        fs == FloodState::DANGER_WITH_PRIMARY_SENSOR_FAULT) return false;
    return true;
}

bool OtaManager::beginLocalUpload(size_t contentLength) {
    if (!isSafeToOta()) {
        Serial.println("[OTA] Blocked: alert/danger active");
        return false;
    }
    // upload.totalSize is 0 at UPLOAD_FILE_START in ESP32 WebServer; use UNKNOWN
    const size_t sz = (contentLength > 0) ? contentLength : UPDATE_SIZE_UNKNOWN;
    if (!Update.begin(sz)) {
        Serial.printf("[OTA] Update.begin failed: %s\n", Update.errorString());
        return false;
    }
    _running            = true;
    _localUploadActive  = true;
    _lastLocalOk        = false;
    _lastLocalError     = String();
    Serial.printf("[OTA] Local upload started, size=%u\n", (unsigned)contentLength);
    return true;
}

bool OtaManager::writeChunk(const uint8_t* data, size_t len) {
    if (!_localUploadActive) return false;
    const size_t written = Update.write(const_cast<uint8_t*>(data), len);
    if (written != len) {
        Update.abort();
        _lastLocalError = String("chunk write error: ") + Update.errorString();
        _localUploadActive = false;
        return false;
    }
    return true;
}

bool OtaManager::endLocalUpload(String& reason) {
    _localUploadActive = false;
    _running           = false;
    if (!Update.end(true)) {
        reason          = String(Update.errorString());
        _lastLocalOk    = false;
        _lastLocalError = reason;
        Serial.printf("[OTA] Upload failed: %s\n", reason.c_str());
        return false;
    }
    _lastLocalOk    = true;
    _lastLocalError = String();
    Serial.println("[OTA] Upload complete — webserver will reboot after response");
    return true;
}

bool OtaManager::beginRemoteOta(const char* url, const char* commandId) {
    if (!isSafeToOta()) {
        _lastRemoteError = "ota_blocked_state";
        Serial.println("[OTA] Remote blocked: alert/danger or pump active");
        return false;
    }
    Serial.printf("[OTA] Remote: %s\n", url);
    _running = true;
    _lastRemoteError = String();

    WiFiClientSecure tlsClient;
    tlsClient.setInsecure();  // skip cert verify — good enough for internal VPS
    HTTPClient http;
    const bool isHttps = strncmp(url, "https", 5) == 0;
    if (isHttps) {
        http.begin(tlsClient, url);
    } else {
        http.begin(url);
    }
    http.setTimeout(60000);
    const int code = http.GET();
    if (code != HTTP_CODE_OK) {
        _lastRemoteError = String("http_error_") + code;
        Serial.printf("[OTA] HTTP error %d\n", code);
        http.end();
        _running = false;
        return false;
    }

    const int total = http.getSize();
    WiFiClient* stream = http.getStreamPtr();

    if (!Update.begin(total > 0 ? (size_t)total : UPDATE_SIZE_UNKNOWN)) {
        _lastRemoteError = String("begin_failed: ") + Update.errorString();
        Serial.printf("[OTA] Update.begin failed: %s\n", Update.errorString());
        http.end();
        _running = false;
        return false;
    }

    uint8_t buf[1024];
    int written = 0;
    uint32_t lastPrint = millis();
    while (http.connected() && (total < 0 || written < total)) {
        const int avail = stream->available();
        if (!avail) { delay(1); continue; }
        const int r = stream->readBytes(buf, min(avail, (int)sizeof(buf)));
        if (r <= 0) break;
        if (Update.write(buf, (size_t)r) != (size_t)r) {
            _lastRemoteError = String("write_error: ") + Update.errorString();
            Serial.printf("[OTA] Write error: %s\n", Update.errorString());
            http.end();
            Update.abort();
            _running = false;
            return false;
        }
        written += r;
        if (millis() - lastPrint >= 2000UL) {
            lastPrint = millis();
            if (total > 0) Serial.printf("[OTA] %d/%d bytes (%.0f%%)\n", written, total, 100.0f * written / total);
            else           Serial.printf("[OTA] %d bytes\n", written);
        }
    }
    http.end();

    if (!Update.end(true)) {
        _lastRemoteError = String("finalize_failed: ") + Update.errorString();
        Serial.printf("[OTA] Finalize failed: %s\n", Update.errorString());
        _running = false;
        return false;
    }

    // Best-effort ACK before reboot — MQTT connection may have timed out during long download
    {
        auto& mqtt = MqttManager::getInstance();
        StaticJsonDocument<256> ackDoc;
        ackDoc["device_id"]  = mqtt.deviceId();
        ackDoc["hardware_id"] = mqtt.hardwareId();
        ackDoc["cmd"]        = "ota";
        ackDoc["status"]     = "SUCCESS";
        ackDoc["success"]    = true;
        ackDoc["bytes"]      = written;
        if (commandId && commandId[0]) ackDoc["command_id"] = commandId;
        char ackBuf[256];
        serializeJson(ackDoc, ackBuf, sizeof(ackBuf));
        if (mqtt.publish(mqtt.commandAckTopic().c_str(), ackBuf)) {
            delay(500);  // brief window for TCP to flush the ACK packet
        }
    }

    Serial.printf("[OTA] Remote complete (%d bytes) — rebooting in 2s\n", written);
    delay(2000);
    ESP.restart();
    return true;  // unreachable — kept for return type completeness
}
