#include "ota_manager.h"

#include <Update.h>

#include "flood_state_machine.h"
#include "pump_controller.h"

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
    if (isAlertOrDanger(fs)) return false;
    if (PumpController::getInstance().snapshot().running) return false;
    return true;
}

bool OtaManager::beginLocalUpload(size_t contentLength) {
    if (!isSafeToOta()) {
        Serial.println("[OTA] Blocked: alert/danger or pump active");
        return false;
    }
    if (!Update.begin(contentLength)) {
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
