#include "ble_provisioning.h"

#include <ArduinoJson.h>
#include <BLE2902.h>
#include <BLECharacteristic.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <WiFi.h>
#include <esp_mac.h>

#include "wifi_manager.h"

namespace {
constexpr const char* kServiceUuid    = "0000ff00-0000-1000-8000-00805f9b34fb";
constexpr const char* kCmdCharUuid    = "0000ff01-0000-1000-8000-00805f9b34fb";  // WRITE — app→device
constexpr const char* kNotifyCharUuid = "0000ff02-0000-1000-8000-00805f9b34fb";  // NOTIFY — device→app

BleProvisioning*   gInstance    = nullptr;
BLECharacteristic* gChar        = nullptr;   // command char (ff01)
BLECharacteristic* gNotifyChar  = nullptr;   // notify char  (ff02)
}

class BleProvCharCallbacks final : public BLECharacteristicCallbacks {
public:
    void onWrite(BLECharacteristic* c) override {
        if (!gInstance || !c) return;
        const std::string v = c->getValue();
        if (v.empty()) return;
        String s;
        for (char ch : v) { if (ch == '\0') break; s += ch; }
        gInstance->_pendingCmd = s;
        gInstance->_pending    = true;
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
    _pendingCmd = "";
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
    BLEServer*  srv = BLEDevice::createServer();
    BLEService* svc = srv->createService(BLEUUID(kServiceUuid), 8);  // 8 handles for 2 chars + descriptors

    // ff01 — command channel: app writes JSON commands, reads last response
    gChar = svc->createCharacteristic(
        kCmdCharUuid,
        BLECharacteristic::PROPERTY_READ |
        BLECharacteristic::PROPERTY_WRITE |
        BLECharacteristic::PROPERTY_WRITE_NR
    );
    gChar->setCallbacks(new BleProvCharCallbacks());
    gChar->setValue("{\"ok\":true,\"cmd\":\"ready\"}");

    // ff02 — notify channel: device pushes status events to app
    gNotifyChar = svc->createCharacteristic(
        kNotifyCharUuid,
        BLECharacteristic::PROPERTY_READ |
        BLECharacteristic::PROPERTY_NOTIFY
    );
    gNotifyChar->addDescriptor(new BLE2902());
    gNotifyChar->setValue("{\"event\":\"ready\"}");

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

void BleProvisioning::notify(const String& json) {
    if (!_started || !gNotifyChar) return;
    gNotifyChar->setValue(json.c_str());
    gNotifyChar->notify();
}

void BleProvisioning::processCommand(const String& json) {
    StaticJsonDocument<256> doc;
    if (deserializeJson(doc, json) != DeserializationError::Ok) {
        if (gChar) gChar->setValue("{\"ok\":false,\"error\":\"invalid_json\"}");
        return;
    }
    String cmd = String(doc["cmd"] | doc["op"] | "");
    cmd.trim(); cmd.toLowerCase();

    StaticJsonDocument<256> res;
    res["ok"]  = true;
    res["cmd"] = cmd;

    if (cmd == "hello" || cmd == "h" || cmd == "health") {
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
        notify("{\"event\":\"wifi_connecting\",\"ssid\":\"" + ssid + "\"}");
        WifiManager::getInstance().setCredentials(ssid.c_str(), pass.c_str(), true);
        const bool connected = WifiManager::getInstance().connectNow(20000UL);
        if (connected) {
            notify("{\"event\":\"wifi_connected\",\"ip\":\"" + WifiManager::getInstance().localIp() + "\"}");
        } else {
            notify("{\"event\":\"wifi_failed\",\"reason\":\"timeout\"}");
        }
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
    } else {
        if (gChar) gChar->setValue("{\"ok\":false,\"error\":\"unknown_cmd\"}");
        return;
    }

    char out[250];
    serializeJson(res, out, sizeof(out));
    if (gChar) gChar->setValue(out);
}
