#include "telemetry_manager.h"

#include <ArduinoJson.h>
#include <ctime>

#include "command_handler.h"
#include "http_fallback.h"
#include "local_event_queue.h"
#include "mqtt_client.h"

TelemetryManager& TelemetryManager::getInstance() {
    static TelemetryManager instance;
    return instance;
}

void TelemetryManager::begin(const DeviceConfig& config) {
    _config = config;
    _lastTelemetryMs = 0;
    _lastWaterLevelMm = 0;
}

void TelemetryManager::loop(
    AlarmState state,
    const char* statusColor,
    const char* statusNote,
    const FloodGuardRuntimeConfig& runtimeConfig,
    const SensorSnapshot& sensor,
    const SwitchSnapshot& switches,
    const RelaySnapshot& relays,
    const NetworkDiagnostics& diagnostics,
    bool mqttConnected
) {
    const unsigned long now = millis();
    const uint32_t intervalMs = currentIntervalMs(state, sensor.waterLevelMm);
    if (now - _lastTelemetryMs < intervalMs) {
        return;
    }
    _lastTelemetryMs = now;

    StaticJsonDocument<1024> doc;
    doc["device_id"] = _config.deviceId;
    doc["location_id"] = _config.locationId;
    doc["product_pid"] = _config.productPid;
    doc["hardware_code"] = _config.hardwareCode;
    doc["timestamp_ms"] = now;
    doc["timestamp_epoch"] = static_cast<uint32_t>(time(nullptr));
    doc["water_level_mm"] = sensor.waterLevelMm;
    doc["distance_mm"] = sensor.distanceMm;
    doc["status"] = stateToString(state);
    doc["status_color"] = statusColor ? statusColor : "NORMAL";
    doc["status_note"] = statusNote ? statusNote : "";
    doc["primary_sensor_status"] = sensor.fault ? "FAULT" : (sensor.enabled ? "OK" : "DISABLED");
    doc["rs485_status"] = sensor.fault ? "FAULT" : (sensor.enabled ? "OK" : "DISABLED");
    doc["rs485_last_valid_ms"] = sensor.lastValidMs;
    doc["switch_300mm"] = switches.switch300Closed;
    doc["switch_500mm"] = switches.switch500Closed;
    doc["switch_level_1_closed"] = switches.switch300Closed;
    doc["switch_level_2_closed"] = switches.switch500Closed;
    doc["switch_level_1_mm"] = runtimeConfig.switchLevel1Mm;
    doc["switch_level_2_mm"] = runtimeConfig.switchLevel2Mm;
    doc["rs485_sensor_enabled"] = runtimeConfig.rs485SensorEnabled;
    doc["switch_sensor_enabled"] = runtimeConfig.switchSensorEnabled;
    doc["config_version"] = runtimeConfig.configVersion;
    doc["wifi_connected"] = diagnostics.wifiConnected;
    doc["internet_available"] = diagnostics.internetAvailable;
    doc["sim_registered"] = diagnostics.simRegistered;
    doc["wifi_rssi"] = diagnostics.signalRssiDbm;
    doc["router_online"] = diagnostics.gatewayReachable;
    doc["sim_inserted"] = diagnostics.simInserted;
    doc["connected_4g"] = diagnostics.connected4g;
    doc["dry_run_active"] = CommandHandler::getInstance().isDryRunActive();
    doc["battery_voltage"] = 0.0f;  // reserved for future ADC wiring
    doc["solar_voltage"] = 0.0f;    // reserved for future ADC wiring
    doc["firmware_version"] = _config.firmwareVersion;

    JsonObject configObj = doc.createNestedObject("config");
    configObj["alert_level_mm"] = runtimeConfig.alertLevelMm;
    configObj["danger_level_mm"] = runtimeConfig.dangerLevelMm;
    configObj["clear_level_mm"] = runtimeConfig.clearLevelMm;
    configObj["trigger_delay_seconds"] = runtimeConfig.triggerDelaySeconds;
    configObj["clear_delay_seconds"] = runtimeConfig.clearDelaySeconds;
    configObj["sensor_mount_height_mm"] = runtimeConfig.sensorMountHeightMm;

    JsonObject relayStatus = doc.createNestedObject("relay_status");
    relayStatus["siren"] = relays.siren;
    relayStatus["beacon"] = relays.beacon;
    relayStatus["voice"] = relays.voice;
    relayStatus["barrier"] = relays.barrier;

    char payload[1024]{};
    serializeJson(doc, payload, sizeof(payload));

    bool published = false;
    if (mqttConnected) {
        published = MqttClientService::getInstance().publish(MqttClientService::getInstance().telemetryTopic().c_str(), payload);
    }
    if (!published) {
        published = HttpFallbackService::getInstance().postTelemetry(payload);
    }

    if (!published) {
        LocalEventQueue::getInstance().enqueue("telemetry", payload);
    }

    _lastWaterLevelMm = sensor.waterLevelMm;
}

uint32_t TelemetryManager::currentIntervalMs(AlarmState state, int32_t waterLevelMm) const {
    if (
        state == AlarmState::DANGER_CONFIRMED ||
        state == AlarmState::DANGER_WITH_SENSOR_MISMATCH ||
        state == AlarmState::DANGER_WITH_RS485_FAULT ||
        state == AlarmState::DANGER_PENDING
    ) {
        return _config.reporting.dangerIntervalMs;
    }
    if (
        state == AlarmState::ALERT_PENDING_VERIFICATION ||
        state == AlarmState::ALERT_ORANGE ||
        state == AlarmState::ALERT_ORANGE_CONFIRMED ||
        state == AlarmState::ALERT_SENSOR_MISMATCH ||
        state == AlarmState::ALERT_WITH_RS485_FAULT
    ) {
        return _config.reporting.alertIntervalMs;
    }
    if (waterLevelMm >= 400 || (waterLevelMm - _lastWaterLevelMm) > 15) {
        return _config.reporting.rapidIntervalMs;
    }
    if (waterLevelMm > 0) {
        return _config.reporting.waterDetectedIntervalMs;
    }
    return _config.reporting.dryIntervalMs;
}

const char* TelemetryManager::stateToString(AlarmState state) const {
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
