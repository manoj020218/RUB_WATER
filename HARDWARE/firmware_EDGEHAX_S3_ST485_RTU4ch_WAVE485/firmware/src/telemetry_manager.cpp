#include "telemetry_manager.h"

#include <ArduinoJson.h>

#include "alert_action_runner.h"
#include "alert_action_sheet.h"
#include "device_profile.h"
#include "dyp_sensor.h"
#include "flood_state_machine.h"
#include "http_fallback.h"
#include "internal_flash_fifo.h"
#include "mqtt_manager.h"
#include "output_controller.h"
#include "remote_box_manager.h"
#include "config_manager.h"
#include "voltage_monitor.h"
#include "wifi_manager.h"

namespace {
constexpr uint32_t kHeartbeatIntervalMs = 60000UL;

const char* statusFromFloodState(FloodState state) {
    switch (state) {
        case FloodState::DANGER_WAITING_FOR_CONFIRMATION:
        case FloodState::DANGER_CONFIRMED:
        case FloodState::DANGER_WITH_CONFIRMATION_MISMATCH:
        case FloodState::DANGER_WITH_PRIMARY_SENSOR_FAULT:
            return "DANGER";
        case FloodState::ALERT_WAITING_FOR_CONFIRMATION:
        case FloodState::ALERT_CONFIRMED:
        case FloodState::ALERT_SENSOR_MISMATCH:
        case FloodState::SENSOR_FAULT:
            return "ALERT";
        case FloodState::CLEAR_PENDING:
        case FloodState::NORMAL:
        default:
            return "CLEAR";
    }
}

const char* primarySensorStatus(const DypSnapshot& dyp, const MainConfig& cfg) {
    if (!cfg.rs485SensorEnabled) return "DISABLED";
    if (!dyp.detected) return "NOT_DETECTED";
    if (!dyp.valid) return "INVALID";
    return "OK";
}

const char* rtuStateStr(RtuState state) {
    switch (state) {
        case RtuState::ONLINE: return "ONLINE";
        case RtuState::LOW_BATTERY: return "LOW_BATTERY";
        case RtuState::LVD_TRIPPED: return "LVD_TRIPPED";
        case RtuState::COMM_LOST:
        default:
            return "COMM_LOST";
    }
}

float round2(float value) {
    return roundf(value * 100.0f) / 100.0f;
}

float round1(float value) {
    return roundf(value * 10.0f) / 10.0f;
}
}

TelemetryManager& TelemetryManager::getInstance() {
    static TelemetryManager inst;
    return inst;
}

void TelemetryManager::begin(const char* deviceId, const char* hardwareId) {
    strncpy(_deviceId, deviceId, sizeof(_deviceId) - 1);
    strncpy(_hardwareId, hardwareId, sizeof(_hardwareId) - 1);
    _bootConfigPending = true;
}

void TelemetryManager::loop() {
    const uint32_t now = millis();
    auto& mqtt = MqttManager::getInstance();
    if (_bootConfigPending && mqtt.isConnected()) {
        publishBootConfigReport();
    }
    if ((now - _lastHeartbeatMs) >= kHeartbeatIntervalMs) {
        _lastHeartbeatMs = now;
        if (mqtt.isConnected()) {
            char heartbeat[384];
            buildHeartbeatJson(heartbeat, sizeof(heartbeat));
            mqtt.publish(mqtt.heartbeatTopic().c_str(), heartbeat);
        }
    }

    _telemetryIntervalMs = dynamicInterval();
    if ((now - _lastTelemetryMs) < _telemetryIntervalMs) return;
    _lastTelemetryMs = now;

    static char payload[3584];
    buildTelemetryJson(payload, sizeof(payload));
    send("telemetry", payload);

    // Publish state change event if state changed this cycle
    const auto& fsm = FloodStateMachine::getInstance().snapshot();
    if (fsm.stateChanged) {
        if (fsm.eventType[0]) {
            char decisionPayload[512];
            buildEventJson(decisionPayload, sizeof(decisionPayload),
                           fsm.eventType, fsm.note);
            send("event", decisionPayload);
        }
        char evtPayload[256];
        buildEventJson(evtPayload, sizeof(evtPayload),
                       "FLOOD_STATE_CHANGE", floodStateStr(fsm.state));
        send("event", evtPayload);
    }
}

void TelemetryManager::publishEvent(const char* eventType, const char* detail) {
    char payload[512];
    buildEventJson(payload, sizeof(payload), eventType, detail);
    send("event", payload);
}

bool TelemetryManager::publishEventPayload(const char* payload) {
    return send("event", payload);
}

void TelemetryManager::publishBootConfigReport() {
    char payload[1024];
    buildBootConfigJson(payload, sizeof(payload));
    if (send("event", payload)) {
        _bootConfigPending = false;
    }
}

uint32_t TelemetryManager::dynamicInterval() const {
    const int32_t level = FloodStateMachine::getInstance().snapshot().waterLevelMm;
    const FloodState fs = FloodStateMachine::getInstance().snapshot().state;
    if (isDanger(fs) || level >= 400) return 2000UL;
    if (level >= 300)                  return 5000UL;
    if (level > 0)                     return 10000UL;
    return (uint32_t)ConfigManager::getInstance().get().telemetryIdleIntervalSeconds * 1000UL;
}

void TelemetryManager::buildTelemetryJson(char* out, size_t outSize) const {
    static StaticJsonDocument<3072> doc;
    doc.clear();
    const auto& cfg  = ConfigManager::getInstance().get();
    const auto& dyp  = DypSensor::getInstance().snapshot();
    const auto& fsm  = FloodStateMachine::getInstance().snapshot();
    const auto& actionSheet = AlertActionSheetManager::getInstance().get();
    const auto& actionRun = AlertActionRunner::getInstance().snapshot();
    const auto& wifi = WifiManager::getInstance();
    auto& mqtt = MqttManager::getInstance();

    doc["device_id"]        = _deviceId;
    doc["hardware_id"]      = _hardwareId;
    doc["firmware_version"] = FIRMWARE_VERSION;
    doc["firmware"]         = FIRMWARE_VERSION;
    doc["uptime_s"]         = millis() / 1000UL;
    doc["uptime_ms"]        = millis();
    doc["free_heap"]        = ESP.getFreeHeap();
    doc["status"]           = statusFromFloodState(fsm.state);
    doc["sensor_logic_mode"] = ConfigManager::getInstance().sensorLogicMode();
    doc["logic_mode"]       = ConfigManager::getInstance().sensorLogicMode();
    doc["sensor_mode"]      = strcmp(ConfigManager::getInstance().sensorLogicMode(), "DUAL") == 0 ? "BOTH_ACTIVE"
                              : (strcmp(ConfigManager::getInstance().sensorLogicMode(), "RS485_ONLY") == 0 ? "DYP_ONLY"
                                 : ConfigManager::getInstance().sensorLogicMode());

    // WiFi
    doc["wifi_connected"] = wifi.isConnected();
    doc["mqtt_connected"] = mqtt.isConnected();
    doc["wifi_rssi"]      = wifi.rssi();
    doc["rssi"]           = wifi.rssi();
    doc["ssid"]           = wifi.configuredSsid();
    doc["local_ip"]       = wifi.localIp();
    doc["device_local_ip"] = wifi.localIp();
    doc["api_server"]     = DEFAULT_HTTP_BASE_URL;
    doc["mqtt_server"]    = DEFAULT_MQTT_HOST;
    doc["mqtt_route_id"]  = mqtt.routeId();
    doc["mqtt_topic_base"] = mqtt.topicBase();

    // Primary RS485 sensor
    doc["water_level_mm"]  = fsm.waterLevelMm;
    doc["distance_mm"]     = dyp.distanceMm;
    doc["sensor_valid"]    = fsm.sensorValid;
    doc["sensor_detected"] = dyp.detected;
    doc["zero_dist_mm"]    = DypSensor::getInstance().zeroDistanceMm();
    doc["zero_distance_mm"] = DypSensor::getInstance().zeroDistanceMm();
    doc["sensor_mount_height_mm"] = cfg.zeroDistanceMm;
    doc["primary_sensor_status"] = primarySensorStatus(dyp, cfg);
    doc["rs485_sensor_enabled"] = cfg.rs485SensorEnabled;
    doc["switch_sensor_enabled"] = cfg.switchSensorEnabled;
    doc["rs485_enabled"] = cfg.rs485SensorEnabled;
    doc["switch_enabled"] = cfg.switchSensorEnabled;
    doc["switch_level_1_mm"] = cfg.switchLevel1Mm;
    doc["switch_level_2_mm"] = cfg.switchLevel2Mm;
    doc["vmon_cal_factor"] = cfg.vMonCalFactor;

    // Flood state
    doc["flood_state"]   = floodStateStr(fsm.state);
    doc["switch_300mm"]  = fsm.l1Active;
    doc["switch_500mm"]  = fsm.l2Active;
    doc["l1_active"]     = fsm.l1Active;
    doc["l2_active"]     = fsm.l2Active;
    doc["alert_level"]   = alertLevelStr(fsm.alertLevel);
    doc["alert_status"]  = alertStatusStr(fsm.alertStatus);
    doc["alert_source"]  = alertSourceStr(fsm.alertSource);
    doc["alert_reason"]  = fsm.note;
    doc["pending_alert_level"] = alertLevelStr(fsm.pendingAlertLevel);
    doc["pending_since_ms"] = fsm.pendingSinceMs;
    doc["alert_since_ms"] = fsm.alertSinceMs;
    doc["outputs_enabled"] = fsm.outputsEnabled;
    doc["sensor_confirmation_wait_sec"] = fsm.confirmationWaitSec;
    doc["dyp_first"] = fsm.dypFirst;
    doc["switch_first"] = fsm.switchFirst;
    doc["current_config_version"] = cfg.configVersion;
    doc["config_version"] = cfg.configVersion;
    doc["action_sheet_version"] = actionSheet.actionSheetVersion;
    doc["current_action_sheet_version"] = actionSheet.actionSheetVersion;
    doc["action_sheet_sync_source"] = actionSheet.lastSyncSource;
    if (actionSheet.lastSyncAt[0]) {
        doc["action_sheet_last_sync_at"] = actionSheet.lastSyncAt;
    }
    doc["action_sheet_red_override"] = actionSheet.redAllOffOverride;
    doc["alert_action_active"] = actionRun.active;
    doc["alert_action_level"] = actionRun.active ? AlertActionSheetManager::levelStr(actionRun.level) : "NONE";

    // Relay status as object (matches backend relay_status field)
    const auto& out_c = OutputController::getInstance().snapshot();
    JsonObject relay = doc.createNestedObject("relay_status");
    relay["siren"] = out_c.sirenOn;
    relay["flash"] = out_c.flashOn;
    relay["voice"] = out_c.voiceFutureOn;
    relay["barrier"] = false;

    // INA219 power monitor
    const auto& vmon = VoltageMonitor::getInstance().snapshot();
    doc["battery_voltage"]    = round2(vmon.voltage);
    doc["battery_v"]          = round2(vmon.voltage);
    doc["battery_ma"]         = round1(vmon.currentMa);
    doc["battery_current_ma"] = round1(vmon.currentMa);
    doc["battery_mw"]         = round1(vmon.powerMw);
    doc["battery_power_mw"]   = round1(vmon.powerMw);
    doc["batt_low"]           = vmon.lowBattery;
    const char* inaStatus     = !vmon.ready          ? "ERROR"
                             : vmon.criticalBattery  ? "CRITICAL"
                             : vmon.lowBattery        ? "LOW" : "OK";
    doc["ina_status"]         = inaStatus;

    // Remote RTU boxes
    const auto& left  = RemoteBoxManager::getInstance().leftStatus();
    const auto& right = RemoteBoxManager::getInstance().rightStatus();
    JsonObject lb = doc.createNestedObject("remote_left");
    lb["online"]  = left.online;
    lb["state"]   = rtuStateStr(left.rtuState);
    lb["batt"]    = left.online ? (left.di_batteryLow ? "LOW" : "OK") : "--";
    lb["battery_v"] = round2(left.batteryVoltage);
    lb["siren"]   = left.sirenOn;
    lb["flash"]   = left.flashOn;
    lb["voice"]   = left.voiceOn;
    lb["boom"]    = left.boomOn || left.barrierOn;
    lb["barrier"] = left.boomOn || left.barrierOn;
    lb["fault_siren"] = left.sirenFaulty;
    lb["fault_flash"] = left.flashFaulty;
    lb["fault_voice"] = left.voiceFaulty;
    lb["poll_ms"] = left.pollTimeMs;
    JsonObject rb = doc.createNestedObject("remote_right");
    rb["online"]  = right.online;
    rb["state"]   = rtuStateStr(right.rtuState);
    rb["batt"]    = right.online ? (right.di_batteryLow ? "LOW" : "OK") : "--";
    rb["battery_v"] = round2(right.batteryVoltage);
    rb["siren"]   = right.sirenOn;
    rb["flash"]   = right.flashOn;
    rb["voice"]   = right.voiceOn;
    rb["boom"]    = right.boomOn || right.barrierOn;
    rb["barrier"] = right.boomOn || right.barrierOn;
    rb["fault_siren"] = right.sirenFaulty;
    rb["fault_flash"] = right.flashFaulty;
    rb["fault_voice"] = right.voiceFaulty;
    rb["poll_ms"] = right.pollTimeMs;

    serializeJson(doc, out, outSize);
}

void TelemetryManager::buildHeartbeatJson(char* out, size_t outSize) const {
    StaticJsonDocument<512> doc;
    doc["device_id"] = _deviceId;
    doc["hardware_id"] = _hardwareId;
    doc["online"] = true;
    doc["status"] = "ONLINE";
    doc["uptime_s"] = millis() / 1000UL;
    doc["wifi_connected"] = WifiManager::getInstance().isConnected();
    doc["mqtt_connected"] = MqttManager::getInstance().isConnected();
    doc["wifi_rssi"] = WifiManager::getInstance().rssi();
    doc["local_ip"] = WifiManager::getInstance().localIp();
    doc["firmware_version"] = FIRMWARE_VERSION;
    doc["mqtt_route_id"] = MqttManager::getInstance().routeId();
    doc["mqtt_topic_base"] = MqttManager::getInstance().topicBase();
    doc["current_config_version"] = ConfigManager::getInstance().get().configVersion;
    doc["current_action_sheet_version"] = AlertActionSheetManager::getInstance().version();
    serializeJson(doc, out, outSize);
}

void TelemetryManager::buildBootConfigJson(char* out, size_t outSize) const {
    StaticJsonDocument<1024> doc;
    const auto& cfg = ConfigManager::getInstance().get();
    doc["device_id"] = _deviceId;
    doc["hardware_id"] = _hardwareId;
    doc["event_type"] = "DEVICE_BOOTED_CONFIG_REPORT";
    doc["boot_status"] = "BOOTED";
    doc["firmware_version"] = FIRMWARE_VERSION;
    doc["current_config_version"] = cfg.configVersion;
    doc["current_action_sheet_version"] = AlertActionSheetManager::getInstance().version();
    doc["timestamp_ms"] = millis();

    char cfgJson[768];
    if (ConfigManager::getInstance().buildJson(cfgJson, sizeof(cfgJson))) {
        StaticJsonDocument<768> cfgDoc;
        if (deserializeJson(cfgDoc, cfgJson) == DeserializationError::Ok) {
            doc["current_config"] = cfgDoc.as<JsonVariantConst>();
        }
    }
    serializeJson(doc, out, outSize);
}

void TelemetryManager::buildEventJson(char* out, size_t outSize,
                                       const char* type, const char* detail) const {
    StaticJsonDocument<512> doc;
    doc["device_id"]  = _deviceId;
    doc["hardware_id"] = _hardwareId;
    doc["event_type"] = type;
    doc["uptime_ms"]  = millis();
    const auto& fsm   = FloodStateMachine::getInstance().snapshot();
    doc["water_level_mm"] = fsm.waterLevelMm;
    doc["alert_level"] = alertLevelStr(fsm.alertLevel);
    doc["alert_status"] = alertStatusStr(fsm.alertStatus);
    doc["alert_source"] = alertSourceStr(fsm.alertSource);
    doc["action_sheet_version"] = AlertActionSheetManager::getInstance().version();
    JsonObject det    = doc.createNestedObject("details");
    det["flood_state"] = floodStateStr(fsm.state);
    det["alert_level"] = alertLevelStr(fsm.alertLevel);
    det["alert_status"] = alertStatusStr(fsm.alertStatus);
    det["alert_source"] = alertSourceStr(fsm.alertSource);
    det["pending_alert_level"] = alertLevelStr(fsm.pendingAlertLevel);
    det["sensor_mode"] = strcmp(ConfigManager::getInstance().sensorLogicMode(), "DUAL") == 0 ? "BOTH_ACTIVE"
                        : (strcmp(ConfigManager::getInstance().sensorLogicMode(), "RS485_ONLY") == 0 ? "DYP_ONLY"
                           : ConfigManager::getInstance().sensorLogicMode());
    det["switch_l1"] = fsm.l1Active;
    det["switch_l2"] = fsm.l2Active;
    det["dyp_first"] = fsm.dypFirst;
    det["switch_first"] = fsm.switchFirst;
    det["sensor_confirmation_wait_sec"] = fsm.confirmationWaitSec;
    det["pending_since_ms"] = fsm.pendingSinceMs;
    det["outputs_enabled"] = fsm.outputsEnabled;
    det["current_config_version"] = ConfigManager::getInstance().get().configVersion;
    det["action_sheet_version"] = AlertActionSheetManager::getInstance().version();
    if (detail && detail[0]) det["reason"] = detail;
    if (detail && detail[0]) doc["reason"] = detail;
    serializeJson(doc, out, outSize);
}

bool TelemetryManager::send(const char* type, const char* payload) {
    auto& mqtt = MqttManager::getInstance();
    bool ok = false;
    if (mqtt.isConnected()) {
        const String topic = (strcmp(type, "event") == 0)
                             ? mqtt.eventTopic() : mqtt.telemetryTopic();
        ok = mqtt.publish(topic.c_str(), payload);
        Serial.printf("[TELE] %s → MQTT %s\n", type, ok ? "OK" : "FAIL");
    }
    if (!ok) {
        HttpFallback::getInstance().queue(type, payload);
        InternalFlashFifo::getInstance().push(type, payload);
    }
    return ok;
}
