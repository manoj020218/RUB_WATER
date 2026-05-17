#include <Arduino.h>
#include <ArduinoJson.h>
#include <time.h>

#include "alarm_state_machine.h"
#include "command_handler.h"
#include "config_manager.h"
#include "http_fallback.h"
#include "local_event_queue.h"
#include "mqtt_client.h"
#include "network_diagnostics.h"
#include "ota_manager.h"
#include "relay_controller.h"
#include "sensor_rs485.h"
#include "switch_inputs.h"
#include "telemetry_manager.h"
#include "time_sync.h"
#include "watchdog.h"
#include "wifi_manager.h"

namespace {
AlarmState gPreviousState = AlarmState::NORMAL;
unsigned long gLastHeartbeatMs = 0;

const char* stateToString(AlarmState state) {
    switch (state) {
        case AlarmState::NORMAL: return "NORMAL";
        case AlarmState::WATER_DETECTED: return "WATER_DETECTED";
        case AlarmState::ALERT_PENDING: return "ALERT_PENDING";
        case AlarmState::ALERT: return "ALERT";
        case AlarmState::DANGER_PENDING: return "DANGER_PENDING";
        case AlarmState::DANGER: return "DANGER";
        case AlarmState::MUTED_DANGER: return "MUTED_DANGER";
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

    bool httpPosted = false;
    const String queueTopicStr = String(queueTopic);
    if (queueTopicStr == "telemetry") {
        httpPosted = HttpFallbackService::getInstance().postTelemetry(payload);
    } else if (queueTopicStr == "command_ack") {
        httpPosted = HttpFallbackService::getInstance().postCommandAck(payload);
    } else {
        httpPosted = HttpFallbackService::getInstance().postEvent(payload);
    }

    if (httpPosted) {
        return true;
    }

    LocalEventQueue::getInstance().enqueue(queueTopic, payload);
    return false;
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

void onMqttCommand(const char* command, const char* payload) {
    bool success = CommandHandler::getInstance().onCommand(command, payload);
    const DeviceConfig& config = ConfigManager::getInstance().getConfig();
    const char* commandId = "";

    if (payload && payload[0] != '\0') {
        StaticJsonDocument<256> doc;
        if (deserializeJson(doc, payload) == DeserializationError::Ok) {
            commandId = doc["command_id"] | "";
        }
    }

    publishCommandAck(config, command, commandId, success);
}

void publishStateEventIfChanged(AlarmState currentState, const DeviceConfig& config) {
    if (currentState == gPreviousState) {
        return;
    }

    StaticJsonDocument<320> eventDoc;
    eventDoc["device_id"] = config.deviceId;
    eventDoc["location_id"] = config.locationId;
    eventDoc["event_type"] = "STATE_CHANGE";
    eventDoc["previous_state"] = stateToString(gPreviousState);
    eventDoc["new_state"] = stateToString(currentState);
    eventDoc["timestamp_ms"] = millis();

    char payload[320]{};
    serializeJson(eventDoc, payload, sizeof(payload));

    publishWithFallback("event", MqttClientService::getInstance().eventTopic(), payload);

    gPreviousState = currentState;
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
}  // namespace

void setup() {
    Serial.begin(115200);
    delay(500);
    Serial.println("\n=== FloodGuard Firmware Boot ===");

    ConfigManager::getInstance().begin();
    const DeviceConfig& config = ConfigManager::getInstance().getConfig();
    Serial.printf(
        "PID=%s HW=%s FW=%s Device=%s Location=%s\n",
        config.productPid,
        config.hardwareCode,
        config.firmwareVersion,
        config.deviceId,
        config.locationId
    );
    Serial.printf("GPIO RS485(RX/TX/DE): %d/%d/%d\n", config.gpio.rs485RxPin, config.gpio.rs485TxPin, config.gpio.rs485DeRePin);
    Serial.printf(
        "GPIO Relay(S/B/V/BR/SP): %d/%d/%d/%d/%d\n",
        config.gpio.relaySirenPin,
        config.gpio.relayBeaconPin,
        config.gpio.relayVoicePin,
        config.gpio.relayBarrierPin,
        config.gpio.relaySparePin
    );

    WifiManager::getInstance().begin(config.wifiSsid, config.wifiPass);
    NetworkDiagnosticsService::getInstance().begin();
    TimeSyncService::getInstance().begin();
    WatchdogService::getInstance().begin();

    SensorRs485::getInstance().begin(config.thresholds.sensorMountHeightMm);
    SwitchInputs::getInstance().begin(config.gpio.switch300Pin, config.gpio.switch500Pin);
    AlarmStateMachine::getInstance().begin(config.thresholds);
    RelayController::getInstance().begin(config.gpio);
    CommandHandler::getInstance().begin();

    LocalEventQueue::getInstance().begin();
    HttpFallbackService::getInstance().begin(config.httpBaseUrl, config.deviceId);
    MqttClientService::getInstance().begin(config.mqttHost, config.mqttPort, config.mqttUser, config.mqttPass, config.deviceId);
    MqttClientService::getInstance().setCommandCallback(onMqttCommand);

    TelemetryManager::getInstance().begin(config);
    OtaManager::getInstance().begin(config.firmwareVersion);
    gPreviousState = AlarmStateMachine::getInstance().getState();
}

void loop() {
    const DeviceConfig& config = ConfigManager::getInstance().getConfig();

    WifiManager::getInstance().loop();
    const bool wifiConnected = WifiManager::getInstance().isConnected();

    TimeSyncService::getInstance().loop(wifiConnected);
    MqttClientService::getInstance().loop();
    CommandHandler::getInstance().loop();

    SensorRs485::getInstance().loop();
    SwitchInputs::getInstance().loop();

    const SensorSnapshot& sensor = SensorRs485::getInstance().getSnapshot();
    const SwitchSnapshot& switches = SwitchInputs::getInstance().getSnapshot();

    AlarmStateMachine::getInstance().update(sensor, switches);
    const AlarmState state = AlarmStateMachine::getInstance().getState();

    RelayController::getInstance().setMuted(CommandHandler::getInstance().isMuted());
    RelayController::getInstance().loop(state);

    NetworkDiagnosticsService::getInstance().loop(
        wifiConnected,
        WifiManager::getInstance().getRssi(),
        WifiManager::getInstance().getLocalIp()
    );
    const NetworkDiagnostics& diagnostics = NetworkDiagnosticsService::getInstance().getData();

    publishStateEventIfChanged(state, config);
    publishHeartbeat(config, diagnostics);

    TelemetryManager::getInstance().loop(
        state,
        sensor,
        switches,
        RelayController::getInstance().getSnapshot(),
        diagnostics,
        MqttClientService::getInstance().isConnected()
    );

    replayOfflineQueue();
    OtaManager::getInstance().loop(AlarmStateMachine::getInstance().isDangerActive());

    WatchdogService::getInstance().feed();
    WatchdogService::getInstance().loop();
    delay(10);
}
