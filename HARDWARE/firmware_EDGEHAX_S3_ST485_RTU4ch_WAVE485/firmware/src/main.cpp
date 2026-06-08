#include <Arduino.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <WiFi.h>
#include <esp_mac.h>

#include "ble_provisioning.h"
#include "config_manager.h"
#include "confirmation_inputs.h"
#include "device_profile.h"
#include "diagnostics.h"
#include "dyp_sensor.h"
#include "flood_state_machine.h"
#include "http_fallback.h"
#include "internal_flash_fifo.h"
#include "local_webserver.h"
#include "mqtt_manager.h"
#include "ota_manager.h"
#include "output_controller.h"
#include "pump_controller.h"
#include "remote_box_manager.h"
#include "sd_fifo.h"
#include "status_led.h"
#include "telemetry_manager.h"
#include "voltage_monitor.h"
#include "wifi_manager.h"

// ── Dynamic loop-task stack sizing ───────────────────────────────────────────
// BLE provisioning needs ~70 KB internal heap. When unprovisioned (no WiFi in
// NVS) we return 24 KB so the task stack stays small and BLE can allocate.
// Once provisioned (WiFi saved) BLE is skipped → use full 65 KB stack.
// DEV builds skip BLE entirely, so always use the full 65 KB stack.
size_t getArduinoLoopTaskStackSize() {
#ifdef DEV_WIFI_SSID
    return 65536;
#else
    Preferences prefs;
    if (prefs.begin(NVS_NS_WIFI, true)) {
        const String ssid = prefs.getString("wifi_ssid", "");
        prefs.end();
        if (ssid.length() > 0 && ssid != "CHANGE_WIFI_SSID") {
            return 65536;
        }
    }
    return 24576;
#endif
}

// ── Globals ───────────────────────────────────────────────────────────────────
static char gDeviceId[32];
static char gDeviceToken[128];
static bool gMqttFirstConnected = false;
static uint32_t gApOpenedMs = 0;
static bool gApReopenedManually = false;

// ── Forward declarations ──────────────────────────────────────────────────────
static void checkConfigButton();
static void checkFactoryReset();
static void updateOutputsFromState();
static void onMqttCommand(const char* topic, const char* payload);
static void checkDailyReboot();

// ── setup ─────────────────────────────────────────────────────────────────────
void setup() {
    Serial.begin(115200);
    delay(300);
    Serial.println("\n=== FloodGuard Edgehax S3 Firmware ===");
    Serial.printf("FW=%s  v%s  %s\n", FIRMWARE_NAME, FIRMWARE_VERSION, FIRMWARE_DATE);
    Serial.printf("PID=%s  HW=%s\n", PRODUCT_PID, HARDWARE_VERSION);

    // Relays and RF must be driven OFF before anything else
    OutputController::getInstance().begin();

    // CONFIG button factory-reset check (hold 5s at power-on)
    checkFactoryReset();

    // Core modules
    ConfigManager::getInstance().begin();
    DypSensor::getInstance().begin();
    ConfirmationInputs::getInstance().begin();
    FloodStateMachine::getInstance().begin();
#ifndef SENSOR_TEST_MODE
    PumpController::getInstance().begin();
    VoltageMonitor::getInstance().begin();
#endif
    StatusLed::getInstance().begin();

#ifndef SENSOR_TEST_MODE
    // Offline storage
    SdFifo::getInstance().begin();
    InternalFlashFifo::getInstance().begin();

    // RTU remote buses
    RemoteBoxManager::getInstance().begin();
#endif

    // Identity (compiled-in build flags)
    strncpy(gDeviceId,    DEVICE_ID_SEED,    sizeof(gDeviceId)    - 1);
    strncpy(gDeviceToken, DEVICE_TOKEN_SEED, sizeof(gDeviceToken) - 1);
    Serial.printf("[MAIN] device_id=%s\n", gDeviceId);

#ifdef SENSOR_TEST_MODE
    Serial.println("[MAIN] *** SENSOR TEST MODE — WiFi/MQTT/BLE/OTA disabled ***");
    Serial.println("[MAIN] Watching: DYP sensor (GPIO21) + L1 (GPIO4) + L2 (GPIO5)");
#else
    // Local maintenance webserver + AP
    char apSsid[32];
    {
        uint8_t mac[6] = {};
        esp_read_mac(mac, ESP_MAC_WIFI_STA);
        snprintf(apSsid, sizeof(apSsid), "FgMain%02X%02X%02X", mac[3], mac[4], mac[5]);
    }
    LocalWebserver::getInstance().begin(apSsid, gDeviceId);

    // WiFi
    auto& wifi = WifiManager::getInstance();
    wifi.setHostname(LocalWebserver::getInstance().mdnsHost());
    wifi.begin();

    // BLE provisioning — only when WiFi not yet configured (dev build skips it)
#ifndef DEV_WIFI_SSID
    if (!wifi.hasCredentials()) {
        BleProvisioning::getInstance().begin();
    }
#endif

    if (!wifi.hasCredentials()) {
        LocalWebserver::getInstance().startAp();
        gApOpenedMs = millis();
    }

    // Cloud services
    MqttManager::getInstance().begin(gDeviceId, gDeviceToken);
    MqttManager::getInstance().setCommandCallback(onMqttCommand);
    HttpFallback::getInstance().begin(gDeviceId, gDeviceToken);
    TelemetryManager::getInstance().begin(gDeviceId);
    OtaManager::getInstance().begin();
#endif  // SENSOR_TEST_MODE

    diagnosticsRunBootTests();
    Serial.println("[MAIN] Setup complete");
}

// ── loop ──────────────────────────────────────────────────────────────────────
void loop() {
#ifdef SENSOR_TEST_MODE
    // ── Sensor-only path ──────────────────────────────────────────────────
    DypSensor::getInstance().loop();
    ConfirmationInputs::getInstance().loop();
    FloodStateMachine::getInstance().loop();
    StatusLed::getInstance().loop();

    static uint32_t sSensorPrintMs = 0;
    const uint32_t nowSt = millis();
    if (nowSt - sSensorPrintMs >= 1000UL) {
        sSensorPrintMs = nowSt;
        const auto& dyp  = DypSensor::getInstance().snapshot();
        const auto& conf = ConfirmationInputs::getInstance().snapshot();
        const auto& fsm  = FloodStateMachine::getInstance().snapshot();
        const auto& cfg  = ConfigManager::getInstance().get();
        Serial.printf(
            "[SENSOR] dist=%4dmm  lvl=%4dmm  valid=%c  |  L1=%c  L2=%c  |  FSM=%-22s  |  alert>=%dmm  danger>=%dmm\n",
            (int)dyp.distanceMm,
            (int)dyp.waterLevelMm,
            dyp.valid ? 'Y' : 'N',
            conf.level1Active ? 'Y' : 'N',
            conf.level2Active ? 'Y' : 'N',
            floodStateStr(fsm.state),
            (int)cfg.alertLevelMm,
            (int)cfg.dangerLevelMm);
    }
    yield();
    return;
#endif

    // ── Safety path (always runs, never blocked) ───────────────────────────
    DypSensor::getInstance().loop();
    ConfirmationInputs::getInstance().loop();
    FloodStateMachine::getInstance().loop();
    updateOutputsFromState();
    PumpController::getInstance().loop();
    StatusLed::getInstance().loop();
    VoltageMonitor::getInstance().loop();

    // ── Connectivity (non-blocking) ────────────────────────────────────────
    WifiManager::getInstance().loop();
    MqttManager::getInstance().loop();
    HttpFallback::getInstance().loop();
    TelemetryManager::getInstance().loop();

    // ── BLE provisioning ───────────────────────────────────────────────────
    auto& ble = BleProvisioning::getInstance();
    if (ble.isStarted()) {
        ble.loop();
        // Disable BLE after first successful WiFi + MQTT connection
        if (!gMqttFirstConnected && MqttManager::getInstance().isConnected()) {
            gMqttFirstConnected = true;
            ble.stop();
            if (!gApReopenedManually) {
                LocalWebserver::getInstance().stopAp();
            }
            Serial.println("[MAIN] Provisioning complete — BLE and AP disabled");
        }
    }

    // ── Maintenance AP ─────────────────────────────────────────────────────
    LocalWebserver::getInstance().loop();

    // ── Remote RTU boxes (slow cadence internally) ─────────────────────────
    RemoteBoxManager::getInstance().loop();

    // ── SD FIFO and offline sync ───────────────────────────────────────────
    SdFifo::getInstance().loop();

    // ── OTA ────────────────────────────────────────────────────────────────
    OtaManager::getInstance().loop();

    // ── CONFIG button for AP maintenance ──────────────────────────────────
    checkConfigButton();

    // ── Daily scheduled reboot ─────────────────────────────────────────────
    checkDailyReboot();

    // ── Diagnostics watermark ──────────────────────────────────────────────
    diagnosticsLoop();

    yield();
}

// ── Output coordinator ────────────────────────────────────────────────────────
static void updateOutputsFromState() {
    const FloodState fs = FloodStateMachine::getInstance().snapshot().state;
    auto& out = OutputController::getInstance();
    auto& rem = RemoteBoxManager::getInstance();

    const bool dangerActive = isDanger(fs);
    const bool alertActive  = isAlertOrDanger(fs);

    out.setSiren(dangerActive);
    out.setFlash(dangerActive);
    out.setRfDangerSiren(dangerActive);
    // Voice/future relay: not activated automatically
    // Pump is managed entirely by PumpController

    // Command remote boxes
    if (alertActive) {
        rem.setSirenFlash(dangerActive, dangerActive);
    } else {
        rem.setSirenFlash(false, false);
    }
}

// ── MQTT command handler ──────────────────────────────────────────────────────
static void onMqttCommand(const char* topic, const char* payload) {
    Serial.printf("[CMD] topic=%s payload=%s\n", topic, payload);

    StaticJsonDocument<256> doc;
    if (deserializeJson(doc, payload) != DeserializationError::Ok) return;

    const String cmd = String(doc["cmd"] | "");
    if (cmd == "pump_on")  { PumpController::getInstance().setManualOn(); }
    if (cmd == "pump_off") { PumpController::getInstance().setManualOff(); }
    if (cmd == "pump_auto") { PumpController::getInstance().setAutoMode(); }

    if (cmd == "config_update") {
        String reason;
        char buf[512];
        serializeJson(doc["config"], buf, sizeof(buf));
        ConfigManager::getInstance().applyJson(buf, reason);
    }
    if (cmd == "reboot") {
        Serial.println("[CMD] Remote reboot requested");
        delay(500);
        ESP.restart();
    }
}

// ── CONFIG button ─────────────────────────────────────────────────────────────
static bool sConfigBtnPrev = false;
static uint32_t sConfigBtnDownMs = 0;
static bool sConfigBtn5sHandled = false;

static void checkConfigButton() {
    const bool pressed = (digitalRead(PIN_CONFIG_BUTTON) == LOW);
    const uint32_t now = millis();

    if (pressed && !sConfigBtnPrev) {
        sConfigBtnDownMs     = now;
        sConfigBtn5sHandled  = false;
        pinMode(PIN_CONFIG_BUTTON, INPUT_PULLUP);
    }

    if (pressed) {
        const uint32_t held = now - sConfigBtnDownMs;
        if (!sConfigBtn5sHandled && held >= 5000UL) {
            sConfigBtn5sHandled = true;
            gApReopenedManually = true;
            LocalWebserver::getInstance().startAp(900000UL);  // 15 min
            Serial.println("[BTN] CONFIG held 5s — AP opened for 15 min");
        }
        // 15s hold opens factory-reset page (handled via webserver /factory-reset-confirm)
    }
    sConfigBtnPrev = pressed;
}

// ── Factory reset check at boot ───────────────────────────────────────────────
static void checkFactoryReset() {
    pinMode(PIN_CONFIG_BUTTON, INPUT_PULLUP);
    if (digitalRead(PIN_CONFIG_BUTTON) != LOW) return;
    Serial.println("[RESET] CONFIG held — keep holding 5s to factory reset...");
    const uint32_t t0 = millis();
    while (millis() - t0 < 5000UL) {
        if (digitalRead(PIN_CONFIG_BUTTON) != LOW) {
            Serial.println("[RESET] Released — normal boot");
            return;
        }
        delay(100);
    }
    Serial.println("[RESET] Clearing WiFi NVS...");
    Preferences prefs;
    prefs.begin(NVS_NS_WIFI, false);
    prefs.clear();
    prefs.end();
    Serial.println("[RESET] Done — rebooting into BLE provisioning");
    delay(500);
    ESP.restart();
}

// ── Daily scheduled reboot ────────────────────────────────────────────────────
static uint32_t sLastRebootCheckMs = 0;

static void checkDailyReboot() {
    // Reboot is time-based. Since we have no RTC, use uptime as a proxy:
    // reboot once per day at roughly the configured hour offset from boot.
    // For production with NTP you would compare against real-time clock.
    const uint32_t now = millis();
    if ((now - sLastRebootCheckMs) < 60000UL) return;
    sLastRebootCheckMs = now;

    const auto& cfg = ConfigManager::getInstance().get();
    if (!cfg.dailyRebootEnabled) return;

    // Block reboot during active states
    const FloodState fs = FloodStateMachine::getInstance().snapshot().state;
    if (isAlertOrDanger(fs)) return;
    if (PumpController::getInstance().snapshot().running) return;
    if (OtaManager::getInstance().isRunning()) return;

    // Reboot after 24h of uptime at roughly the scheduled time
    const uint32_t uptimeS = now / 1000UL;
    const uint32_t targetS = (uint32_t)cfg.dailyRebootHour * 3600UL
                           + (uint32_t)cfg.dailyRebootMinute * 60UL;
    const uint32_t oneDayS = 86400UL;

    if (uptimeS > oneDayS && (uptimeS % oneDayS) >= targetS
                          && (uptimeS % oneDayS) < targetS + 120UL) {
        Serial.println("[MAIN] Scheduled daily reboot");
        delay(500);
        ESP.restart();
    }
}
