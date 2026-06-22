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
#include "remote_box_manager.h"
#include "sd_fifo.h"
#include "status_led.h"
#include "telemetry_manager.h"
#include "voltage_monitor.h"
#include "vps_ota_hook.h"
#include "wifi_manager.h"

// ── Dynamic loop-task stack sizing ───────────────────────────────────────────
// BLE provisioning needs ~70 KB internal heap. When unprovisioned (no WiFi in
// NVS) we return 24 KB so the task stack stays small and BLE can allocate.
// Once provisioned (WiFi saved) BLE is skipped → use full 65 KB stack.
// DEV builds and ST485 production builds skip BLE or have pre-loaded NVS, so
// always use the full 65 KB stack. The NVS-based check can fail if called before
// NVS is initialised by the bootloader on certain SDK versions.
size_t getArduinoLoopTaskStackSize() {
#if defined(DEV_WIFI_SSID) || defined(ST485_RTU4CH_WAVE485_MODE)
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

// Deferred MQTT event from command callback (reentrancy-safe)
static char  gPendingEvent[192] = {};
static bool  gPendingEventReady = false;
static bool  gPendingReboot     = false;

// MQTT debug state — readable from /api/status
uint32_t gDbgLastCmdMs    = 0;
char     gDbgLastCmdStr[32] = {};
uint32_t gDbgLastEvtMs    = 0;
bool     gDbgEvtConn      = false;
bool     gDbgEvtPubOk     = false;

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

    // Identity — NVS override takes priority over compiled-in seed
    strncpy(gDeviceId,    DEVICE_ID_SEED,    sizeof(gDeviceId)    - 1);
    strncpy(gDeviceToken, DEVICE_TOKEN_SEED, sizeof(gDeviceToken) - 1);
    {
        Preferences idPrefs;
        if (idPrefs.begin(NVS_NS_IDENTITY, true)) {
            String storedId = idPrefs.getString("device_id", "");
            if (storedId.length() > 0 && storedId.length() < sizeof(gDeviceId)) {
                storedId.toCharArray(gDeviceId, sizeof(gDeviceId));
            }
            idPrefs.end();
        }
    }
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
        snprintf(apSsid, sizeof(apSsid), "JXFG%02X%02X%02X", mac[3], mac[4], mac[5]);
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
    VpsOtaHook::getInstance().begin(gDeviceId, gDeviceToken);
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
    StatusLed::getInstance().loop();
    VoltageMonitor::getInstance().loop();

    // ── Connectivity (non-blocking) ────────────────────────────────────────
    WifiManager::getInstance().loop();

    // Wrong-password / connect-timeout → open AP so user can re-provision
    {
        static bool sFallbackApOpened = false;
        auto& wifi = WifiManager::getInstance();
        auto& lws  = LocalWebserver::getInstance();
        if (!sFallbackApOpened && wifi.isConnectTimedOut() && !lws.isApActive()) {
            sFallbackApOpened = true;
            lws.startAp(600000UL);  // 10 min
            gApOpenedMs = millis();
            Serial.println("[MAIN] WiFi connect timeout — AP opened for re-provisioning (10 min)");
        }
        // Close fallback AP once WiFi reconnects (password was corrected via AP)
        if (sFallbackApOpened && !gApReopenedManually && wifi.isConnected() && lws.isApActive()) {
            sFallbackApOpened = false;
            lws.stopAp();
            Serial.println("[MAIN] WiFi reconnected — closing fallback AP");
        }
    }

    MqttManager::getInstance().loop();

    // Deferred MQTT actions — outside PubSubClient callback to avoid buffer reentrancy.
    // Retries on every loop until publish() succeeds or the flag is cleared by reboot.
    if (gPendingEventReady) {
        auto& mqtt   = MqttManager::getInstance();
        bool  conn   = mqtt.isConnected();
        bool  ok     = false;
        if (conn) {
            ok = mqtt.publish(mqtt.eventTopic().c_str(), gPendingEvent);
            if (ok) gPendingEventReady = false;
        }
        gDbgEvtConn   = conn;
        gDbgEvtPubOk  = ok;
        gDbgLastEvtMs = millis();
        Serial.printf("[EVT] conn=%d pub=%d payload=%s\n", conn, ok, gPendingEvent);
    }
    if (gPendingReboot) {
        gPendingReboot = false;
        if (gPendingEventReady) {
            // Best-effort flush before reboot — clear flag regardless of result
            MqttManager::getInstance().publish(
                MqttManager::getInstance().eventTopic().c_str(), gPendingEvent);
            gPendingEventReady = false;
        }
        Serial.println("[MAIN] Executing deferred reboot");
        delay(500);
        ESP.restart();
    }

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
    VpsOtaHook::getInstance().loop();

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
    // Voice/future relay: not activated automatically

    // Command remote boxes
    if (alertActive) {
        rem.setSirenFlash(dangerActive, dangerActive);
    } else {
        rem.setSirenFlash(false, false);
    }
}

// ── MQTT command handler ──────────────────────────────────────────────────────
// NOTE: Do NOT call MqttManager::publish() here — PubSubClient reentrancy bug:
// publish() overwrites the internal buffer[] that loop() is still using for PUBACK.
// Instead set gPendingEvent/gPendingReboot flags; the main loop flushes them.
static void onMqttCommand(const char* topic, const char* payload) {
    gDbgLastCmdMs = millis();
    strncpy(gDbgLastCmdStr, payload, sizeof(gDbgLastCmdStr) - 1);
    gDbgLastCmdStr[sizeof(gDbgLastCmdStr) - 1] = '\0';
    Serial.printf("[CMD] topic=%s payload=%s\n", topic, payload);

    StaticJsonDocument<512> doc;
    if (deserializeJson(doc, payload) != DeserializationError::Ok) {
        Serial.printf("[CMD] JSON parse FAILED: %s\n", payload);
        snprintf(gPendingEvent, sizeof(gPendingEvent),
                 "{\"type\":\"cmd_err\",\"reason\":\"json_fail\",\"uptime\":%lu}", millis()/1000UL);
        gPendingEventReady = true;
        return;
    }

    const char* cmdRaw = doc["cmd"] | "";
    const String cmd   = String(cmdRaw);
    Serial.printf("[CMD] cmd=%s\n", cmdRaw);

    // Queue ack event — will be published from main loop after PUBACK is sent
    snprintf(gPendingEvent, sizeof(gPendingEvent),
             "{\"type\":\"cmd_ack\",\"cmd\":\"%s\",\"uptime\":%lu}", cmdRaw, millis()/1000UL);
    gPendingEventReady = true;

    if (cmd == "ping") {
        Serial.println("[CMD] Ping OK");
    }
    if (cmd == "config_update") {
        String reason;
        char buf[512];
        serializeJson(doc["config"], buf, sizeof(buf));
        ConfigManager::getInstance().applyJson(buf, reason);
    }
    if (cmd == "reboot") {
        Serial.println("[CMD] Remote reboot — will restart after PUBACK");
        gPendingReboot = true;
    }
    if (cmd == "ota") {
        const char* url = doc["url"] | "";
        if (strlen(url) > 0) {
            Serial.printf("[CMD] OTA from VPS: %s\n", url);
            OtaManager::getInstance().beginRemoteOta(url);
        }
    }
    // {"cmd":"relay","bus":"right","coil":0,"state":true}
    // bus: "left" | "right"   coil: 0-3   state: true/false
    if (cmd == "relay") {
        const String bus   = String(doc["bus"] | "right");
        const uint8_t coil = (uint8_t)constrain((int)(doc["coil"] | 0), 0, 3);
        const bool    on   = (bool)(doc["state"] | false);
        const RtuBus  rb   = (bus == "left") ? RtuBus::LEFT : RtuBus::RIGHT;
        Serial.printf("[CMD] RTU relay bus=%s coil=%d state=%d\n", bus.c_str(), coil, on);
        RemoteBoxManager::getInstance().manualSetSingleRelay(rb, coil, on);
    }
    if (cmd == "relay_all_off") {
        const String bus = String(doc["bus"] | "right");
        const RtuBus rb  = (bus == "left") ? RtuBus::LEFT : RtuBus::RIGHT;
        Serial.printf("[CMD] RTU all-off bus=%s\n", bus.c_str());
        RemoteBoxManager::getInstance().manualSetSirenFlash(rb, false, false);
    }
    // {"cmd":"calibrate_zero"} — set water-zero from current DYP distance
    if (cmd == "calibrate_zero") {
        String reason;
        if (DypSensor::getInstance().setZeroFromCurrentReading(reason)) {
            const uint16_t z = (uint16_t)DypSensor::getInstance().zeroDistanceMm();
            ConfigManager::getInstance().setZeroDistance(z, reason);
            Serial.printf("[CMD] Zero set to %dmm\n", z);
        } else {
            Serial.printf("[CMD] calibrate_zero failed: %s\n", reason.c_str());
        }
    }
    // {"cmd":"calibrate_vmon","actual_v":12.5} — INA219 voltage calibration
    if (cmd == "calibrate_vmon") {
        const float actualV = doc["actual_v"] | 0.0f;
        if (actualV > 1.0f) {
            const auto& vmon = VoltageMonitor::getInstance().snapshot();
            const auto& cfg  = ConfigManager::getInstance().get();
            const float rawV = (vmon.voltage > 0.1f) ? vmon.voltage / cfg.vMonCalFactor : 0.0f;
            if (rawV > 0.5f) {
                char buf[64];
                snprintf(buf, sizeof(buf), "{\"vmon_cal_factor\":%.4f}", actualV / rawV);
                String reason;
                ConfigManager::getInstance().applyJson(buf, reason);
                Serial.printf("[CMD] vmon cal factor updated: %.4f\n", actualV / rawV);
            } else {
                Serial.println("[CMD] calibrate_vmon: INA219 reading too low");
            }
        }
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
