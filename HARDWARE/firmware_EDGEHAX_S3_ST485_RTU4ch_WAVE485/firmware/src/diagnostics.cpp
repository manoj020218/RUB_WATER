#include "diagnostics.h"

#include "device_profile.h"

namespace {
uint32_t gMinFreeHeap = UINT32_MAX;
}

void diagnosticsRunBootTests() {
    Serial.println("[DIAG] === Boot Self-Tests ===");

    // Relay pins: verify they can be driven without ESP panic
    const int relays[] = { PIN_RELAY_SIREN, PIN_RELAY_FLASH, PIN_RELAY_VOICE_FUTURE };
    for (int p : relays) {
        if (digitalRead(p) != RELAY_OFF_LEVEL) {
            Serial.printf("[DIAG] FAIL: relay GPIO%d not at OFF level on boot\n", p);
        }
    }

    Serial.printf("[DIAG] Free heap:  %u bytes\n", ESP.getFreeHeap());
    Serial.printf("[DIAG] PSRAM size: %u bytes\n", ESP.getPsramSize());
    Serial.printf("[DIAG] Flash size: %u bytes\n", ESP.getFlashChipSize());
    Serial.printf("[DIAG] CPU freq:   %u MHz\n",  ESP.getCpuFreqMHz());
    Serial.printf("[DIAG] Reset reason: %d\n",    (int)esp_reset_reason());
    Serial.println("[DIAG] === Boot Self-Tests Done ===");
}

void diagnosticsLoop() {
    const uint32_t h = ESP.getFreeHeap();
    if (h < gMinFreeHeap) gMinFreeHeap = h;
}

uint32_t diagnosticsMinFreeHeap() { return gMinFreeHeap; }
