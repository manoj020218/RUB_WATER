#include <Arduino.h>
#include <ArduinoJson.h>
#include <cstring>
#include <time.h>

#include "alarm_state_machine.h"
#include "ble_provisioning.h"
#include "command_handler.h"
#include "config_manager.h"
#include "http_fallback.h"
#include "local_config_server.h"
#include "local_event_queue.h"
#include "mqtt_client.h"
#include "network_diagnostics.h"
#include "ota_manager.h"
#include "relay_controller.h"
#include "sensor_rs485.h"
#include "status_led_s3.h"
#include "switch_inputs.h"
#include "telemetry_manager.h"
#include "time_sync.h"
#include "watchdog.h"
#include "wifi_manager.h"

// Override Arduino framework weak symbol — default 8 KB overflows during
// MQTT/HTTP TCP connect because lwIP cleanup path needs ~30 KB of stack.
size_t getArduinoLoopTaskStackSize() { return 65536; }

namespace {
AlarmState gPreviousState = AlarmState::NORMAL;
unsigned long gLastHeartbeatMs = 0;
bool gSwitchFaultEventPublished = false;
bool gObstructionEventPublished = false;
// Daily reboot: armed after 3 min uptime so a boot at the exact reboot minute
// doesn't immediately reboot again in a loop.
bool gDailyRebootArmed = false;

const char* stateToString(AlarmState state) {
    switch (state) {
        case AlarmState::NORMAL: return "NORMAL";
        case AlarmState::ALERT_PENDING_VERIFICATION: return "ALERT_PENDING_VERIFICATION";
        case AlarmState::ALERT_ORANGE: return "ALERT_ORANGE";
        case AlarmState::ALERT_ORANGE_CONFIRMED: return "ALERT_ORANGE_CONFIRMED";
        case AlarmState::ALERT_SENSOR_MISMATCH: return "ALERT_SENSOR_MISMATCH";
        case AlarmState::DANGER_PENDING: return "DANGER_PENDING";
        case AlarmState::DANGER_CONFIRMED: return "DANGER_CONFIRMED";
        case AlarmState::DANGER_WITH_SENSOR_MISMATCH: return "DANGER_WITH_SENSOR_MISMATCH";
        case AlarmState::DANGER_WITH_RS485_FAULT: return "DANGER_WITH_RS485_FAULT";
        case AlarmState::ALERT_WITH_RS485_FAULT: return "ALERT_WITH_RS485_FAULT";
        case AlarmState::CLEAR_PENDING: return "CLEAR_PENDING";
        case AlarmState::SENSOR_FAULT: return "SENSOR_FAULT";
        case AlarmState::OFFLINE_LOCAL_MODE: return "OFFLINE_LOCAL_MODE";
        default: return "UNKNOWN";
    }
}

bool publishWithFallback(const char* queueTopic, const String& mqttTopic, const char* payload) {
    if (MqttClientService::getInstance().isConnected() &&
        MqttClientService::getInstance().publish(mqttTopic.c_str(), payload)) {
        return true;
    }

    if (!WifiManager::getInstance().isConnected()) {
        LocalEventQueue::getInstance().enqueue(queueTopic, payload);
        return false;
    }

    bool httpPosted = false;
    const String queueTopicStr = String(queueTopic);
    if (queueTopicStr == "telemetry") {
        httpPosted = HttpFallbackService::getInstance().postTelemetry(payload);
    } else if (queueTopicStr == "command_ack") {
        httpPosted = HttpFallbackService::getInstance().postCommandAck(payload);
    } else if (queueTopicStr == "config_ack") {
        httpPosted = HttpFallbackService::getInstance().postConfigAck(payload);
    } else {
        httpPosted = HttpFallbackService::getInstance().postEvent(payload);
    }

    if (httpPosted) {
        return true;
    }

    LocalEventQueue::getInstance().enqueue(queueTopic, payload);
    return false;
}

void applyRuntimeConfigToModules() {
    const FloodGuardRuntimeConfig& runtimeConfig = ConfigManager::getInstance().getRuntimeConfig();
    SensorRs485::getInstance().setMountHeightMm(runtimeConfig.sensorMountHeightMm);
    SensorRs485::getInstance().setEnabled(runtimeConfig.rs485SensorEnabled);
    SwitchInputs::getInstance().setEnabled(runtimeConfig.switchSensorEnabled);
}

void publishCommandAck(const DeviceConfig& config, const char* command, const char* commandId, bool success) {
    StaticJsonDocument<384> doc;
    doc["command_id"] = (commandId && commandId[0] != '\0') ? commandId : "local";
    doc["command"] = command ? command : "";
    doc["device_id"] = config.deviceId;
    doc["location_id"] = config.locationId;
    doc["status"] = success ? "SUCCESS" : "FAILED";
    doc["executed_at_ms"] = millis();
    doc["executed_at_epoch"] = static_cast<uint32_t>(time(nullptr));

    char payload[384]{};
    serializeJson(doc, payload, sizeof(payload));
    publishWithFallback("command_ack", MqttClientService::getInstance().commandAckTopic(), payload);
}

void publishConfigAck(const DeviceConfig& config, const char* commandId, bool success, const char* reason) {
    StaticJsonDocument<512> doc;
    const FloodGuardRuntimeConfig& runtimeConfig = ConfigManager::getInstance().getRuntimeConfig();
    doc["command_id"] = (commandId && commandId[0] != '\0') ? commandId : "cfg_local";
    doc["device_id"] = config.deviceId;
    doc["location_id"] = config.locationId;
    doc["status"] = success ? "SUCCESS" : "REJECTED";
    doc["applied_config_version"] = runtimeConfig.configVersion;
    doc["saved_to_nvs"] = success;
    doc["timestamp_epoch"] = static_cast<uint32_t>(time(nullptr));
    if (!success && reason && reason[0] != '\0') {
        doc["reason"] = reason;
    }

    char payload[512]{};
    serializeJson(doc, payload, sizeof(payload));
    publishWithFallback("config_ack", MqttClientService::getInstance().configAckTopic(), payload);
}

void publishStateEventIfChanged(AlarmState currentState, const DeviceConfig& config, const char* note, const char* color) {
    if (currentState == gPreviousState) {
        return;
    }

    StaticJsonDocument<512> eventDoc;
    eventDoc["device_id"] = config.deviceId;
    eventDoc["location_id"] = config.locationId;
    eventDoc["event_type"] = "STATE_CHANGE";
    eventDoc["previous_state"] = stateToString(gPreviousState);
    eventDoc["new_state"] = stateToString(currentState);
    eventDoc["status_color"] = color ? color : "NORMAL";
    eventDoc["status_note"] = note ? note : "";
    eventDoc["timestamp_ms"] = millis();

    char payload[512]{};
    serializeJson(eventDoc, payload, sizeof(payload));
    publishWithFallback("event", MqttClientService::getInstance().eventTopic(), payload);

    gPreviousState = currentState;
}

void publishGenericEvent(const DeviceConfig& config, const char* eventType, const char* note) {
    StaticJsonDocument<448> eventDoc;
    eventDoc["device_id"] = config.deviceId;
    eventDoc["location_id"] = config.locationId;
    eventDoc["event_type"] = eventType;
    eventDoc["reason"] = note ? note : "";
    eventDoc["timestamp_ms"] = millis();

    char payload[448]{};
    serializeJson(eventDoc, payload, sizeof(payload));
    publishWithFallback("event", MqttClientService::getInstance().eventTopic(), payload);
}

void publishHeartbeat(const DeviceConfig& config, const NetworkDiagnostics& diagnostics) {
    const unsigned long now = millis();
    if (now - gLastHeartbeatMs < 60000UL) {
        return;
    }
    gLastHeartbeatMs = now;

    StaticJsonDocument<320> doc;
    doc["device_id"] = config.deviceId;
    doc["location_id"] = config.locationId;
    doc["product_pid"] = config.productPid;
    doc["hardware_code"] = config.hardwareCode;
    doc["type"] = "heartbeat";
    doc["timestamp_ms"] = now;
    doc["wifi_connected"] = diagnostics.wifiConnected;
    doc["internet_available"] = diagnostics.internetAvailable;
    doc["sim_registered"] = diagnostics.simRegistered;

    char payload[320]{};
    serializeJson(doc, payload, sizeof(payload));
    publishWithFallback("heartbeat", MqttClientService::getInstance().heartbeatTopic(), payload);
}

void replayOfflineQueue() {
    if (!MqttClientService::getInstance().isConnected()) {
        return;
    }

    QueuedEvent queued{};
    uint8_t sent = 0;
    while (sent < 5 && LocalEventQueue::getInstance().dequeue(queued)) {
        String topic;
        const String queueTopic = String(queued.topic);
        if (queueTopic == "telemetry") {
            topic = MqttClientService::getInstance().telemetryTopic();
        } else if (queueTopic == "event") {
            topic = MqttClientService::getInstance().eventTopic();
        } else if (queueTopic == "command_ack") {
            topic = MqttClientService::getInstance().commandAckTopic();
        } else if (queueTopic == "config_ack") {
            topic = MqttClientService::getInstance().configAckTopic();
        } else {
            topic = MqttClientService::getInstance().heartbeatTopic();
        }

        if (!MqttClientService::getInstance().publish(topic.c_str(), queued.payload)) {
            LocalEventQueue::getInstance().enqueue(queued.topic, queued.payload);
            break;
        }
        ++sent;
    }
}

void onIncomingCommand(const char* command, const char* payload) {
    const DeviceConfig& config = ConfigManager::getInstance().getConfig();
    const char* commandId = "";

    StaticJsonDocument<1024> doc;
    if (payload && payload[0] != '\0') {
        if (deserializeJson(doc, payload) == DeserializationError::Ok) {
            commandId = doc["command_id"] | "";
        }
    }

    if (command && (strcmp(command, "UPDATE_CONFIG") == 0 || strcmp(command, "update_config") == 0)) {
        String reason;
        const bool applied = ConfigManager::getInstance().applyRuntimeConfigFromJson(payload, reason, "mqtt_config");
        if (applied) {
            applyRuntimeConfigToModules();
        }
        publishConfigAck(config, commandId, applied, reason.c_str());
        return;
    }

    const bool success = CommandHandler::getInstance().onCommand(command, payload);
    publishCommandAck(config, command, commandId, success);
}
}  // namespace

void setup() {
    Serial.begin(115200);
    delay(500);
    Serial.println("\n=== FloodGuard Firmware Boot ===");

    ConfigManager::getInstance().begin();
    const DeviceConfig& config = ConfigManager::getInstance().getConfig();
    const FloodGuardRuntimeConfig& runtimeConfig = ConfigManager::getInstance().getRuntimeConfig();

    Serial.printf(
        "PID=%s HW=%s FW=%s Device=%s Location=%s\n",
        config.productPid,
        config.hardwareCode,
        config.firmwareVersion,
        config.deviceId,
        config.locationId
    );
    Serial.printf(
        "Runtime cfg version=%lu alert=%u danger=%u clear=%u rs485=%d switch=%d\n",
        static_cast<unsigned long>(runtimeConfig.configVersion),
        runtimeConfig.alertLevelMm,
        runtimeConfig.dangerLevelMm,
        runtimeConfig.clearLevelMm,
        runtimeConfig.rs485SensorEnabled,
        runtimeConfig.switchSensorEnabled
    );

    WifiManager::getInstance().begin(config.wifiSsid, config.wifiPass);
    // Read NVS-loaded SSID before any DEV override to detect provisioning state.
    // "CHANGE_WIFI_SSID" is the factory sentinel meaning no credentials saved yet.
    const bool deviceIsProvisioned =
        WifiManager::getInstance().getConfiguredSsid() != "CHANGE_WIFI_SSID" &&
        WifiManager::getInstance().getConfiguredSsid().length() > 0;
#if defined(DEV_WIFI_SSID) && defined(DEV_WIFI_PASS)
    Serial.println("[WiFi] DEV override: using hardcoded SSID=" DEV_WIFI_SSID);
    WifiManager::getInstance().setCredentials(DEV_WIFI_SSID, DEV_WIFI_PASS, false);
#endif
    NetworkDiagnosticsService::getInstance().begin();
    TimeSyncService::getInstance().begin();
    WatchdogService::getInstance().begin();

    SensorRs485::getInstance().begin(runtimeConfig.sensorMountHeightMm, runtimeConfig.rs485SensorEnabled);
    SwitchInputs::getInstance().begin(config.gpio.switch300Pin, config.gpio.switch500Pin, runtimeConfig.switchSensorEnabled);
    AlarmStateMachine::getInstance().begin();
    RelayController::getInstance().begin(config.gpio);
    CommandHandler::getInstance().begin();
    // BLE provisioning needs ~70KB internal RAM. Skip on provisioned devices or DEV
    // builds — internal heap (~94KB total) must be preserved for MQTT/WiFi stack.
#if defined(DEV_WIFI_SSID)
    Serial.println("[BLE] Skipped — DEV_WIFI build");
#else
    if (deviceIsProvisioned) {
        Serial.println("[BLE] Skipped — WiFi credentials in NVS");
    } else {
        BleProvisioningService::getInstance().begin(config);
    }
#endif

    LocalEventQueue::getInstance().begin();
    HttpFallbackService::getInstance().begin(config.httpBaseUrl, config.deviceId);
    MqttClientService::getInstance().begin(config.mqttHost, config.mqttPort, config.mqttUser, config.mqttPass, config.deviceId);
    MqttClientService::getInstance().setCommandCallback(onIncomingCommand);
    LocalConfigServer::getInstance().begin();
    StatusLedS3::getInstance().begin();

    TelemetryManager::getInstance().begin(config);
    OtaManager::getInstance().begin(config);
    gPreviousState = AlarmStateMachine::getInstance().getState();
}

void loop() {
    const DeviceConfig& config = ConfigManager::getInstance().getConfig();
    const FloodGuardRuntimeConfig& runtimeConfig = ConfigManager::getInstance().getRuntimeConfig();

    WifiManager::getInstance().loop();
    const bool wifiConnected = WifiManager::getInstance().isConnected();

    TimeSyncService::getInstance().loop(wifiConnected);
    // Guard: WiFi must be up AND 15-second BLE provisioning window must have passed
    static const unsigned long kMqttBootDelayMs = 15000UL;
    if (wifiConnected && millis() >= kMqttBootDelayMs) {
        MqttClientService::getInstance().loop();
    }
    const bool mqttConnected = MqttClientService::getInstance().isConnected();
    CommandHandler::getInstance().loop();

    SensorRs485::getInstance().loop();
    SwitchInputs::getInstance().loop();

    const SensorSnapshot& sensor = SensorRs485::getInstance().getSnapshot();
    const SwitchSnapshot& switches = SwitchInputs::getInstance().getSnapshot();

    AlarmStateMachine::getInstance().update(runtimeConfig, sensor, switches);
    const AlarmState state = AlarmStateMachine::getInstance().getState();
    const char* statusNote = AlarmStateMachine::getInstance().getStatusNote();
    const char* statusColor = AlarmStateMachine::getInstance().getStatusColor();

    RelayController::getInstance().setMuted(CommandHandler::getInstance().isMuted());
    RelayController::getInstance().loop(state);

    NetworkDiagnosticsService::getInstance().loop(
        wifiConnected,
        WifiManager::getInstance().getRssi(),
        WifiManager::getInstance().getLocalIp()
    );
    const NetworkDiagnostics& diagnostics = NetworkDiagnosticsService::getInstance().getData();
    BleProvisioningService::getInstance().loop(config, diagnostics, mqttConnected);

    StatusLedS3::getInstance().loop(
        state,
        wifiConnected,
        diagnostics.internetAvailable,
        mqttConnected
    );

    LocalConfigServer::getInstance().loop(state, sensor, switches, mqttConnected);

    publishStateEventIfChanged(state, config, statusNote, statusColor);
    publishHeartbeat(config, diagnostics);

    ConfigChangeNotice notice{};
    if (ConfigManager::getInstance().consumeChangeNotice(notice)) {
        publishGenericEvent(
            config,
            notice.localSource ? "LOCAL_CONFIG_CHANGED" : "REMOTE_CONFIG_CHANGED",
            notice.source
        );
    }

    if (AlarmStateMachine::getInstance().shouldRaiseSwitchFaultEvent() && !gSwitchFaultEventPublished) {
        gSwitchFaultEventPublished = true;
        publishGenericEvent(
            config,
            "SWITCH_SENSOR_POSSIBLE_FAULT",
            "RS485 crossed danger threshold but Level 2 switch did not trigger within mismatch duration."
        );
    }
    if (AlarmStateMachine::getInstance().shouldRaiseRs485ObstructionEvent() && !gObstructionEventPublished) {
        gObstructionEventPublished = true;
        publishGenericEvent(
            config,
            "POSSIBLE_RS485_OBSTRUCTION_OR_FALSE_ECHO",
            "RS485 indicates high level but switches are open. Possible obstruction under sensor."
        );
    }
    if (state == AlarmState::NORMAL) {
        gSwitchFaultEventPublished = false;
        gObstructionEventPublished = false;
    }

    TelemetryManager::getInstance().loop(
        state,
        statusColor,
        statusNote,
        runtimeConfig,
        sensor,
        switches,
        RelayController::getInstance().getSnapshot(),
        diagnostics,
        mqttConnected
    );

    if (wifiConnected && !mqttConnected) {
        String polledCommand;
        String polledPayload;
        if (HttpFallbackService::getInstance().fetchPendingCommand(polledCommand, polledPayload)) {
            onIncomingCommand(polledCommand.c_str(), polledPayload.c_str());
        }
    }

    replayOfflineQueue();
    OtaManager::getInstance().loop(AlarmStateMachine::getInstance().isDangerActive(), wifiConnected);

    WatchdogService::getInstance().feed();
    WatchdogService::getInstance().loop();

    // Arm daily reboot check only after 3 minutes of uptime.
    if (!gDailyRebootArmed && millis() > 180000UL) {
        gDailyRebootArmed = true;
    }
    if (gDailyRebootArmed && runtimeConfig.dailyRebootEnabled && TimeSyncService::getInstance().isTimeSynced()) {
        time_t nowEpoch = time(nullptr);
        struct tm ti{};
        localtime_r(&nowEpoch, &ti);
        if (ti.tm_hour == runtimeConfig.dailyRebootHour &&
            ti.tm_min  == runtimeConfig.dailyRebootMinute) {
            publishGenericEvent(config, "DAILY_REBOOT", "Scheduled daily reboot");
            delay(300);
            ESP.restart();
        }
    }

    delay(10);
}
