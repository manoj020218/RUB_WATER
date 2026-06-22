#include "mqtt_manager.h"

#include "device_profile.h"
#include "wifi_manager.h"

namespace {
MqttManager* gInst = nullptr;
}

MqttManager& MqttManager::getInstance() {
    static MqttManager inst;
    return inst;
}

void MqttManager::begin(const char* deviceId, const char* token) {
    gInst = this;
    strncpy(_deviceId, deviceId, sizeof(_deviceId) - 1);
    // MQTT username = deviceId, password = pre-seeded token
    strncpy(_user, deviceId, sizeof(_user) - 1);
    strncpy(_pass, token,    sizeof(_pass) - 1);

    _mqtt.setServer(DEFAULT_MQTT_HOST, DEFAULT_MQTT_PORT);
    _mqtt.setKeepAlive(60);
    _mqtt.setBufferSize(1024);
    _mqtt.setCallback(onMessageBridge);

    Serial.printf("[MQTT] host=%s:%d user=%s\n", DEFAULT_MQTT_HOST, DEFAULT_MQTT_PORT, _user);
}

void MqttManager::loop() {
    if (!WifiManager::getInstance().isConnected()) return;
    if (_mqtt.connected()) {
        // ESP32-S3 SMP: Core 0 (WiFi/LwIP) fills TCP RX buffer but Core 1's
        // WiFiClient::available() can return stale 0 due to CPU cache. Yield
        // repeatedly so Core 0 can update the buffer between each loop() call.
        // Do NOT condition on available() — that's the stale value we're fixing.
        for (int i = 0; i < 5; i++) {
            delay(2);
            _mqtt.loop();
        }
        return;
    }
    const uint32_t now = millis();
    if ((now - _lastAttemptMs) < _retryIntervalMs) return;
    _lastAttemptMs = now;
    if (reconnect()) {
        _failures = 0;
        _retryIntervalMs = 5000UL;
    } else {
        _failures++;
        const uint32_t backoff = (uint32_t)5000 << (_failures < 4 ? _failures : 4);
        _retryIntervalMs = backoff < 60000UL ? backoff : 60000UL;
    }
}

bool MqttManager::isConnected() { return _mqtt.connected(); }

bool MqttManager::publish(const char* topic, const char* payload, bool retained) {
    if (!_mqtt.connected()) return false;
    return _mqtt.publish(topic, payload, retained);
}

void MqttManager::setCommandCallback(MqttCmdCallback cb) { _cmdCb = cb; }

String MqttManager::telemetryTopic() const {
    return String("floodguard/") + _deviceId + "/telemetry";
}
String MqttManager::eventTopic() const {
    return String("floodguard/") + _deviceId + "/event";
}
String MqttManager::commandTopic() const {
    return String("floodguard/") + _deviceId + "/command";
}
String MqttManager::configTopic() const {
    return String("floodguard/") + _deviceId + "/config";
}

bool MqttManager::reconnect() {
    Serial.printf("[MQTT] Connecting as %s...\n", _user);
    const bool ok = _mqtt.connect(_deviceId, _user, _pass);
    if (ok) {
        Serial.println("[MQTT] Connected");
        subscribe();
    } else {
        Serial.printf("[MQTT] Failed rc=%d\n", _mqtt.state());
    }
    return ok;
}

void MqttManager::subscribe() {
    _mqtt.subscribe(commandTopic().c_str(), 1);  // QoS1: broker retries until PUBACK
    _mqtt.subscribe(configTopic().c_str(), 1);
}

void MqttManager::onMessageBridge(char* topic, uint8_t* payload, unsigned int len) {
    if (gInst) gInst->onMessage(topic, payload, len);
}

void MqttManager::onMessage(char* topic, uint8_t* payload, unsigned int len) {
    if (!_cmdCb) return;
    char buf[512];
    const size_t n = len < sizeof(buf) - 1 ? len : sizeof(buf) - 1;
    memcpy(buf, payload, n);
    buf[n] = '\0';
    _cmdCb(topic, buf);
}
