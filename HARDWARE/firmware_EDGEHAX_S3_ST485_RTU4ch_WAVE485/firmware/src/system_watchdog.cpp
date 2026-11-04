#include "system_watchdog.h"

#include <esp_system.h>
#include <esp_task_wdt.h>

#include "flood_state_machine.h"
#include "local_webserver.h"
#include "mqtt_manager.h"
#include "ota_manager.h"
#include "wifi_manager.h"

// Survives a software reset / watchdog reset (not a power cycle).
static constexpr uint32_t kRtcMagic = 0xF6D0A002UL;
RTC_NOINIT_ATTR static uint32_t sRtcMagic;
RTC_NOINIT_ATTR static uint32_t sRtcConnRebootCount;
RTC_NOINIT_ATTR static char sRtcSelfRestartCause[24];

static bool sWdtSubscribed = false;
static char sLastSelfRestartCause[24] = "";
static uint32_t sConnRebootCount = 0;

static constexpr uint32_t kConnWatchdogBaseMs = 30UL * 60UL * 1000UL;   // 30 min
static constexpr uint32_t kConnWatchdogMaxMs  = 4UL * 60UL * 60UL * 1000UL; // 4 h
static uint32_t sMqttLostSinceMs = 0;
static bool sMqttWasConnected = false;
static uint32_t sLastConnCheckMs = 0;

const char* systemResetReasonStr() {
    switch (esp_reset_reason()) {
        case ESP_RST_POWERON:   return "POWERON";
        case ESP_RST_EXT:       return "EXTERNAL";
        case ESP_RST_SW:        return "SOFTWARE";
        case ESP_RST_PANIC:     return "PANIC";
        case ESP_RST_INT_WDT:   return "INT_WDT";
        case ESP_RST_TASK_WDT:  return "TASK_WDT";
        case ESP_RST_WDT:       return "OTHER_WDT";
        case ESP_RST_DEEPSLEEP: return "DEEPSLEEP";
        case ESP_RST_BROWNOUT:  return "BROWNOUT";
        case ESP_RST_SDIO:      return "SDIO";
        default:                return "UNKNOWN";
    }
}

const char* systemLastSelfRestartCause() { return sLastSelfRestartCause; }
uint32_t systemConnWatchdogRebootCount() { return sConnRebootCount; }

void systemWatchdogBegin() {
    // Recover RTC-retained state from the previous run.
    if (sRtcMagic == kRtcMagic && esp_reset_reason() != ESP_RST_POWERON) {
        sConnRebootCount = sRtcConnRebootCount;
        sRtcSelfRestartCause[sizeof(sRtcSelfRestartCause) - 1] = '\0';
        strncpy(sLastSelfRestartCause, sRtcSelfRestartCause, sizeof(sLastSelfRestartCause) - 1);
    } else {
        sConnRebootCount = 0;
    }
    sRtcMagic = kRtcMagic;
    sRtcConnRebootCount = sConnRebootCount;
    sRtcSelfRestartCause[0] = '\0';  // consumed; set again only right before a self-restart

    // (Re)configure the task watchdog: panic → reboot when not fed in time.
    // IDF 4.4: if already initialised by the core this updates timeout/panic.
    esp_task_wdt_init(kTaskWdtTimeoutS, true);
    if (esp_task_wdt_add(nullptr) == ESP_OK) {
        sWdtSubscribed = true;
    }
    Serial.printf("[WDT] task watchdog %lus armed; reset_reason=%s self_restart=%s conn_reboots=%lu\n",
                  (unsigned long)kTaskWdtTimeoutS, systemResetReasonStr(),
                  sLastSelfRestartCause[0] ? sLastSelfRestartCause : "-",
                  (unsigned long)sConnRebootCount);
}

void systemWatchdogFeed() {
    if (sWdtSubscribed) esp_task_wdt_reset();
}

static void selfRestart(const char* cause) {
    strncpy(sRtcSelfRestartCause, cause, sizeof(sRtcSelfRestartCause) - 1);
    sRtcSelfRestartCause[sizeof(sRtcSelfRestartCause) - 1] = '\0';
    sRtcConnRebootCount = sConnRebootCount + 1;
    Serial.printf("[WDT] self-restart: %s\n", cause);
    delay(300);
    ESP.restart();
}

void systemWatchdogLoop() {
    const uint32_t now = millis();
    if ((now - sLastConnCheckMs) < 5000UL) return;
    sLastConnCheckMs = now;

    auto& mqtt = MqttManager::getInstance();
    if (mqtt.isConnected()) {
        sMqttWasConnected = true;
        sMqttLostSinceMs = 0;
        if (sConnRebootCount != 0) {  // healthy again: reset back-off
            sConnRebootCount = 0;
            sRtcConnRebootCount = 0;
        }
        return;
    }

    if (sMqttLostSinceMs == 0) sMqttLostSinceMs = now;

    // Only for a provisioned device that is not being serviced on site.
    if (!WifiManager::getInstance().hasCredentials()) { sMqttLostSinceMs = now; return; }
    if (LocalWebserver::getInstance().isApActive())   { sMqttLostSinceMs = now; return; }
    if (OtaManager::getInstance().isRunning())         { sMqttLostSinceMs = now; return; }
    // Never reboot while the local alarm is active — it works without network.
    if (isAlertOrDanger(FloodStateMachine::getInstance().snapshot().state)) {
        sMqttLostSinceMs = now;
        return;
    }

    const uint8_t shift = (uint8_t)min<uint32_t>(sConnRebootCount, 3);  // 30m,1h,2h,4h
    uint32_t windowMs = kConnWatchdogBaseMs << shift;
    if (windowMs > kConnWatchdogMaxMs) windowMs = kConnWatchdogMaxMs;

    if ((now - sMqttLostSinceMs) >= windowMs) {
        Serial.printf("[WDT] MQTT down %lus (window %lus, ever_connected=%d) — rebooting\n",
                      (unsigned long)((now - sMqttLostSinceMs) / 1000UL),
                      (unsigned long)(windowMs / 1000UL), sMqttWasConnected ? 1 : 0);
        selfRestart("conn_watchdog");
    }
}
