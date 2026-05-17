#include "telemetry_manager.h"

#include <ArduinoJson.h>

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

    StaticJsonDocument<512> doc;
    doc["device_id"] = _config.deviceId;
    doc["location_id"] = _config.locationId;
    doc["product_pid"] = _config.productPid;
    doc["hardware_code"] = _config.hardwareCode;
    doc["timestamp_ms"] = now;
    doc["water_level_mm"] = sensor.waterLevelMm;
    doc["distance_mm"] = sensor.distanceMm;
    doc["status"] = stateToString(state);
    doc["primary_sensor_status"] = sensor.fault ? "FAULT" : "OK";
    doc["switch_300mm"] = switches.switch300Closed;
    doc["switch_500mm"] = switches.switch500Closed;
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

    JsonObject relayStatus = doc.createNestedObject("relay_status");
    relayStatus["siren"] = relays.siren;
    relayStatus["beacon"] = relays.beacon;
    relayStatus["voice"] = relays.voice;
    relayStatus["barrier"] = relays.barrier;

    char payload[512]{};
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
    if (state == AlarmState::DANGER || state == AlarmState::MUTED_DANGER || state == AlarmState::DANGER_PENDING) {
        return _config.reporting.dangerIntervalMs;
    }
    if (state == AlarmState::ALERT || state == AlarmState::ALERT_PENDING) {
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
