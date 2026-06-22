#include "ota_manager.h"

#include <HTTPClient.h>
#include <Update.h>
#include <WiFiClientSecure.h>

#include "flood_state_machine.h"

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
    Serial.printf("[OTA] Local upload started, size=%u\n", (unsigned)contentLength);
    return true;
}

bool OtaManager::writeChunk(const uint8_t* data, size_t len) {
    if (!_localUploadActive) return false;
    const size_t written = Update.write(const_cast<uint8_t*>(data), len);
    return written == len;
}

bool OtaManager::endLocalUpload(String& reason) {
    _localUploadActive = false;
    _running           = false;
    if (!Update.end(true)) {
        reason = String(Update.errorString());
        Serial.printf("[OTA] Upload failed: %s\n", reason.c_str());
        return false;
    }
    Serial.println("[OTA] Upload complete — rebooting in 2s");
    delay(2000);
    ESP.restart();
    return true;
}

void OtaManager::beginRemoteOta(const char* url) {
    if (!isSafeToOta()) {
        Serial.println("[OTA] Remote blocked: alert/danger or pump active");
        return;
    }
    Serial.printf("[OTA] Remote: %s\n", url);
    _running = true;

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
        Serial.printf("[OTA] HTTP error %d\n", code);
        http.end();
        _running = false;
        return;
    }

    const int total = http.getSize();
    WiFiClient* stream = http.getStreamPtr();

    if (!Update.begin(total > 0 ? (size_t)total : UPDATE_SIZE_UNKNOWN)) {
        Serial.printf("[OTA] Update.begin failed: %s\n", Update.errorString());
        http.end();
        _running = false;
        return;
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
            Serial.printf("[OTA] Write error: %s\n", Update.errorString());
            http.end();
            Update.abort();
            _running = false;
            return;
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
        Serial.printf("[OTA] Finalize failed: %s\n", Update.errorString());
        _running = false;
        return;
    }
    Serial.printf("[OTA] Remote complete (%d bytes) — rebooting in 2s\n", written);
    delay(2000);
    ESP.restart();
}
