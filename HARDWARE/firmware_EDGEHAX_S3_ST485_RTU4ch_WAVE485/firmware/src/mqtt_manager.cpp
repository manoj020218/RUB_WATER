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

void MqttManager::begin(const char* deviceId, const char* hardwareId, const char* token) {
    gInst = this;
    strncpy(_deviceId, deviceId, sizeof(_deviceId) - 1);
    strncpy(_hardwareId, hardwareId, sizeof(_hardwareId) - 1);
    strncpy(_routeId, _deviceId, sizeof(_routeId) - 1);
    // MQTT username/client identity prefers immutable hardware_id when broker
    // accepts it, but falls back to the legacy device_id for in-field
    // compatibility with older credential provisioning.
    strncpy(_user, _hardwareId[0] ? _hardwareId : _deviceId, sizeof(_user) - 1);
    strncpy(_pass, token,    sizeof(_pass) - 1);

    _mqtt.setServer(DEFAULT_MQTT_HOST, DEFAULT_MQTT_PORT);
    _mqtt.setKeepAlive(60);
    _mqtt.setBufferSize(4096);
    _mqtt.setCallback(onMessageBridge);

    Serial.printf("[MQTT] host=%s:%d device_id=%s hardware_id=%s\n",
                  DEFAULT_MQTT_HOST, DEFAULT_MQTT_PORT, _deviceId, _hardwareId);
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

String MqttManager::topicBase() const {
    return topicBaseFor(_routeId[0] ? _routeId : _deviceId);
}

String MqttManager::topicBaseFor(const char* routeId) const {
    return String("floodguard/") + (routeId && routeId[0] ? routeId : _deviceId);
}

String MqttManager::legacyTopicBase() const {
    return topicBaseFor(_deviceId);
}

String MqttManager::hardwareTopicBase() const {
    return topicBaseFor(_hardwareId[0] ? _hardwareId : _deviceId);
}

String MqttManager::telemetryTopic() const {
    return topicBase() + "/telemetry";
}
String MqttManager::eventTopic() const {
    return topicBase() + "/event";
}
String MqttManager::heartbeatTopic() const {
    return topicBase() + "/heartbeat";
}
String MqttManager::commandAckTopic() const {
    return topicBase() + "/command_ack";
}
String MqttManager::configAckTopic() const {
    return topicBase() + "/config_ack";
}
String MqttManager::commandTopic() const {
    return topicBase() + "/command";
}
String MqttManager::configTopic() const {
    return topicBase() + "/config";
}

bool MqttManager::reconnect() {
    if (_hardwareId[0] && strcmp(_hardwareId, _deviceId) != 0) {
        if (connectUsingIdentity(_hardwareId, true)) {
            return true;
        }
        Serial.println("[MQTT] hardware identity failed, retrying legacy device_id identity");
    }
    return connectUsingIdentity(_deviceId, false);
}

bool MqttManager::connectUsingIdentity(const char* authId, bool hardwareRoutePreferred) {
    if (!authId || !authId[0]) {
        return false;
    }

    strncpy(_user, authId, sizeof(_user) - 1);
    Serial.printf("[MQTT] Connecting as %s...\n", _user);
    const bool ok = _mqtt.connect(authId, _user, _pass);
    if (ok) {
        strncpy(_routeId,
                hardwareRoutePreferred && _hardwareId[0] ? _hardwareId : _deviceId,
                sizeof(_routeId) - 1);
        Serial.printf("[MQTT] Connected route=%s\n", _routeId);
        subscribe();
    } else {
        Serial.printf("[MQTT] Failed rc=%d for identity=%s\n", _mqtt.state(), authId);
    }
    return ok;
}

void MqttManager::subscribe() {
    const String activeCmd = commandTopic();
    const String activeCfg = configTopic();
    bool cmdOk = _mqtt.subscribe(activeCmd.c_str(), 1);
    bool cfgOk = _mqtt.subscribe(activeCfg.c_str(), 1);
    Serial.printf("[MQTT] subscribe route=%s command=%d config=%d\n",
                  _routeId, cmdOk ? 1 : 0, cfgOk ? 1 : 0);

    if (_hardwareId[0] && strcmp(_hardwareId, _deviceId) != 0) {
        const String legacyCmd = legacyTopicBase() + "/command";
        const String legacyCfg = legacyTopicBase() + "/config";
        const bool legacyCmdOk = _mqtt.subscribe(legacyCmd.c_str(), 1);
        const bool legacyCfgOk = _mqtt.subscribe(legacyCfg.c_str(), 1);
        Serial.printf("[MQTT] subscribe legacy command=%d config=%d\n",
                      legacyCmdOk ? 1 : 0, legacyCfgOk ? 1 : 0);
    }
}

void MqttManager::onMessageBridge(char* topic, uint8_t* payload, unsigned int len) {
    if (gInst) gInst->onMessage(topic, payload, len);
}

void MqttManager::onMessage(char* topic, uint8_t* payload, unsigned int len) {
    if (!_cmdCb) return;
    char buf[1536];
    const size_t n = len < sizeof(buf) - 1 ? len : sizeof(buf) - 1;
    memcpy(buf, payload, n);
    buf[n] = '\0';
    _cmdCb(topic, buf);
}
