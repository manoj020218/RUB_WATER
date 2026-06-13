#include "ble_provisioning.h"

#include <ArduinoJson.h>
#include <BLECharacteristic.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <WiFi.h>
#include <esp_mac.h>

#include "mqtt_manager.h"
#include "wifi_manager.h"

namespace {
constexpr const char* kServiceUuid = "0000ff00-0000-1000-8000-00805f9b34fb";
constexpr const char* kCharUuid    = "0000ff01-0000-1000-8000-00805f9b34fb";

BleProvisioning* gInstance = nullptr;
BLECharacteristic* gChar   = nullptr;
}

class BleProvCharCallbacks final : public BLECharacteristicCallbacks {
public:
    void onWrite(BLECharacteristic* c) override {
        if (!gInstance || !c) return;
        const std::string v = c->getValue();
        if (v.empty()) return;
        String chunk;
        for (char ch : v) { if (ch == '\0') break; chunk += ch; }
        // Accumulate chunks until we have a complete JSON object
        gInstance->_pendingCmd += chunk;
        // Check if accumulated buffer looks like a complete JSON object
        const String& buf = gInstance->_pendingCmd;
        int depth = 0;
        bool inStr = false;
        bool escape = false;
        bool complete = false;
        for (int i = 0; i < (int)buf.length(); i++) {
            char ch = buf[i];
            if (escape) { escape = false; continue; }
            if (ch == '\\' && inStr) { escape = true; continue; }
            if (ch == '"') { inStr = !inStr; continue; }
            if (inStr) continue;
            if (ch == '{') depth++;
            else if (ch == '}') { if (--depth == 0) { complete = true; break; } }
        }
        if (complete) {
            gInstance->_pending = true;
        }
    }
};

BleProvisioning& BleProvisioning::getInstance() {
    static BleProvisioning inst;
    return inst;
}

void BleProvisioning::begin() {
    if (_started) return;
    gInstance = this;
    buildName();
    startAdvertising();
}

void BleProvisioning::loop() {
    if (!_started || !_pending) return;
    _pending = false;
    const String cmd = _pendingCmd;
    _pendingCmd = "";  // clear accumulated buffer for next command
    processCommand(cmd);
}

void BleProvisioning::stop() {
    if (!_started) return;
    BLEDevice::deinit(false);
    _started = false;
    Serial.println("[BLE] Stopped");
}

void BleProvisioning::buildName() {
    uint8_t mac[6] = {};
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    snprintf(_bleName, sizeof(_bleName), "JXFG%02X%02X%02X", mac[3], mac[4], mac[5]);
}

void BleProvisioning::startAdvertising() {
    BLEDevice::init(_bleName);
    BLEDevice::setMTU(512);
    BLEServer*  srv   = BLEDevice::createServer();
    BLEService* svc   = srv->createService(kServiceUuid);
    gChar = svc->createCharacteristic(
        kCharUuid,
        BLECharacteristic::PROPERTY_READ |
        BLECharacteristic::PROPERTY_WRITE |
        BLECharacteristic::PROPERTY_WRITE_NR
    );
    gChar->setCallbacks(new BleProvCharCallbacks());
    gChar->setValue("{\"ok\":true,\"cmd\":\"ready\"}");
    svc->start();

    BLEAdvertising* adv = BLEDevice::getAdvertising();
    if (adv) {
        adv->addServiceUUID(kServiceUuid);
        adv->setScanResponse(true);
        adv->setMinPreferred(0x06);
        BLEDevice::startAdvertising();
        _started = true;
        Serial.printf("[BLE] Advertising as '%s'\n", _bleName);
    }
}

void BleProvisioning::processCommand(const String& json) {
    StaticJsonDocument<512> doc;
    if (deserializeJson(doc, json) != DeserializationError::Ok) {
        if (gChar) gChar->setValue("{\"ok\":false,\"error\":\"invalid_json\"}");
        return;
    }
    String cmd = String(doc["cmd"] | doc["op"] | "");
    cmd.trim(); cmd.toLowerCase();

    StaticJsonDocument<256> res;
    res["ok"]  = true;
    res["cmd"] = cmd;

    if (cmd == "hello" || cmd == "h") {
        res["ble_name"]       = _bleName;
        res["wifi_connected"] = WifiManager::getInstance().isConnected();
        res["ssid"]           = WifiManager::getInstance().configuredSsid();
        res["ip"]             = WifiManager::getInstance().localIp();
    } else if (cmd == "set_wifi" || cmd == "w") {
        String ssid = String(doc["ssid"] | doc["s"] | "");
        String pass = String(doc["password"] | doc["p"] | "");
        ssid.trim(); pass.trim();
        if (ssid.length() == 0) {
            if (gChar) gChar->setValue("{\"ok\":false,\"error\":\"ssid_required\"}");
            return;
        }
        WifiManager::getInstance().setCredentials(ssid.c_str(), pass.c_str(), true);
        const bool connected = WifiManager::getInstance().connectNow(20000UL);
        res["wifi_connected"] = connected;
        res["ip"]             = WifiManager::getInstance().localIp();
        Serial.printf("[BLE] WiFi provisioned: ssid=%s connected=%d\n",
                      ssid.c_str(), connected ? 1 : 0);
    } else if (cmd == "scan_wifi") {
        const int n = WiFi.scanNetworks(false, true);
        JsonArray nets = res.createNestedArray("networks");
        for (int i = 0; i < n && (size_t)nets.size() < 8; i++) {
            JsonObject o = nets.createNestedObject();
            o["ssid"] = WiFi.SSID(i);
            o["rssi"] = WiFi.RSSI(i);
        }
        WiFi.scanDelete();
    } else if (cmd == "c") {
        // Cloud/MQTT config step from provisioning app.
        // MQTT host is hardcoded in firmware; credentials from payload are ignored.
        // Report current connectivity status so the app can proceed.
        const bool wifiOk = WifiManager::getInstance().isConnected();
        const bool mqttOk = MqttManager::getInstance().isConnected();
        res["wifi_connected"] = wifiOk;
        res["mqtt_connected"] = mqttOk;
        res["ip"]             = WifiManager::getInstance().localIp();
        Serial.printf("[BLE] Cloud step: wifi=%d mqtt=%d\n", wifiOk ? 1 : 0, mqttOk ? 1 : 0);
    } else {
        if (gChar) gChar->setValue("{\"ok\":false,\"error\":\"unknown_cmd\"}");
        return;
    }

    char out[250];
    serializeJson(res, out, sizeof(out));
    if (gChar) gChar->setValue(out);
}
