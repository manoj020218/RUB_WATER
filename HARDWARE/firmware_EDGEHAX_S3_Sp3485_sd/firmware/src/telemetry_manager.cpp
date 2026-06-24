#include "telemetry_manager.h"

#include <ArduinoJson.h>

#include "device_profile.h"
#include "dyp_sensor.h"
#include "flood_state_machine.h"
#include "http_fallback.h"
#include "internal_flash_fifo.h"
#include "mqtt_manager.h"
#include "output_controller.h"
#include "pump_controller.h"
#include "remote_box_manager.h"
#include "voltage_monitor.h"
#include "wifi_manager.h"

TelemetryManager& TelemetryManager::getInstance() {
    static TelemetryManager inst;
    return inst;
}

void TelemetryManager::begin(const char* deviceId) {
    strncpy(_deviceId, deviceId, sizeof(_deviceId) - 1);
}

void TelemetryManager::loop() {
    const uint32_t now = millis();
    _telemetryIntervalMs = dynamicInterval();
    if ((now - _lastTelemetryMs) < _telemetryIntervalMs) return;
    _lastTelemetryMs = now;

    char payload[768];
    buildTelemetryJson(payload, sizeof(payload));
    send("telemetry", payload);

    // Publish state change event if state changed this cycle
    const auto& fsm = FloodStateMachine::getInstance().snapshot();
    if (fsm.stateChanged) {
        char evtPayload[256];
        buildEventJson(evtPayload, sizeof(evtPayload),
                       "FLOOD_STATE_CHANGE", floodStateStr(fsm.state));
        send("event", evtPayload);
    }
}

void TelemetryManager::publishEvent(const char* eventType, const char* detail) {
    char payload[256];
    buildEventJson(payload, sizeof(payload), eventType, detail);
    send("event", payload);
}

uint32_t TelemetryManager::dynamicInterval() const {
    const int32_t level = DypSensor::getInstance().snapshot().waterLevelMm;
    const FloodState fs = FloodStateMachine::getInstance().snapshot().state;
    if (isDanger(fs) || level >= 400) return 2000UL;
    if (level >= 300)                  return 5000UL;
    if (level > 0)                     return 10000UL;
    return 180000UL;
}

void TelemetryManager::buildTelemetryJson(char* out, size_t outSize) const {
    StaticJsonDocument<768> doc;
    doc["device_id"]    = _deviceId;
    doc["firmware"]     = FIRMWARE_VERSION;
    doc["uptime_ms"]    = millis();
    doc["free_heap"]    = ESP.getFreeHeap();

    const auto& dyp  = DypSensor::getInstance().snapshot();
    doc["water_level_mm"]  = dyp.waterLevelMm;
    doc["distance_mm"]     = dyp.distanceMm;
    doc["sensor_valid"]    = dyp.valid;
    doc["sensor_detected"] = dyp.detected;
    doc["zero_dist_mm"]    = DypSensor::getInstance().zeroDistanceMm();

    const auto& fsm = FloodStateMachine::getInstance().snapshot();
    doc["flood_state"]  = floodStateStr(fsm.state);
    doc["l1_active"]    = fsm.l1Active;
    doc["l2_active"]    = fsm.l2Active;

    const auto& out_c = OutputController::getInstance().snapshot();
    doc["relay_siren"]  = out_c.sirenOn;
    doc["relay_flash"]  = out_c.flashOn;
    doc["relay_pump"]   = out_c.sumpPumpOn;
    doc["rf_siren"]     = out_c.rfDangerSirenOn;

    const auto& pump = PumpController::getInstance().snapshot();
    doc["pump_running"] = pump.running;

    const auto& vmon = VoltageMonitor::getInstance().snapshot();
    doc["battery_v"]    = serialized(String(vmon.voltage, 2));
    doc["batt_low"]     = vmon.lowBattery;

    const auto& left  = RemoteBoxManager::getInstance().leftStatus();
    const auto& right = RemoteBoxManager::getInstance().rightStatus();
    JsonObject lb = doc.createNestedObject("remote_left");
    lb["online"]  = left.online;
    lb["batt_v"]  = serialized(String(left.batteryVoltage, 2));
    lb["siren"]   = left.sirenOn;
    lb["flash"]   = left.flashOn;
    JsonObject rb = doc.createNestedObject("remote_right");
    rb["online"]  = right.online;
    rb["batt_v"]  = serialized(String(right.batteryVoltage, 2));
    rb["siren"]   = right.sirenOn;
    rb["flash"]   = right.flashOn;

    serializeJson(doc, out, outSize);
}

void TelemetryManager::buildEventJson(char* out, size_t outSize,
                                       const char* type, const char* detail) const {
    StaticJsonDocument<256> doc;
    doc["device_id"] = _deviceId;
    doc["event"]     = type;
    doc["uptime_ms"] = millis();
    if (detail && detail[0]) doc["detail"] = detail;
    const auto& fsm  = FloodStateMachine::getInstance().snapshot();
    doc["state"]     = floodStateStr(fsm.state);
    doc["level_mm"]  = fsm.waterLevelMm;
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
