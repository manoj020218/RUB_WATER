#include "ble_provisioning.h"

#include <cmath>
#include <cctype>
#include <ArduinoJson.h>
#include <BLEAdvertising.h>
#include <BLECharacteristic.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <ESP.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClient.h>
#include <esp_err.h>
#include <esp_mac.h>

#include "http_fallback.h"
#include "mqtt_client.h"
#include "voltage_monitor.h"
#include "wifi_manager.h"

namespace {
constexpr const char* kBleServiceUuid = "0000ff00-0000-1000-8000-00805f9b34fb";
constexpr const char* kBleCharacteristicUuid = "0000ff01-0000-1000-8000-00805f9b34fb";
constexpr uint8_t kMaxWifiNetworks = 8;

BleProvisioningService* gProvisionServiceInstance = nullptr;
BLEServer* gBleServer = nullptr;
BLEService* gBleService = nullptr;
BLECharacteristic* gBleCharacteristic = nullptr;

String sanitizeSsid(const String& value) {
    String out = value;
    out.trim();
    // IEEE 802.11 SSID max is 32 octets; allow up to 63 chars from UI side
    // to avoid accidental truncation of valid mixed-character names.
    if (out.length() > 63) {
        out = out.substring(0, 63);
    }
    return out;
}

bool readOptionalFloat(JsonObjectConst obj, const char* key, float& outValue) {
    if (!obj.containsKey(key)) {
        return false;
    }
    const float parsed = obj[key].as<float>();
    if (!std::isfinite(parsed)) {
        return false;
    }
    outValue = parsed;
    return true;
}

const char* wifiAuthToString(wifi_auth_mode_t mode) {
    switch (mode) {
        case WIFI_AUTH_OPEN: return "OPEN";
        case WIFI_AUTH_WEP: return "WEP";
        case WIFI_AUTH_WPA_PSK: return "WPA";
        case WIFI_AUTH_WPA2_PSK: return "WPA2";
        case WIFI_AUTH_WPA_WPA2_PSK: return "WPA_WPA2";
        case WIFI_AUTH_WPA2_ENTERPRISE: return "WPA2_ENT";
        case WIFI_AUTH_WPA3_PSK: return "WPA3";
        case WIFI_AUTH_WPA2_WPA3_PSK: return "WPA2_WPA3";
        default: return "UNKNOWN";
    }
}

String healthUrlFromBase(const String& raw) {
    String url = raw;
    url.trim();
    if (url.length() == 0) {
        return "";
    }

    if (url.endsWith("/health")) {
        return url;
    }
    if (url.endsWith("/api")) {
        url = url.substring(0, url.length() - 4);
    }

    while (url.endsWith("/")) {
        url.remove(url.length() - 1);
    }
    url += "/health";
    return url;
}

String fallbackHealthUrl(const String& raw, const String& primaryHealthUrl) {
    String url = raw;
    url.trim();
    if (url.length() == 0) {
        return "";
    }

    while (url.endsWith("/")) {
        url.remove(url.length() - 1);
    }

    String candidate;
    if (url.endsWith("/api")) {
        candidate = url + "/health";            // try /api/health if primary became /health
    } else if (url.endsWith("/api/health")) {
        candidate = url.substring(0, url.length() - 11) + "/health";
    } else if (url.endsWith("/health")) {
        candidate = url.substring(0, url.length() - 7) + "/api/health";
    } else {
        candidate = url + "/api/health";
    }

    if (candidate == primaryHealthUrl) {
        return "";
    }
    return candidate;
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

void appendUniqueUrl(String* urls, size_t& count, size_t maxCount, const String& candidate) {
    if (candidate.length() == 0 || count >= maxCount || urls == nullptr) {
        return;
    }
    for (size_t i = 0; i < count; ++i) {
        if (urls[i] == candidate) {
            return;
        }
    }
    urls[count++] = candidate;
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

String normalizeBaseUrl(const String& raw) {
    String out = raw;
    out.trim();
    if (out.length() == 0) {
        return out;
    }
    if (!out.startsWith("http://") && !out.startsWith("https://")) {
        out = String("http://") + out;
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
    const int colonPos = work.lastIndexOf(':');
    if (colonPos > 0) {
        bool numericPort = true;
        for (int i = colonPos + 1; i < work.length(); ++i) {
            if (!std::isdigit(static_cast<unsigned char>(work.charAt(i)))) {
                numericPort = false;
                break;
            }
        }
        if (numericPort) {
            work = work.substring(0, colonPos);
        }
    }
    work.trim();
    return work;
}

bool beginHttpRequest(HTTPClient& client, WiFiClient& plainClient, const String& url) {
    client.setConnectTimeout(5000);
    client.setTimeout(8000);
    client.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
    if (url.startsWith("https://")) {
        return false;  // HTTPS not supported; avoids SSL stack allocation
    }
    return client.begin(plainClient, url);
}

bool registerDeviceAndFetchKey(
    const String& rawBaseUrl,
    const DeviceConfig& config,
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

    // BLE + WiFi share the 2.4GHz radio on ESP32-S3. The BLE write that
    // triggered this command can cause a brief WiFi drop. Retry up to 3 s.
    for (uint8_t i = 0; i < 6 && WiFi.status() != WL_CONNECTED; i++) {
        delay(500);
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
    reqDoc["device_id"] = config.deviceId;
    reqDoc["location_id"] = config.locationId;
    reqDoc["hardware_code"] = config.hardwareCode;
    reqDoc["firmware_version"] = config.firmwareVersion;
    String body;
    serializeJson(reqDoc, body);

    String registerUrls[2];
    size_t registerUrlCount = 0;
    appendUniqueUrl(registerUrls, registerUrlCount, 2, baseUrl + "/api/device/register");
    const String swappedBase = swapHttpScheme(baseUrl);
    if (swappedBase.length() > 0) {
        appendUniqueUrl(registerUrls, registerUrlCount, 2, swappedBase + "/api/device/register");
    }

    String lastError = "register_failed";
    for (size_t idx = 0; idx < registerUrlCount; ++idx) {
        const String registerUrl = registerUrls[idx];
        HTTPClient client;
        WiFiClient plainClient;
        if (!beginHttpRequest(client, plainClient, registerUrl)) {
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
                    outMqttHost = extractHostFromUrl(host);
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

bool httpGetHealth(const String& healthUrl, int& statusCode, uint32_t& elapsedMs, String* errorText = nullptr) {
    statusCode = 0;
    elapsedMs = 0;
    if (errorText != nullptr) {
        *errorText = "";
    }

    const auto applyErrorDetail = [&](HTTPClient& clientRef) {
        if (errorText == nullptr) {
            return;
        }
        if (statusCode < 0) {
            *errorText = HTTPClient::errorToString(statusCode);
            return;
        }

        String detail = clientRef.getString();
        detail.replace('\n', ' ');
        detail.replace('\r', ' ');
        detail.trim();
        if (detail.length() > 140) {
            detail = detail.substring(0, 140);
        }
        if (detail.length() > 0) {
            *errorText = detail;
        } else {
            *errorText = String("http_") + String(statusCode);
        }
    };

    if (healthUrl.startsWith("https://")) {
        if (errorText != nullptr) {
            *errorText = "https_not_supported";
        }
        return false;
    }

    WiFiClient plainClient;
    HTTPClient client;
    client.setTimeout(5000);
    client.setConnectTimeout(5000);
    client.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
    if (!client.begin(plainClient, healthUrl)) {
        if (errorText != nullptr) {
            *errorText = "http_begin_failed";
        }
        return false;
    }

    const unsigned long start = millis();
    statusCode = client.GET();
    elapsedMs = millis() - start;
    if (statusCode < 200 || statusCode >= 400) {
        applyErrorDetail(client);
    }
    client.end();
    return statusCode >= 200 && statusCode < 400;
}

bool probeVpsHealth(const String& baseOrHealthUrl, int& statusCode, uint32_t& elapsedMs, String* errorText = nullptr) {
    statusCode = 0;
    elapsedMs = 0;
    if (errorText != nullptr) {
        *errorText = "";
    }
    if (WiFi.status() != WL_CONNECTED) {
        if (errorText != nullptr) {
            *errorText = "wifi_not_connected";
        }
        return false;
    }

    const String healthUrl = healthUrlFromBase(baseOrHealthUrl);
    if (healthUrl.length() == 0) {
        if (errorText != nullptr) {
            *errorText = "empty_health_url";
        }
        return false;
    }

    // Probe matrix:
    // 1) primary /health
    // 2) primary /api/health fallback
    // 3) swapped scheme (http<->https) /health
    // 4) swapped scheme /api/health fallback
    String probeUrls[4];
    size_t probeCount = 0;
    appendUniqueUrl(probeUrls, probeCount, 4, healthUrl);
    appendUniqueUrl(probeUrls, probeCount, 4, fallbackHealthUrl(baseOrHealthUrl, healthUrl));

    const String swappedBase = swapHttpScheme(baseOrHealthUrl);
    if (swappedBase.length() > 0) {
        const String swappedHealth = healthUrlFromBase(swappedBase);
        appendUniqueUrl(probeUrls, probeCount, 4, swappedHealth);
        appendUniqueUrl(probeUrls, probeCount, 4, fallbackHealthUrl(swappedBase, swappedHealth));
    }

    String lastErr = "http_probe_failed";
    for (size_t i = 0; i < probeCount; ++i) {
        String attemptErr;
        if (httpGetHealth(probeUrls[i], statusCode, elapsedMs, &attemptErr)) {
            if (errorText != nullptr) {
                *errorText = "";
            }
            return true;
        }
        if (attemptErr.length() > 0) {
            lastErr = attemptErr;
        }
    }

    if (errorText != nullptr) {
        *errorText = lastErr;
    }
    return false;
}
}  // namespace

class BleProvisionCharacteristicCallbacks final : public BLECharacteristicCallbacks {
public:
    void onWrite(BLECharacteristic* characteristic) override {
        if (gProvisionServiceInstance == nullptr || characteristic == nullptr) {
            return;
        }

        const std::string value = characteristic->getValue();
        if (value.empty()) {
            return;
        }

        String payload;
        payload.reserve(value.size());
        for (char c : value) {
            if (c == '\0') {
                break;
            }
            payload += c;
        }
        gProvisionServiceInstance->queueIncoming(payload);
    }
};

BleProvisioningService& BleProvisioningService::getInstance() {
    static BleProvisioningService instance;
    return instance;
}

void BleProvisioningService::begin(const DeviceConfig&) {
    if (_started) {
        return;
    }

    buildIdentity();
    startAdvertising();
}

void BleProvisioningService::loop(const DeviceConfig& config, const NetworkDiagnostics& diagnostics, bool mqttConnected) {
    _latestDiagnostics = diagnostics;
    _mqttConnected = mqttConnected;

    if (!_started) {
        return;
    }
    processPendingCommand(config);
}

bool BleProvisioningService::isStarted() const {
    return _started;
}

const char* BleProvisioningService::getBroadcastName() const {
    return _bleName;
}

const char* BleProvisioningService::getMacSuffix() const {
    return _macSuffix;
}

void BleProvisioningService::buildIdentity() {
    uint8_t staMac[6] = {0};
    const esp_err_t macReadStatus = esp_read_mac(staMac, ESP_MAC_WIFI_STA);
    if (macReadStatus != ESP_OK) {
        snprintf(_macSuffix, sizeof(_macSuffix), "0000");
    } else {
        snprintf(_macSuffix, sizeof(_macSuffix), "%02X%02X", staMac[4], staMac[5]);
    }
    snprintf(_bleName, sizeof(_bleName), "JNX-FG%s", _macSuffix);
}

void BleProvisioningService::startAdvertising() {
    BLEDevice::init(_bleName);
    gBleServer = BLEDevice::createServer();
    gBleService = gBleServer->createService(kBleServiceUuid);
    gBleCharacteristic = gBleService->createCharacteristic(
        kBleCharacteristicUuid,
        BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR
    );
    gBleCharacteristic->setCallbacks(new BleProvisionCharacteristicCallbacks());
    gBleCharacteristic->setValue("{\"ok\":true,\"cmd\":\"ready\"}");
    gBleService->start();

    BLEAdvertising* advertising = BLEDevice::getAdvertising();
    if (advertising != nullptr) {
        advertising->addServiceUUID(kBleServiceUuid);
        advertising->setScanResponse(true);
        advertising->setMinPreferred(0x06);
        advertising->setMinPreferred(0x12);
        BLEDevice::startAdvertising();
        _started = true;
    }

    gProvisionServiceInstance = this;
}

void BleProvisioningService::processPendingCommand(const DeviceConfig& config) {
    if (!_pendingCommandReady) {
        return;
    }
    _pendingCommandReady = false;

    String response = handleCommand(_pendingCommand, config);
    if (gBleCharacteristic != nullptr) {
        if (response.length() > 590) {
            response = response.substring(0, 590);
        }
        gBleCharacteristic->setValue(response.c_str());
    }
}

String BleProvisioningService::handleCommand(const String& request, const DeviceConfig& config) {
    DynamicJsonDocument reqDoc(768);
    const DeserializationError error = deserializeJson(reqDoc, request);
    if (error) {
        return responseError("invalid_json");
    }

    String cmd = String(reqDoc["cmd"] | "");
    if (cmd.length() == 0) {
        cmd = String(reqDoc["op"] | "");
    }
    cmd.trim();
    cmd.toLowerCase();
    if (cmd.length() == 0) {
        return responseError("missing_cmd");
    }

    DynamicJsonDocument resDoc(1400);
    resDoc["ok"] = true;
    resDoc["cmd"] = cmd;
    resDoc["device_name"] = _bleName;
    resDoc["device_id"] = config.deviceId;
    resDoc["location_id"] = config.locationId;
    resDoc["fw"] = config.firmwareVersion;

    if (cmd == "hello") {
        resDoc["wifi_ssid"] = WifiManager::getInstance().getConfiguredSsid();
        resDoc["wifi_connected"] = WifiManager::getInstance().isConnected();
        resDoc["ip"] = WifiManager::getInstance().getLocalIp();
    } else if (cmd == "scan_wifi") {
        const int found = WiFi.scanNetworks(false, true);
        if (found < 0) {
            return responseError("wifi_scan_failed", cmd.c_str());
        }

        JsonArray networks = resDoc.createNestedArray("networks");
        for (int i = 0; i < found && networks.size() < kMaxWifiNetworks; ++i) {
            const String ssid = sanitizeSsid(WiFi.SSID(i));
            if (ssid.length() == 0) {
                continue;
            }

            JsonObject item = networks.createNestedObject();
            item["ssid"] = ssid;
            item["rssi"] = WiFi.RSSI(i);
            item["channel"] = WiFi.channel(i);
            item["auth"] = wifiAuthToString(static_cast<wifi_auth_mode_t>(WiFi.encryptionType(i)));
        }
        WiFi.scanDelete();
        resDoc["count"] = networks.size();
    } else if (cmd == "set_wifi" || cmd == "provision_wifi" || cmd == "w") {
        const bool compactMode = (cmd == "w");
        String ssid = String(reqDoc["ssid"] | "");
        if (ssid.length() == 0) {
            ssid = String(reqDoc["s"] | "");
        }
        if (ssid.length() == 0) {
            ssid = String(reqDoc["wifi"]["ssid"] | "");
        }
        ssid = sanitizeSsid(ssid);

        String password = String(reqDoc["password"] | "");
        if (password.length() == 0) {
            password = String(reqDoc["p"] | "");
        }
        if (password.length() == 0) {
            password = String(reqDoc["wifi"]["password"] | "");
        }

        if (ssid.length() == 0) {
            return responseError("ssid_required", cmd.c_str());
        }

        String vpsBase = String(reqDoc["vps_url"] | "");
        if (vpsBase.length() == 0) {
            vpsBase = String(reqDoc["u"] | "");
        }
        vpsBase.trim();
        if (vpsBase.length() == 0) {
            vpsBase = String(config.httpBaseUrl);
        }

        String deviceToken = String(reqDoc["provision_token"] | "");
        if (deviceToken.length() == 0) {
            deviceToken = String(reqDoc["device_token"] | "");
        }
        if (deviceToken.length() == 0) {
            deviceToken = String(reqDoc["token"] | "");
        }
        deviceToken.trim();

        String mqttHost = String(reqDoc["mqtt_host"] | "");
        mqttHost.trim();
        const uint16_t mqttPort = static_cast<uint16_t>(reqDoc["mqtt_port"] | config.mqttPort);

        String mqttUser = String(reqDoc["mqtt_user"] | "");
        mqttUser.trim();

        String mqttPass = String(reqDoc["mqtt_password"] | "");
        if (mqttPass.length() == 0) {
            mqttPass = String(reqDoc["mqtt_pass"] | "");
        }
        mqttPass.trim();
        if (mqttPass.length() == 0 && deviceToken.length() > 0) {
            mqttPass = deviceToken;
        }
        if (mqttUser.length() == 0 && mqttPass.length() > 0) {
            mqttUser = String(config.deviceId);
        }

        float dividerRatio = VoltageMonitor::getInstance().dividerRatio();
        float calibrationFactor = VoltageMonitor::getInstance().calibrationFactor();
        bool dividerProvided = readOptionalFloat(reqDoc.as<JsonObjectConst>(), "adc_divider_ratio", dividerRatio);
        if (!dividerProvided) {
            dividerProvided = readOptionalFloat(reqDoc.as<JsonObjectConst>(), "divider_ratio", dividerRatio);
        }
        bool calibrationProvided = readOptionalFloat(reqDoc.as<JsonObjectConst>(), "adc_calibration_factor", calibrationFactor);
        if (!calibrationProvided) {
            calibrationProvided = readOptionalFloat(reqDoc.as<JsonObjectConst>(), "calibration_factor", calibrationFactor);
        }

        if (dividerProvided || calibrationProvided) {
            String calibrationReason;
            const bool applied = VoltageMonitor::getInstance().updateCalibration(
                dividerRatio,
                calibrationFactor,
                true,
                calibrationReason
            );
            if (!applied) {
                return responseError(calibrationReason.c_str(), cmd.c_str());
            }
        }

        HttpFallbackService::getInstance().updateCloudAuth(
            vpsBase.c_str(),
            deviceToken.length() > 0 ? deviceToken.c_str() : nullptr,
            true
        );

        if (mqttHost.length() > 0 || mqttUser.length() > 0 || mqttPass.length() > 0) {
            MqttClientService::getInstance().updateConnection(
                mqttHost.length() > 0 ? mqttHost.c_str() : nullptr,
                mqttPort,
                mqttUser.length() > 0 ? mqttUser.c_str() : "",
                mqttPass.length() > 0 ? mqttPass.c_str() : "",
                true
            );
        }

        WifiManager::getInstance().setCredentials(ssid.c_str(), password.c_str(), true);
        const bool connected = WifiManager::getInstance().connectNow(30000UL);
        const int wifiStatus = WifiManager::getInstance().currentStatus();
        // Keep BLE response compact to avoid MTU truncation on phone reads.
        resDoc.remove("device_name");
        resDoc.remove("device_id");
        resDoc.remove("location_id");
        resDoc.remove("fw");
        if (compactMode) {
            resDoc["wc"] = connected;
            resDoc["ws"] = wifiStatus;
            resDoc["ip"] = WifiManager::getInstance().getLocalIp();
            resDoc["r"] = WifiManager::getInstance().getRssi();
        } else {
            resDoc["wifi_connected"] = connected;
            resDoc["wifi_status"] = wifiStatus;
            resDoc["wifi_status_text"] = WifiManager::getInstance().statusText(wifiStatus);
            resDoc["wifi_ssid"] = ssid;
            resDoc["ip"] = WifiManager::getInstance().getLocalIp();
            resDoc["rssi"] = WifiManager::getInstance().getRssi();
        }
        Serial.printf(
            "[BLE][set_wifi] ssid='%s' connected=%d status=%d(%s) ip=%s rssi=%ld\n",
            ssid.c_str(),
            connected ? 1 : 0,
            wifiStatus,
            WifiManager::getInstance().statusText(wifiStatus),
            resDoc["ip"].as<const char*>(),
            static_cast<long>(compactMode ? resDoc["r"].as<int>() : resDoc["rssi"].as<int>())
        );
        if (deviceToken.length() > 0) {
            if (compactMode) {
                resDoc["ta"] = true;
            } else {
                resDoc["token_applied"] = true;
            }
        }

        const bool shouldCheckVps = compactMode
            ? (reqDoc["cv"] | false)
            : (reqDoc["check_vps"] | true);
        if (shouldCheckVps) {
            int vpsCode = 0;
            uint32_t vpsMs = 0;
            String vpsErr;
            const bool vpsOk = probeVpsHealth(vpsBase, vpsCode, vpsMs, &vpsErr);
            if (compactMode) {
                resDoc["vr"] = vpsOk;
                resDoc["vh"] = vpsCode;
            } else {
                resDoc["vps_reachable"] = vpsOk;
                resDoc["vps_http_code"] = vpsCode;
            }
            if (vpsErr.length() > 0) {
                if (vpsErr.length() > 48) {
                    vpsErr = vpsErr.substring(0, 48);
                }
                if (compactMode) {
                    resDoc["ve"] = vpsErr;
                } else {
                    resDoc["vps_error"] = vpsErr;
                }
            }
            Serial.printf(
                "[BLE][set_wifi] vps_ok=%d http=%d latency=%lu err=%s\n",
                vpsOk ? 1 : 0,
                vpsCode,
                static_cast<unsigned long>(vpsMs),
                vpsErr.length() > 0 ? vpsErr.c_str() : "-"
            );
        }
    } else if (cmd == "set_cloud" || cmd == "provision_cloud" || cmd == "c") {
        const bool compactMode = (cmd == "c");
        String vpsBase = String(reqDoc["vps_url"] | "");
        if (vpsBase.length() == 0) {
            vpsBase = String(reqDoc["u"] | "");
        }
        vpsBase.trim();
        if (vpsBase.length() == 0) {
            vpsBase = String(config.httpBaseUrl);
        }
        Serial.printf("[BLE][set_cloud] vps_base=%s\n", vpsBase.c_str());

        String deviceToken = String(reqDoc["provision_token"] | "");
        if (deviceToken.length() == 0) {
            deviceToken = String(reqDoc["t"] | "");
        }
        if (deviceToken.length() == 0) {
            deviceToken = String(reqDoc["device_token"] | "");
        }
        if (deviceToken.length() == 0) {
            deviceToken = String(reqDoc["token"] | "");
        }
        deviceToken.trim();
        String provisionKey = String(reqDoc["provision_key"] | "");
        if (provisionKey.length() == 0) {
            provisionKey = String(reqDoc["pk"] | "");
        }
        provisionKey.trim();

        String mqttHost = String(reqDoc["mqtt_host"] | "");
        if (mqttHost.length() == 0) {
            mqttHost = String(reqDoc["mh"] | "");
        }
        mqttHost.trim();
        uint16_t mqttPort = static_cast<uint16_t>((reqDoc["mqtt_port"] | reqDoc["mp"]) | config.mqttPort);

        String mqttUser = String(reqDoc["mqtt_user"] | "");
        if (mqttUser.length() == 0) {
            mqttUser = String(reqDoc["mu"] | "");
        }
        mqttUser.trim();

        bool keyFetchedFromProvision = false;
        if (deviceToken.length() == 0 && provisionKey.length() > 0) {
            String registerError;
            String fetchedKey;
            String fetchedMqttHost;
            uint16_t fetchedMqttPort = mqttPort;
            const bool registered = registerDeviceAndFetchKey(
                vpsBase,
                config,
                provisionKey,
                fetchedKey,
                fetchedMqttHost,
                fetchedMqttPort,
                &registerError
            );
            if (!registered) {
                String err = "device_register_failed";
                if (registerError.length() > 0) {
                    err += ":";
                    err += registerError;
                }
                return responseError(err.c_str(), cmd.c_str());
            }
            deviceToken = fetchedKey;
            keyFetchedFromProvision = true;
            if (mqttHost.length() == 0 && fetchedMqttHost.length() > 0) {
                mqttHost = fetchedMqttHost;
            }
            if (fetchedMqttPort > 0) {
                mqttPort = fetchedMqttPort;
            }
        }

        String mqttPass = String(reqDoc["mqtt_password"] | "");
        if (mqttPass.length() == 0) {
            mqttPass = String(reqDoc["mw"] | "");
        }
        if (mqttPass.length() == 0) {
            mqttPass = String(reqDoc["mqtt_pass"] | "");
        }
        mqttPass.trim();
        if (mqttPass.length() == 0 && deviceToken.length() > 0) {
            mqttPass = deviceToken;
        }
        if (mqttUser.length() == 0 && mqttPass.length() > 0) {
            mqttUser = String(config.deviceId);
        }

        float dividerRatio = VoltageMonitor::getInstance().dividerRatio();
        float calibrationFactor = VoltageMonitor::getInstance().calibrationFactor();
        bool dividerProvided = readOptionalFloat(reqDoc.as<JsonObjectConst>(), "adc_divider_ratio", dividerRatio);
        if (!dividerProvided) {
            dividerProvided = readOptionalFloat(reqDoc.as<JsonObjectConst>(), "divider_ratio", dividerRatio);
        }
        if (!dividerProvided) {
            dividerProvided = readOptionalFloat(reqDoc.as<JsonObjectConst>(), "ar", dividerRatio);
        }
        bool calibrationProvided = readOptionalFloat(reqDoc.as<JsonObjectConst>(), "adc_calibration_factor", calibrationFactor);
        if (!calibrationProvided) {
            calibrationProvided = readOptionalFloat(reqDoc.as<JsonObjectConst>(), "calibration_factor", calibrationFactor);
        }
        if (!calibrationProvided) {
            calibrationProvided = readOptionalFloat(reqDoc.as<JsonObjectConst>(), "ac", calibrationFactor);
        }

        if (dividerProvided || calibrationProvided) {
            String calibrationReason;
            const bool applied = VoltageMonitor::getInstance().updateCalibration(
                dividerRatio,
                calibrationFactor,
                true,
                calibrationReason
            );
            if (!applied) {
                return responseError(calibrationReason.c_str(), cmd.c_str());
            }
        }

        const bool hasAnyCloudInput =
            vpsBase.length() > 0 ||
            deviceToken.length() > 0 ||
            provisionKey.length() > 0 ||
            mqttHost.length() > 0 ||
            mqttUser.length() > 0 ||
            mqttPass.length() > 0 ||
            dividerProvided ||
            calibrationProvided;
        if (!hasAnyCloudInput) {
            return responseError("cloud_fields_required", cmd.c_str());
        }

        HttpFallbackService::getInstance().updateCloudAuth(
            vpsBase.c_str(),
            deviceToken.length() > 0 ? deviceToken.c_str() : nullptr,
            true
        );

        if (mqttHost.length() > 0 || mqttUser.length() > 0 || mqttPass.length() > 0) {
            MqttClientService::getInstance().updateConnection(
                mqttHost.length() > 0 ? mqttHost.c_str() : nullptr,
                mqttPort,
                mqttUser.length() > 0 ? mqttUser.c_str() : "",
                mqttPass.length() > 0 ? mqttPass.c_str() : "",
                true
            );
        }

        resDoc.remove("device_name");
        resDoc.remove("device_id");
        resDoc.remove("location_id");
        resDoc.remove("fw");
        if (compactMode) {
            resDoc["cs"] = true;
        } else {
            resDoc["cloud_saved"] = true;
        }
        if (deviceToken.length() > 0) {
            if (compactMode) {
                resDoc["ta"] = true;
            } else {
                resDoc["token_applied"] = true;
            }
        }
        if (keyFetchedFromProvision) {
            if (compactMode) {
                resDoc["ra"] = true;
            } else {
                resDoc["device_key_registered"] = true;
            }
        }
        if (mqttHost.length() > 0) {
            if (compactMode) {
                resDoc["mh"] = true;
                resDoc["mp"] = mqttPort;
            } else {
                resDoc["mqtt_host_set"] = true;
                resDoc["mqtt_port"] = mqttPort;
            }
        }

        const bool shouldCheckVps = compactMode
            ? (reqDoc["cv"] | true)
            : (reqDoc["check_vps"] | true);
        if (shouldCheckVps) {
            String vpsProbeBase = String(reqDoc["vps_check_url"] | "");
            if (vpsProbeBase.length() == 0) {
                vpsProbeBase = String(reqDoc["vu"] | "");
            }
            vpsProbeBase.trim();
            if (vpsProbeBase.length() == 0) {
                vpsProbeBase = vpsBase;
            }
            int vpsCode = 0;
            uint32_t vpsMs = 0;
            String vpsErr;
            const bool vpsOk = probeVpsHealth(vpsProbeBase, vpsCode, vpsMs, &vpsErr);
            if (compactMode) {
                resDoc["vr"] = vpsOk;
                resDoc["vh"] = vpsCode;
            } else {
                resDoc["vps_reachable"] = vpsOk;
                resDoc["vps_http_code"] = vpsCode;
            }
            if (vpsErr.length() > 0) {
                if (vpsErr.length() > 48) {
                    vpsErr = vpsErr.substring(0, 48);
                }
                if (compactMode) {
                    resDoc["ve"] = vpsErr;
                } else {
                    resDoc["vps_error"] = vpsErr;
                }
            }
            Serial.printf(
                "[BLE][set_cloud] vps_ok=%d http=%d latency=%lu probe=%s err=%s\n",
                vpsOk ? 1 : 0,
                vpsCode,
                static_cast<unsigned long>(vpsMs),
                vpsProbeBase.c_str(),
                vpsErr.length() > 0 ? vpsErr.c_str() : "-"
            );
        }
    } else if (cmd == "health" || cmd == "diag" || cmd == "diagnostics") {
        resDoc["uptime_ms"] = millis();
        resDoc["free_heap"] = ESP.getFreeHeap();
        resDoc["wifi_connected"] = WifiManager::getInstance().isConnected();
        const int wifiStatus = WifiManager::getInstance().currentStatus();
        resDoc["wifi_status"] = wifiStatus;
        resDoc["wifi_status_text"] = WifiManager::getInstance().statusText(wifiStatus);
        resDoc["wifi_ssid"] = WifiManager::getInstance().getConfiguredSsid();
        resDoc["wifi_rssi"] = WifiManager::getInstance().getRssi();
        resDoc["ip"] = WifiManager::getInstance().getLocalIp();
        resDoc["mqtt_connected"] = _mqttConnected;
        resDoc["battery_voltage"] = VoltageMonitor::getInstance().readSupplyVoltage();
        resDoc["battery_adc_divider_ratio"] = VoltageMonitor::getInstance().dividerRatio();
        resDoc["battery_adc_calibration_factor"] = VoltageMonitor::getInstance().calibrationFactor();
        resDoc["battery_adc_ready"] = VoltageMonitor::getInstance().isAdcReady();

        JsonObject network = resDoc.createNestedObject("network");
        network["internet_available"] = _latestDiagnostics.internetAvailable;
        network["gateway_reachable"] = _latestDiagnostics.gatewayReachable;
        network["sim_inserted"] = _latestDiagnostics.simInserted;
        network["sim_registered"] = _latestDiagnostics.simRegistered;
        network["connected_4g"] = _latestDiagnostics.connected4g;
        network["signal_bars"] = _latestDiagnostics.signalBars;
        network["signal_rssi_dbm"] = _latestDiagnostics.signalRssiDbm;
        network["operator"] = _latestDiagnostics.operatorName;
        network["wan_ip"] = _latestDiagnostics.wanIp;
        network["mode"] = _latestDiagnostics.networkMode;

        const bool shouldCheckVps = reqDoc["check_vps"] | true;
        if (shouldCheckVps) {
            String vpsBase = String(reqDoc["vps_url"] | "");
            if (vpsBase.length() == 0) {
                vpsBase = String(reqDoc["u"] | "");
            }
            vpsBase.trim();
            if (vpsBase.length() == 0) {
                vpsBase = String(config.httpBaseUrl);
            }
            int vpsCode = 0;
            uint32_t vpsMs = 0;
            String vpsErr;
            const bool vpsOk = probeVpsHealth(vpsBase, vpsCode, vpsMs, &vpsErr);
            JsonObject vps = resDoc.createNestedObject("vps");
            vps["url"] = healthUrlFromBase(vpsBase);
            vps["reachable"] = vpsOk;
            vps["http_code"] = vpsCode;
            vps["latency_ms"] = vpsMs;
            if (vpsErr.length() > 0) {
                vps["error"] = vpsErr;
            }
        }
    } else if (cmd == "voltage_config_get" || cmd == "adc_config_get") {
        resDoc["battery_adc_divider_ratio"] = VoltageMonitor::getInstance().dividerRatio();
        resDoc["battery_adc_calibration_factor"] = VoltageMonitor::getInstance().calibrationFactor();
        resDoc["battery_adc_ready"] = VoltageMonitor::getInstance().isAdcReady();
        resDoc["battery_voltage"] = VoltageMonitor::getInstance().readSupplyVoltage();
    } else if (cmd == "voltage_config_set" || cmd == "adc_config_set") {
        float dividerRatio = VoltageMonitor::getInstance().dividerRatio();
        float calibrationFactor = VoltageMonitor::getInstance().calibrationFactor();
        const JsonObjectConst reqObj = reqDoc.as<JsonObjectConst>();

        bool dividerProvided = readOptionalFloat(reqObj, "adc_divider_ratio", dividerRatio);
        if (!dividerProvided) {
            dividerProvided = readOptionalFloat(reqObj, "divider_ratio", dividerRatio);
        }
        bool calibrationProvided = readOptionalFloat(reqObj, "adc_calibration_factor", calibrationFactor);
        if (!calibrationProvided) {
            calibrationProvided = readOptionalFloat(reqObj, "calibration_factor", calibrationFactor);
        }

        if (!dividerProvided && !calibrationProvided) {
            return responseError("adc_divider_ratio or adc_calibration_factor required", cmd.c_str());
        }

        String reason;
        const bool applied = VoltageMonitor::getInstance().updateCalibration(
            dividerRatio,
            calibrationFactor,
            true,
            reason
        );
        if (!applied) {
            return responseError(reason.c_str(), cmd.c_str());
        }

        resDoc["battery_adc_divider_ratio"] = VoltageMonitor::getInstance().dividerRatio();
        resDoc["battery_adc_calibration_factor"] = VoltageMonitor::getInstance().calibrationFactor();
        resDoc["battery_adc_ready"] = VoltageMonitor::getInstance().isAdcReady();
        resDoc["battery_voltage"] = VoltageMonitor::getInstance().readSupplyVoltage();
    } else {
        return responseError("unknown_cmd", cmd.c_str());
    }

    String out;
    serializeJson(resDoc, out);
    return out;
}

String BleProvisioningService::responseError(const char* message, const char* cmd) {
    StaticJsonDocument<256> doc;
    doc["ok"] = false;
    if (cmd != nullptr && cmd[0] != '\0') {
        doc["cmd"] = cmd;
    }
    doc["error"] = message ? message : "error";
    doc["device_name"] = _bleName;
    doc["mac_suffix"] = _macSuffix;
    String out;
    serializeJson(doc, out);
    return out;
}

void BleProvisioningService::queueIncoming(const String& request) {
    _pendingCommand = request;
    _pendingCommandReady = true;
}
