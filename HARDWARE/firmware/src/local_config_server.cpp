#include "local_config_server.h"

#include <ArduinoJson.h>
#include <ESP.h>
#include <ESPmDNS.h>
#include <WebServer.h>
#include <WiFi.h>

#include "config_manager.h"

namespace {
WebServer gServer(80);
LocalConfigServer* gInstance = nullptr;
}

LocalConfigServer& LocalConfigServer::getInstance() {
    static LocalConfigServer instance;
    return instance;
}

void LocalConfigServer::begin() {
    gInstance = this;
    ensureServerStarted();
}

void LocalConfigServer::loop(
    AlarmState state,
    const SensorSnapshot& sensor,
    const SwitchSnapshot& switches,
    bool mqttConnected
) {
    _state = state;
    _sensor = sensor;
    _switches = switches;
    _mqttConnected = mqttConnected;

    ensureServerStarted();
    if (_started) {
        gServer.handleClient();
    }
}

void LocalConfigServer::ensureServerStarted() {
    if (_started || WiFi.status() != WL_CONNECTED) {
        return;
    }

    MDNS.begin("floodguard");
    const char* headers[] = {"X-Local-Pin"};
    gServer.collectHeaders(headers, 1);

    gServer.on("/", []() {
        const char* html =
            "<html><body><h2>FloodGuard Local Config</h2>"
            "<p>Endpoints: /status /config /save-config /reboot</p>"
            "<p>Warning: Changing thresholds affects alarm behavior. "
            "All changes are stored in device memory and reported to server when online.</p>"
            "<p>Use POST /save-config with JSON body and pin query: ?pin=xxxx</p>"
            "</body></html>";
        gServer.send(200, "text/html", html);
    });

    gServer.on("/status", HTTP_GET, []() {
        if (!gInstance) {
            gServer.send(500, "application/json", "{\"ok\":false}");
            return;
        }
        const auto& cfg = ConfigManager::getInstance().getRuntimeConfig();
        StaticJsonDocument<1024> doc;
        doc["device_id"] = cfg.deviceId;
        doc["location_id"] = cfg.locationId;
        doc["status"] = gInstance->statusToString(gInstance->_state);
        doc["water_level_mm"] = gInstance->_sensor.waterLevelMm;
        doc["distance_mm"] = gInstance->_sensor.distanceMm;
        doc["rs485_status"] = gInstance->_sensor.fault ? "FAULT" : (gInstance->_sensor.enabled ? "OK" : "DISABLED");
        doc["switch_level_1_closed"] = gInstance->_switches.switch300Closed;
        doc["switch_level_2_closed"] = gInstance->_switches.switch500Closed;
        doc["rs485_sensor_enabled"] = cfg.rs485SensorEnabled;
        doc["switch_sensor_enabled"] = cfg.switchSensorEnabled;
        doc["alert_level_mm"] = cfg.alertLevelMm;
        doc["danger_level_mm"] = cfg.dangerLevelMm;
        doc["clear_level_mm"] = cfg.clearLevelMm;
        doc["trigger_delay_seconds"] = cfg.triggerDelaySeconds;
        doc["clear_delay_seconds"] = cfg.clearDelaySeconds;
        doc["config_version"] = cfg.configVersion;
        doc["last_saved_epoch"] = cfg.lastSavedEpoch;
        doc["mqtt_connected"] = gInstance->_mqttConnected;
        doc["ip"] = WiFi.localIP().toString();

        char payload[1024]{};
        serializeJson(doc, payload, sizeof(payload));
        gServer.send(200, "application/json", payload);
    });

    gServer.on("/config", HTTP_GET, []() {
        if (!gInstance || !gInstance->isAuthorized()) {
            gServer.send(401, "application/json", "{\"ok\":false,\"error\":\"PIN required\"}");
            return;
        }
        char payload[768]{};
        if (!ConfigManager::getInstance().buildRuntimeConfigJson(payload, sizeof(payload))) {
            gServer.send(500, "application/json", "{\"ok\":false,\"error\":\"config_export_failed\"}");
            return;
        }
        gServer.send(200, "application/json", payload);
    });

    gServer.on("/save-config", HTTP_POST, []() {
        if (!gInstance || !gInstance->isAuthorized()) {
            gServer.send(401, "application/json", "{\"ok\":false,\"error\":\"PIN required\"}");
            return;
        }

        String payload = gServer.arg("plain");
        if (payload.length() == 0 && gServer.hasArg("config")) {
            payload = gServer.arg("config");
        }

        String reason;
        if (!ConfigManager::getInstance().applyRuntimeConfigFromJson(payload.c_str(), reason, "device_local_page")) {
            StaticJsonDocument<320> doc;
            doc["ok"] = false;
            doc["error"] = reason;
            char out[320]{};
            serializeJson(doc, out, sizeof(out));
            gServer.send(400, "application/json", out);
            return;
        }

        char updated[768]{};
        ConfigManager::getInstance().buildRuntimeConfigJson(updated, sizeof(updated));
        StaticJsonDocument<900> doc;
        doc["ok"] = true;
        doc["message"] = "Configuration saved to NVS";
        doc["config_json"] = updated;
        char out[900]{};
        serializeJson(doc, out, sizeof(out));
        gServer.send(200, "application/json", out);
    });

    gServer.on("/reboot", HTTP_POST, []() {
        if (!gInstance || !gInstance->isAuthorized()) {
            gServer.send(401, "application/json", "{\"ok\":false,\"error\":\"PIN required\"}");
            return;
        }
        gServer.send(200, "application/json", "{\"ok\":true,\"message\":\"rebooting\"}");
        delay(200);
        ESP.restart();
    });

    gServer.begin();
    _started = true;
}

bool LocalConfigServer::isAuthorized() {
    String pin;
    if (gServer.hasArg("pin")) {
        pin = gServer.arg("pin");
    } else if (gServer.hasHeader("X-Local-Pin")) {
        pin = gServer.header("X-Local-Pin");
    }

    if (pin.length() == 0) {
        return false;
    }
    return ConfigManager::getInstance().verifyLocalPin(pin);
}

String LocalConfigServer::statusToString(AlarmState state) const {
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
