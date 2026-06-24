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
static char gHardwareId[32];
static char gDeviceToken[128];
static bool gMqttFirstConnected = false;
static uint32_t gApOpenedMs = 0;
static bool gApReopenedManually = false;

struct PendingMqttMessage {
    char topic[96]{};
    char payload[1536]{};
};

static PendingMqttMessage gPendingMqttQueue[6];
static uint8_t gPendingMqttHead = 0;
static uint8_t gPendingMqttTail = 0;
static uint8_t gPendingMqttCount = 0;
static bool gPendingReboot = false;

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
static bool enqueuePendingPublish(const char* topic, const char* payload);
static bool flushOnePendingPublish();
static void buildHardwareId(char* out, size_t outSize);

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
    buildHardwareId(gHardwareId, sizeof(gHardwareId));
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
    Serial.printf("[MAIN] device_id=%s hardware_id=%s\n", gDeviceId, gHardwareId);

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
    LocalWebserver::getInstance().begin(apSsid, gDeviceId, gHardwareId);

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
    MqttManager::getInstance().begin(gDeviceId, gHardwareId, gDeviceToken);
    MqttManager::getInstance().setCommandCallback(onMqttCommand);
    HttpFallback::getInstance().begin(gDeviceId, gHardwareId, gDeviceToken);
    TelemetryManager::getInstance().begin(gDeviceId, gHardwareId);
    OtaManager::getInstance().begin();
    VpsOtaHook::getInstance().begin(gDeviceId, gHardwareId, gDeviceToken);
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
    // Retries until the oldest queued message is published.
    flushOnePendingPublish();
    if (gPendingReboot) {
        gPendingReboot = false;
        while (gPendingMqttCount > 0) {
            if (!flushOnePendingPublish()) break;
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
    const auto& snap = FloodStateMachine::getInstance().snapshot();
    const FloodState fs = snap.state;
    auto& out = OutputController::getInstance();
    auto& rem = RemoteBoxManager::getInstance();

    const bool dangerActive = isDanger(fs);
    const bool alertActive  = isAlertOrDanger(fs);

    out.setSiren(dangerActive);
    out.setFlash(alertActive);
    // Voice/future relay: not activated automatically

    // Command remote boxes
    if (alertActive) {
        rem.setSirenFlash(dangerActive, true);
    } else {
        rem.setSirenFlash(false, false);
    }
}

// ── MQTT command handler ──────────────────────────────────────────────────────
// NOTE: Do NOT call MqttManager::publish() here — PubSubClient reentrancy bug:
// publish() overwrites the internal buffer[] that loop() is still using for PUBACK.
// Instead set gPendingEvent/gPendingReboot flags; the main loop flushes them.
static bool enqueuePendingPublish(const char* topic, const char* payload) {
    if (!topic || !topic[0] || !payload || !payload[0]) return false;
    const size_t queueLen = sizeof(gPendingMqttQueue) / sizeof(gPendingMqttQueue[0]);
    if (gPendingMqttCount >= queueLen) {
        Serial.printf("[MQTT] pending queue full, dropping topic=%s\n", topic);
        return false;
    }

    PendingMqttMessage& slot = gPendingMqttQueue[gPendingMqttTail];
    strncpy(slot.topic, topic, sizeof(slot.topic) - 1);
    slot.topic[sizeof(slot.topic) - 1] = '\0';
    strncpy(slot.payload, payload, sizeof(slot.payload) - 1);
    slot.payload[sizeof(slot.payload) - 1] = '\0';

    gPendingMqttTail = (uint8_t)((gPendingMqttTail + 1U) % queueLen);
    gPendingMqttCount++;
    return true;
}

static bool flushOnePendingPublish() {
    if (gPendingMqttCount == 0) return true;

    auto& mqtt = MqttManager::getInstance();
    const PendingMqttMessage& slot = gPendingMqttQueue[gPendingMqttHead];
    const bool conn = mqtt.isConnected();
    bool ok = false;
    if (conn) {
        ok = mqtt.publish(slot.topic, slot.payload);
    }

    gDbgEvtConn = conn;
    gDbgEvtPubOk = ok;
    gDbgLastEvtMs = millis();
    Serial.printf("[MQTT] flush conn=%d pub=%d topic=%s payload=%s\n",
                  conn ? 1 : 0, ok ? 1 : 0, slot.topic, slot.payload);

    if (!ok) return false;

    const size_t queueLen = sizeof(gPendingMqttQueue) / sizeof(gPendingMqttQueue[0]);
    gPendingMqttHead = (uint8_t)((gPendingMqttHead + 1U) % queueLen);
    gPendingMqttCount--;
    return true;
}

static void onMqttCommand(const char* topic, const char* payload) {
    gDbgLastCmdMs = millis();
    strncpy(gDbgLastCmdStr, payload, sizeof(gDbgLastCmdStr) - 1);
    gDbgLastCmdStr[sizeof(gDbgLastCmdStr) - 1] = '\0';
    Serial.printf("[CMD] topic=%s payload=%s\n", topic, payload);

    StaticJsonDocument<1536> doc;
    String cmd;
    String reason;
    bool success = false;
    if (deserializeJson(doc, payload) != DeserializationError::Ok) {
        reason = "json_fail";
        Serial.printf("[CMD] JSON parse FAILED: %s\n", payload);
    }

    if (reason.length() == 0) {
        const String topicStr = String(topic ? topic : "");
        cmd = doc["cmd"] | doc["command"] | "";
        cmd.trim();
        if (cmd.length() == 0 && topicStr.endsWith("/config")) cmd = "config_update";
        cmd.toLowerCase();
        if (cmd == "update_config") cmd = "config_update";
        Serial.printf("[CMD] cmd=%s\n", cmd.c_str());
    }

    // Queue ack event — will be published from main loop after PUBACK is sent

    if (cmd == "ping") {
        Serial.println("[CMD] Ping OK");
        success = true;
    }
    if (cmd == "config_update") {
        const String oldMode = String(ConfigManager::getInstance().sensorLogicMode());
        const bool rebootAfterConfig = doc["reboot_after_config_update"] | doc["reboot"] | false;
        char cfgBuf[768];
        size_t n = 0;
        if (!doc["config"].isNull()) {
            n = serializeJson(doc["config"], cfgBuf, sizeof(cfgBuf));
        } else {
            n = serializeJson(doc, cfgBuf, sizeof(cfgBuf));
        }
        if (n == 0) {
            reason = "config_payload_empty";
        } else if (ConfigManager::getInstance().applyJson(cfgBuf, reason)) {
            success = true;
            if (oldMode != ConfigManager::getInstance().sensorLogicMode()) {
                TelemetryManager::getInstance().publishEvent("SENSOR_MODE_CHANGED",
                    doc["source"] | "VPS_MQTT");
            }
            if (rebootAfterConfig) {
                gPendingReboot = true;
            }
        }
    }
    if (cmd == "reboot") {
        Serial.println("[CMD] Remote reboot — will restart after PUBACK");
        gPendingReboot = true;
        success = true;
    }
    if (cmd == "ota") {
        const char* url = doc["url"] | "";
        if (!url || !url[0]) {
            reason = "missing_url";
        } else if (!OtaManager::getInstance().isSafeToOta()) {
            reason = "ota_blocked_active_alert";
        } else {
            Serial.printf("[CMD] OTA from VPS: %s\n", url);
            OtaManager::getInstance().beginRemoteOta(url);
            success = true;
        }
    }
    // {"cmd":"relay","bus":"right","coil":0,"state":true}
    // bus: "left" | "right"   coil: 0-3   state: true/false
    if (cmd == "relay") {
        const String bus   = String(doc["bus"] | "right");
        const uint8_t coil = (uint8_t)constrain((int)(doc["coil"] | 0), 0, 3);
        const bool    on   = (bool)(doc["state"] | false);
        const RtuBus  rb   = (bus == "left") ? RtuBus::LEFT : RtuBus::RIGHT;
        Serial.printf("[CMD] RTU relay bus=%s coil=%u state=%d\n", bus.c_str(), coil, on ? 1 : 0);
        success = RemoteBoxManager::getInstance().manualSetSingleRelay(rb, coil, on);
        if (!success) reason = "relay_write_failed";
    }
    if (cmd == "relay_all_off") {
        const String bus = String(doc["bus"] | "right");
        const RtuBus rb  = (bus == "left") ? RtuBus::LEFT : RtuBus::RIGHT;
        Serial.printf("[CMD] RTU all-off bus=%s\n", bus.c_str());
        success = RemoteBoxManager::getInstance().manualSetSirenFlash(rb, false, false);
        if (!success) reason = "relay_write_failed";
    }
    // {"cmd":"calibrate_zero"} — set water-zero from current DYP distance
    if (cmd == "calibrate_zero") {
        if (DypSensor::getInstance().setZeroFromCurrentReading(reason)) {
            const uint16_t z = (uint16_t)DypSensor::getInstance().zeroDistanceMm();
            success = ConfigManager::getInstance().setZeroDistance(z, reason);
            if (success) Serial.printf("[CMD] Zero set to %umm\n", z);
        } else {
            Serial.printf("[CMD] calibrate_zero failed: %s\n", reason.c_str());
        }
        if (!success && reason.length() == 0) reason = "zero_calibration_failed";
    }
    // {"cmd":"calibrate_vmon","actual_v":12.5} — INA219 voltage calibration
    if (cmd == "calibrate_vmon") {
        const float actualV = doc["actual_v"] | doc["actual_voltage"] | 0.0f;
        if (actualV > 1.0f) {
            const auto& vmon = VoltageMonitor::getInstance().snapshot();
            const auto& cfg  = ConfigManager::getInstance().get();
            const float rawV = (vmon.voltage > 0.1f) ? vmon.voltage / cfg.vMonCalFactor : 0.0f;
            if (rawV > 0.5f) {
                char buf[64];
                snprintf(buf, sizeof(buf), "{\"vmon_cal_factor\":%.4f}", actualV / rawV);
                success = ConfigManager::getInstance().applyJson(buf, reason);
                if (success) Serial.printf("[CMD] vmon cal factor updated: %.4f\n", actualV / rawV);
            } else {
                reason = "ina219_reading_too_low";
            }
        } else {
            reason = "actual_voltage_required";
        }
    }

    if (!success && reason.length() == 0) {
        reason = cmd.length() > 0 ? "unknown_command" : "missing_command";
    }

    const char* commandId = doc["command_id"] | "";
    const uint32_t uptimeS = millis() / 1000UL;

    {
        StaticJsonDocument<384> evtDoc;
        evtDoc["type"] = success ? "cmd_ack" : "cmd_err";
        evtDoc["cmd"] = cmd.length() > 0 ? cmd : "unknown";
        evtDoc["status"] = success ? "SUCCESS" : "REJECTED";
        evtDoc["uptime"] = uptimeS;
        if (commandId && commandId[0]) evtDoc["command_id"] = commandId;
        if (!success && reason.length() > 0) evtDoc["reason"] = reason;
        char evtPayload[384];
        serializeJson(evtDoc, evtPayload, sizeof(evtPayload));
        enqueuePendingPublish(MqttManager::getInstance().eventTopic().c_str(), evtPayload);
    }

    {
        StaticJsonDocument<384> ackDoc;
        ackDoc["device_id"] = gDeviceId;
        ackDoc["hardware_id"] = gHardwareId;
        ackDoc["mqtt_route_id"] = MqttManager::getInstance().routeId();
        ackDoc["cmd"] = cmd.length() > 0 ? cmd : "unknown";
        ackDoc["status"] = success ? "SUCCESS" : "REJECTED";
        ackDoc["success"] = success;
        ackDoc["uptime_s"] = uptimeS;
        ackDoc["timestamp_ms"] = millis();
        if (commandId && commandId[0]) ackDoc["command_id"] = commandId;
        if (!success && reason.length() > 0) ackDoc["reason"] = reason;
        char ackPayload[384];
        serializeJson(ackDoc, ackPayload, sizeof(ackPayload));
        enqueuePendingPublish(MqttManager::getInstance().commandAckTopic().c_str(), ackPayload);

        if (cmd == "config_update") {
            StaticJsonDocument<1024> cfgAckDoc;
            char cfgJson[768];
            cfgAckDoc["device_id"] = gDeviceId;
            cfgAckDoc["hardware_id"] = gHardwareId;
            cfgAckDoc["mqtt_route_id"] = MqttManager::getInstance().routeId();
            cfgAckDoc["status"] = success ? "SUCCESS" : "REJECTED";
            cfgAckDoc["success"] = success;
            cfgAckDoc["applied"] = success;
            cfgAckDoc["config_received"] = success;
            cfgAckDoc["config_applied"] = success;
            cfgAckDoc["reboot_scheduled"] = success && gPendingReboot;
            cfgAckDoc["uptime_s"] = uptimeS;
            cfgAckDoc["timestamp_ms"] = millis();
            cfgAckDoc["current_config_version"] = ConfigManager::getInstance().get().configVersion;
            if (commandId && commandId[0]) cfgAckDoc["command_id"] = commandId;
            if (!success && reason.length() > 0) cfgAckDoc["reason"] = reason;
            if (success && ConfigManager::getInstance().buildJson(cfgJson, sizeof(cfgJson))) {
                StaticJsonDocument<768> cfgDoc;
                if (deserializeJson(cfgDoc, cfgJson) == DeserializationError::Ok) {
                    cfgAckDoc["current_config"] = cfgDoc.as<JsonVariantConst>();
                }
            }
            char cfgAckPayload[1024];
            serializeJson(cfgAckDoc, cfgAckPayload, sizeof(cfgAckPayload));
            enqueuePendingPublish(MqttManager::getInstance().configAckTopic().c_str(), cfgAckPayload);
        }
    }
}

// ── CONFIG button ─────────────────────────────────────────────────────────────
static void buildHardwareId(char* out, size_t outSize) {
    if (!out || outSize == 0) return;
    uint8_t mac[6] = {};
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    snprintf(out, outSize, "FGHW-%02X%02X%02X%02X%02X%02X",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
}

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
