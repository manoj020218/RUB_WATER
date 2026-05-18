#include "ble_provisioning.h"

#include <ArduinoJson.h>
#include <BLEAdvertising.h>
#include <BLECharacteristic.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <ESP.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <esp_err.h>
#include <esp_mac.h>

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
    if (out.length() > 28) {
        out = out.substring(0, 28);
    }
    return out;
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

bool probeVpsHealth(const String& baseOrHealthUrl, int& statusCode, uint32_t& elapsedMs) {
    statusCode = 0;
    elapsedMs = 0;
    if (WiFi.status() != WL_CONNECTED) {
        return false;
    }

    const String healthUrl = healthUrlFromBase(baseOrHealthUrl);
    if (healthUrl.length() == 0) {
        return false;
    }

    HTTPClient client;
    client.setTimeout(5000);
    if (!client.begin(healthUrl)) {
        return false;
    }

    const unsigned long start = millis();
    statusCode = client.GET();
    elapsedMs = millis() - start;
    client.end();
    return statusCode >= 200 && statusCode < 400;
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
        begin(config);
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

    const String response = handleCommand(_pendingCommand, config);
    if (gBleCharacteristic != nullptr) {
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
            return responseError("wifi_scan_failed");
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
    } else if (cmd == "set_wifi" || cmd == "provision_wifi") {
        String ssid = String(reqDoc["ssid"] | "");
        if (ssid.length() == 0) {
            ssid = String(reqDoc["wifi"]["ssid"] | "");
        }
        ssid = sanitizeSsid(ssid);

        String password = String(reqDoc["password"] | "");
        if (password.length() == 0) {
            password = String(reqDoc["wifi"]["password"] | "");
        }

        if (ssid.length() == 0) {
            return responseError("ssid_required");
        }

        WifiManager::getInstance().setCredentials(ssid.c_str(), password.c_str(), true);
        const bool connected = WifiManager::getInstance().connectNow(22000UL);
        resDoc["wifi_connected"] = connected;
        resDoc["wifi_ssid"] = ssid;
        resDoc["ip"] = WifiManager::getInstance().getLocalIp();
        resDoc["rssi"] = WifiManager::getInstance().getRssi();

        const bool shouldCheckVps = reqDoc["check_vps"] | true;
        if (shouldCheckVps) {
            const String vpsBase = String(reqDoc["vps_url"] | config.httpBaseUrl);
            int vpsCode = 0;
            uint32_t vpsMs = 0;
            const bool vpsOk = probeVpsHealth(vpsBase, vpsCode, vpsMs);
            JsonObject vps = resDoc.createNestedObject("vps");
            vps["url"] = healthUrlFromBase(vpsBase);
            vps["reachable"] = vpsOk;
            vps["http_code"] = vpsCode;
            vps["latency_ms"] = vpsMs;
        }
    } else if (cmd == "health" || cmd == "diag" || cmd == "diagnostics") {
        resDoc["uptime_ms"] = millis();
        resDoc["free_heap"] = ESP.getFreeHeap();
        resDoc["wifi_connected"] = WifiManager::getInstance().isConnected();
        resDoc["wifi_ssid"] = WifiManager::getInstance().getConfiguredSsid();
        resDoc["wifi_rssi"] = WifiManager::getInstance().getRssi();
        resDoc["ip"] = WifiManager::getInstance().getLocalIp();
        resDoc["mqtt_connected"] = _mqttConnected;

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
            const String vpsBase = String(reqDoc["vps_url"] | config.httpBaseUrl);
            int vpsCode = 0;
            uint32_t vpsMs = 0;
            const bool vpsOk = probeVpsHealth(vpsBase, vpsCode, vpsMs);
            JsonObject vps = resDoc.createNestedObject("vps");
            vps["url"] = healthUrlFromBase(vpsBase);
            vps["reachable"] = vpsOk;
            vps["http_code"] = vpsCode;
            vps["latency_ms"] = vpsMs;
        }
    } else {
        return responseError("unknown_cmd");
    }

    String out;
    serializeJson(resDoc, out);
    return out;
}

String BleProvisioningService::responseError(const char* message) {
    StaticJsonDocument<256> doc;
    doc["ok"] = false;
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
