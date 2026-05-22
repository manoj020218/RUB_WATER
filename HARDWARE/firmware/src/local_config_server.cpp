#include "local_config_server.h"

#include <ArduinoJson.h>
#include <ESP.h>
#include <ESPmDNS.h>
#include <HTTPClient.h>
#include <WebServer.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <cctype>

#include "config_manager.h"
#include "http_fallback.h"
#include "mqtt_client.h"

namespace {
WebServer gServer(80);
LocalConfigServer* gInstance = nullptr;
constexpr const char* kMdnsHost = "floodguard-mcu";

String normalizeBaseUrl(const String& raw) {
    String out = raw;
    out.trim();
    if (out.length() == 0) {
        return out;
    }

    if (!out.startsWith("http://") && !out.startsWith("https://")) {
        out = String("https://") + out;
    }

    while (out.endsWith("/")) {
        out.remove(out.length() - 1);
    }

    if (out.endsWith("/health")) {
        out = out.substring(0, out.length() - 7);
    }
    if (out.endsWith("/api")) {
        out = out.substring(0, out.length() - 4);
    }
    while (out.endsWith("/")) {
        out.remove(out.length() - 1);
    }
    return out;
}

String swapHttpScheme(const String& raw) {
    String url = raw;
    url.trim();
    if (url.length() == 0) {
        return "";
    }
    if (url.startsWith("https://")) {
        return String("http://") + url.substring(8);
    }
    if (url.startsWith("http://")) {
        return String("https://") + url.substring(7);
    }
    return "";
}

String sanitizeErrorDetail(String value, size_t maxLen = 140) {
    value.replace('\n', ' ');
    value.replace('\r', ' ');
    value.trim();
    if (value.length() > static_cast<int>(maxLen)) {
        value = value.substring(0, static_cast<int>(maxLen));
    }
    return value;
}

String extractHostFromUrl(const String& url) {
    String work = url;
    work.trim();
    if (work.length() == 0) {
        return "";
    }

    const int schemePos = work.indexOf("://");
    if (schemePos >= 0) {
        work = work.substring(schemePos + 3);
    }

    const int slashPos = work.indexOf('/');
    if (slashPos >= 0) {
        work = work.substring(0, slashPos);
    }

    work.trim();
    return work;
}

String stripPort(const String& hostPort) {
    String host = hostPort;
    host.trim();
    if (host.length() == 0) {
        return host;
    }

    const int closeBracket = host.indexOf(']');
    if (host.startsWith("[") && closeBracket > 0) {
        // IPv6 literal, keep as-is unless explicit :port is outside the bracket.
        return host.substring(0, closeBracket + 1);
    }

    const int colonPos = host.lastIndexOf(':');
    if (colonPos > 0) {
        bool numericPort = true;
        for (int i = colonPos + 1; i < host.length(); ++i) {
            if (!std::isdigit(static_cast<unsigned char>(host.charAt(i)))) {
                numericPort = false;
                break;
            }
        }
        if (numericPort) {
            host = host.substring(0, colonPos);
        }
    }
    host.trim();
    return host;
}

uint16_t parsePort(const String& hostPort, uint16_t fallbackPort) {
    String host = hostPort;
    host.trim();
    if (host.length() == 0) {
        return fallbackPort;
    }

    const int closeBracket = host.indexOf(']');
    if (host.startsWith("[") && closeBracket > 0) {
        const int colonAfterIpv6 = host.indexOf(':', closeBracket);
        if (colonAfterIpv6 > 0) {
            const String portText = host.substring(colonAfterIpv6 + 1);
            const uint32_t parsed = static_cast<uint32_t>(portText.toInt());
            if (parsed > 0 && parsed <= 65535) {
                return static_cast<uint16_t>(parsed);
            }
        }
        return fallbackPort;
    }

    const int colonPos = host.lastIndexOf(':');
    if (colonPos <= 0) {
        return fallbackPort;
    }

    const String portText = host.substring(colonPos + 1);
    if (portText.length() == 0) {
        return fallbackPort;
    }
    for (int i = 0; i < portText.length(); ++i) {
        if (!std::isdigit(static_cast<unsigned char>(portText.charAt(i)))) {
            return fallbackPort;
        }
    }
    const uint32_t parsed = static_cast<uint32_t>(portText.toInt());
    if (parsed > 0 && parsed <= 65535) {
        return static_cast<uint16_t>(parsed);
    }
    return fallbackPort;
}

bool beginHttpRequest(HTTPClient& client, WiFiClient& plainClient, WiFiClientSecure& secureClient, const String& url) {
    client.setConnectTimeout(5000);
    client.setTimeout(8000);
    client.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
    if (url.startsWith("https://")) {
        secureClient.setInsecure();
        return client.begin(secureClient, url);
    }
    return client.begin(plainClient, url);
}

bool registerDeviceAndFetchKey(
    const String& rawBaseUrl,
    const DeviceConfig& cfg,
    const String& provisionKey,
    String& outDeviceKey,
    String& outMqttHost,
    uint16_t& outMqttPort,
    String* errorText = nullptr
) {
    outDeviceKey = "";
    outMqttHost = "";
    if (errorText != nullptr) {
        *errorText = "";
    }

    if (WiFi.status() != WL_CONNECTED) {
        if (errorText != nullptr) {
            *errorText = "wifi_not_connected";
        }
        return false;
    }

    const String baseUrl = normalizeBaseUrl(rawBaseUrl);
    if (baseUrl.length() == 0) {
        if (errorText != nullptr) {
            *errorText = "empty_vps_base_url";
        }
        return false;
    }
    DynamicJsonDocument reqDoc(320);
    reqDoc["device_id"] = cfg.deviceId;
    reqDoc["location_id"] = cfg.locationId;
    reqDoc["hardware_code"] = cfg.hardwareCode;
    reqDoc["firmware_version"] = cfg.firmwareVersion;
    String body;
    serializeJson(reqDoc, body);

    String registerUrls[2];
    size_t registerUrlCount = 0;
    registerUrls[registerUrlCount++] = baseUrl + "/api/device/register";
    const String swappedBase = swapHttpScheme(baseUrl);
    if (swappedBase.length() > 0 && registerUrlCount < 2) {
        const String swapped = swappedBase + "/api/device/register";
        if (swapped != registerUrls[0]) {
            registerUrls[registerUrlCount++] = swapped;
        }
    }

    String lastError = "register_failed";
    for (size_t idx = 0; idx < registerUrlCount; ++idx) {
        HTTPClient client;
        WiFiClient plainClient;
        WiFiClientSecure secureClient;
        if (!beginHttpRequest(client, plainClient, secureClient, registerUrls[idx])) {
            lastError = "register_begin_failed";
            continue;
        }
        client.addHeader("Content-Type", "application/json");
        if (provisionKey.length() > 0) {
            client.addHeader("x-provision-key", provisionKey);
        }

        const int code = client.POST(body);
        String response = client.getString();
        client.end();
        if (code < 200 || code >= 300) {
            if (code < 0) {
                String detail = sanitizeErrorDetail(HTTPClient::errorToString(code), 96);
                if (detail.length() == 0) {
                    detail = String("register_http_") + String(code);
                }
                lastError = detail;
            } else {
                String detail = sanitizeErrorDetail(response, 96);
                if (detail.length() == 0) {
                    detail = String("register_http_") + String(code);
                }
                lastError = detail;
            }
            continue;
        }

        DynamicJsonDocument rsp(2048);
        if (deserializeJson(rsp, response) != DeserializationError::Ok) {
            lastError = "register_parse_failed";
            continue;
        }

        JsonObject root = rsp.as<JsonObject>();
        JsonObject data = root["data"].is<JsonObject>() ? root["data"].as<JsonObject>() : root;
        outDeviceKey = String(data["device_key"] | "");
        if (outDeviceKey.length() == 0) {
            outDeviceKey = String(data["device_token"] | "");
        }
        if (outDeviceKey.length() == 0) {
            outDeviceKey = String(data["api_key"] | "");
        }
        outDeviceKey.trim();
        if (outDeviceKey.length() == 0) {
            const String message = String(root["message"] | root["error"] | data["message"] | "");
            if (message.length() > 0) {
                lastError = sanitizeErrorDetail(message, 96);
            } else {
                lastError = "register_missing_device_key";
            }
            continue;
        }

        JsonObject cloud = data["cloud"].is<JsonObject>() ? data["cloud"].as<JsonObject>() : JsonObject();
        if (!cloud.isNull()) {
            JsonObject mqtt = cloud["mqtt"].is<JsonObject>() ? cloud["mqtt"].as<JsonObject>() : JsonObject();
            if (!mqtt.isNull()) {
                const String host = String(mqtt["host"] | "");
                if (host.length() > 0) {
                    outMqttHost = stripPort(extractHostFromUrl(host));
                }
                const uint16_t port = static_cast<uint16_t>(mqtt["port"] | outMqttPort);
                if (port > 0) {
                    outMqttPort = port;
                }
            }
        }
        return true;
    }

    if (errorText != nullptr) {
        *errorText = lastError;
    }
    return false;
}
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

    MDNS.begin(kMdnsHost);
    const char* headers[] = {"X-Local-Pin"};
    gServer.collectHeaders(headers, 1);

    gServer.on("/", []() {
        const char* html = R"html(
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>FloodGuard MCU Local</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 16px; color: #0f172a; background: #f8fafc; }
    .card { background: #fff; border: 1px solid #cbd5e1; border-radius: 10px; padding: 14px; margin-bottom: 12px; }
    h2 { margin: 0 0 8px; }
    h3 { margin: 0 0 8px; font-size: 16px; }
    label { display: block; font-weight: 600; margin-top: 8px; }
    input { width: 100%; box-sizing: border-box; padding: 8px; border: 1px solid #94a3b8; border-radius: 8px; margin-top: 4px; }
    button { margin-top: 10px; padding: 8px 12px; border: 0; border-radius: 8px; background: #0ea5e9; color: #fff; font-weight: 700; cursor: pointer; }
    button.secondary { background: #334155; margin-left: 8px; }
    code { background: #e2e8f0; padding: 1px 4px; border-radius: 4px; }
    .hint { font-size: 13px; color: #334155; }
    pre { white-space: pre-wrap; background: #0f172a; color: #e2e8f0; border-radius: 8px; padding: 10px; min-height: 80px; }
  </style>
</head>
<body>
  <div class="card">
    <h2>FloodGuard MCU Local</h2>
    <div class="hint">Open this page using <code>http://floodguard-mcu.local</code> or device IP.</div>
    <div class="hint">Endpoints: <code>/status</code> <code>/config</code> <code>/save-config</code> <code>/cloud</code> <code>/reboot</code></div>
  </div>

  <div class="card">
    <h3>Quick Cloud Connect</h3>
    <label>Local PIN</label>
    <input id="pin" type="password" placeholder="Enter local PIN" />
    <label>VPS / API URL</label>
    <input id="vps" type="text" placeholder="https://api.floodguard.iotsoft.in" />
    <label>MQTT Host (Optional)</label>
    <input id="mqttHost" type="text" placeholder="auto from VPS host" />
    <label>Device Token (Optional)</label>
    <input id="deviceToken" type="text" placeholder="Paste provisioning token" />
    <label>Provision Key (Optional)</label>
    <input id="provisionKey" type="text" placeholder="x-provision-key for auto register" />
    <div>
      <button onclick="applyCloud()">Apply Cloud</button>
      <button class="secondary" onclick="loadCloud()">Read Current</button>
    </div>
    <pre id="out">Ready</pre>
  </div>

  <script>
    function text(v) { return (v === undefined || v === null) ? '' : String(v); }
    function out(msg) { document.getElementById('out').textContent = text(msg); }

    async function loadCloud() {
      const pin = text(document.getElementById('pin').value).trim();
      if (!pin) { out('PIN required'); return; }
      try {
        const res = await fetch('/cloud?pin=' + encodeURIComponent(pin));
        const data = await res.json();
        out(JSON.stringify(data, null, 2));
        if (data && data.ok && data.cloud) {
          if (data.cloud.vps_base_url) document.getElementById('vps').value = data.cloud.vps_base_url;
          if (data.cloud.mqtt_host) document.getElementById('mqttHost').value = data.cloud.mqtt_host;
        }
      } catch (e) {
        out('Read failed: ' + e.message);
      }
    }

    async function applyCloud() {
      const pin = text(document.getElementById('pin').value).trim();
      const vps = text(document.getElementById('vps').value).trim();
      const mqttHost = text(document.getElementById('mqttHost').value).trim();
      const deviceToken = text(document.getElementById('deviceToken').value).trim();
      const provisionKey = text(document.getElementById('provisionKey').value).trim();
      if (!pin) { out('PIN required'); return; }
      if (!vps) { out('VPS/API URL required'); return; }

      const body = { vps_url: vps };
      if (mqttHost) body.mqtt_host = mqttHost;
      if (deviceToken) body.device_token = deviceToken;
      if (provisionKey) body.provision_key = provisionKey;

      try {
        const res = await fetch('/cloud?pin=' + encodeURIComponent(pin), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await res.json();
        out(JSON.stringify(data, null, 2));
      } catch (e) {
        out('Apply failed: ' + e.message);
      }
    }
  </script>
</body>
</html>
)html";
        gServer.send(200, "text/html", html);
    });

    gServer.on("/cloud", HTTP_GET, []() {
        if (!gInstance || !gInstance->isAuthorized()) {
            gServer.send(401, "application/json", "{\"ok\":false,\"error\":\"PIN required\"}");
            return;
        }

        const DeviceConfig& cfg = ConfigManager::getInstance().getConfig();
        StaticJsonDocument<512> doc;
        doc["ok"] = true;
        JsonObject cloud = doc.createNestedObject("cloud");
        cloud["vps_base_url"] = cfg.httpBaseUrl;
        cloud["mqtt_host"] = cfg.mqttHost;
        cloud["mqtt_port"] = cfg.mqttPort;
        cloud["wifi_connected"] = WiFi.status() == WL_CONNECTED;
        cloud["ip"] = WiFi.localIP().toString();
        cloud["mqtt_connected"] = gInstance->_mqttConnected;

        char out[512]{};
        serializeJson(doc, out, sizeof(out));
        gServer.send(200, "application/json", out);
    });

    gServer.on("/cloud", HTTP_POST, []() {
        if (!gInstance || !gInstance->isAuthorized()) {
            gServer.send(401, "application/json", "{\"ok\":false,\"error\":\"PIN required\"}");
            return;
        }

        String payload = gServer.arg("plain");
        if (payload.length() == 0) {
            gServer.send(400, "application/json", "{\"ok\":false,\"error\":\"body_required\"}");
            return;
        }

        DynamicJsonDocument req(512);
        if (deserializeJson(req, payload) != DeserializationError::Ok) {
            gServer.send(400, "application/json", "{\"ok\":false,\"error\":\"invalid_json\"}");
            return;
        }

        String vpsUrl = String(req["vps_url"] | req["api_url"] | req["vps"] | "");
        vpsUrl = normalizeBaseUrl(vpsUrl);
        if (vpsUrl.length() == 0) {
            gServer.send(400, "application/json", "{\"ok\":false,\"error\":\"vps_url_required\"}");
            return;
        }

        const DeviceConfig& cfg = ConfigManager::getInstance().getConfig();
        String mqttHostInput = String(req["mqtt_host"] | "");
        mqttHostInput.trim();
        uint16_t mqttPort = cfg.mqttPort;  // keep fixed unless cloud register explicitly returns one
        String deviceToken = String(req["device_token"] | req["token"] | "");
        if (deviceToken.length() == 0 && gServer.hasArg("device_token")) {
            deviceToken = gServer.arg("device_token");
        }
        if (deviceToken.length() == 0 && gServer.hasArg("token")) {
            deviceToken = gServer.arg("token");
        }
        deviceToken.trim();
        String provisionKey = String(req["provision_key"] | req["pk"] | "");
        if (provisionKey.length() == 0 && gServer.hasArg("provision_key")) {
            provisionKey = gServer.arg("provision_key");
        }
        if (provisionKey.length() == 0 && gServer.hasArg("pk")) {
            provisionKey = gServer.arg("pk");
        }
        provisionKey.trim();
        bool deviceKeyRegistered = false;

        if (deviceToken.length() == 0 && provisionKey.length() > 0) {
            String fetchedToken;
            String fetchedMqttHost;
            String registerError;
            uint16_t fetchedMqttPort = mqttPort;
            const bool registered = registerDeviceAndFetchKey(
                vpsUrl,
                cfg,
                provisionKey,
                fetchedToken,
                fetchedMqttHost,
                fetchedMqttPort,
                &registerError
            );
            if (!registered) {
                StaticJsonDocument<256> errDoc;
                errDoc["ok"] = false;
                errDoc["error"] = "device_register_failed";
                if (registerError.length() > 0) {
                    errDoc["detail"] = registerError;
                }
                char outErr[256] = {};
                serializeJson(errDoc, outErr, sizeof(outErr));
                gServer.send(400, "application/json", outErr);
                return;
            }
            deviceToken = fetchedToken;
            deviceKeyRegistered = true;
            if (mqttHostInput.length() == 0 && fetchedMqttHost.length() > 0) {
                mqttHostInput = fetchedMqttHost;
            }
            if (fetchedMqttPort > 0) {
                mqttPort = fetchedMqttPort;
            }
        }

        String hostFromUrl = extractHostFromUrl(vpsUrl);
        if (hostFromUrl.length() == 0) {
            gServer.send(400, "application/json", "{\"ok\":false,\"error\":\"invalid_vps_url\"}");
            return;
        }

        if (mqttHostInput.length() == 0) {
            mqttHostInput = hostFromUrl;
        }
        const uint16_t parsedPortFromHost = parsePort(mqttHostInput, mqttPort);
        (void)parsedPortFromHost;  // intentionally ignored (fixed port)
        const String mqttHost = stripPort(mqttHostInput);
        if (mqttHost.length() == 0) {
            gServer.send(400, "application/json", "{\"ok\":false,\"error\":\"invalid_mqtt_host\"}");
            return;
        }

        HttpFallbackService::getInstance().updateCloudAuth(
            vpsUrl.c_str(),
            deviceToken.length() > 0 ? deviceToken.c_str() : nullptr,
            true
        );
        const char* mqttUserArg = nullptr;
        const char* mqttPassArg = nullptr;
        if (deviceToken.length() > 0) {
            mqttUserArg = "";
            mqttPassArg = deviceToken.c_str();
        }
        MqttClientService::getInstance().updateConnection(
            mqttHost.c_str(),
            mqttPort,
            mqttUserArg,
            mqttPassArg,
            true
        );

        StaticJsonDocument<640> doc;
        doc["ok"] = true;
        doc["message"] = "Cloud target saved. Device will retry cloud connection.";
        JsonObject applied = doc.createNestedObject("applied");
        applied["vps_base_url"] = vpsUrl;
        applied["mqtt_host"] = mqttHost;
        applied["mqtt_port"] = mqttPort;
        applied["device_key_registered"] = deviceKeyRegistered;
        applied["token_applied"] = deviceToken.length() > 0;
        applied["token_length"] = deviceToken.length();
        applied["wifi_connected"] = WiFi.status() == WL_CONNECTED;
        applied["ip"] = WiFi.localIP().toString();
        applied["mqtt_connected"] = gInstance->_mqttConnected;

        char out[640]{};
        serializeJson(doc, out, sizeof(out));
        gServer.send(200, "application/json", out);
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
