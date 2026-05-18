#include "mqtt_client.h"

#include <ArduinoJson.h>
#include <cstdio>
#include <cstring>

MqttClientService* MqttClientService::_instance = nullptr;

MqttClientService& MqttClientService::getInstance() {
    static MqttClientService instance;
    return instance;
}

void MqttClientService::begin(const char* host, uint16_t port, const char* user, const char* pass, const char* deviceId) {
    std::memset(_host, 0, sizeof(_host));
    std::memset(_user, 0, sizeof(_user));
    std::memset(_pass, 0, sizeof(_pass));
    std::memset(_deviceId, 0, sizeof(_deviceId));

    std::strncpy(_host, host ? host : "", sizeof(_host) - 1);
    std::strncpy(_user, user ? user : "", sizeof(_user) - 1);
    std::strncpy(_pass, pass ? pass : "", sizeof(_pass) - 1);
    std::strncpy(_deviceId, deviceId ? deviceId : "", sizeof(_deviceId) - 1);
    _port = port;

    _instance = this;
    _client.setServer(_host, _port);
    _client.setKeepAlive(60);
    _client.setBufferSize(512);
    _client.setCallback(MqttClientService::onMessageBridge);
}

void MqttClientService::loop() {
    if (!_client.connected()) {
        const unsigned long now = millis();
        if (now - _lastReconnectAttemptMs >= 5000UL) {
            _lastReconnectAttemptMs = now;
            connect();
        }
        return;
    }

    _client.loop();
}

bool MqttClientService::isConnected() {
    return _client.connected();
}

bool MqttClientService::publish(const char* topic, const char* payload, bool retained) {
    if (!_client.connected()) {
        return false;
    }
    return _client.publish(topic, payload, retained);
}

void MqttClientService::setCommandCallback(MqttCommandCallback callback) {
    _commandCallback = callback;
}

String MqttClientService::telemetryTopic() const {
    return String("rub/") + _deviceId + "/telemetry";
}

String MqttClientService::eventTopic() const {
    return String("rub/") + _deviceId + "/event";
}

String MqttClientService::heartbeatTopic() const {
    return String("rub/") + _deviceId + "/heartbeat";
}

String MqttClientService::commandTopic() const {
    return String("rub/") + _deviceId + "/command";
}

String MqttClientService::commandAckTopic() const {
    return String("rub/") + _deviceId + "/command_ack";
}

String MqttClientService::otaTopic() const {
    return String("rub/") + _deviceId + "/ota";
}

bool MqttClientService::connect() {
    if (_deviceId[0] == '\0' || _host[0] == '\0') {
        return false;
    }

    char clientId[64]{};
    std::snprintf(clientId, sizeof(clientId), "fg_%s_%lu", _deviceId, millis());

    const String willMessage = "{\"type\":\"heartbeat\",\"online\":false}";
    const bool useAuth = _user[0] != '\0';
    const bool ok = useAuth
        ? _client.connect(clientId, _user, _pass, heartbeatTopic().c_str(), 1, true, willMessage.c_str())
        : _client.connect(clientId, heartbeatTopic().c_str(), 1, true, willMessage.c_str());

    if (ok) {
        subscribe();
    }
    return ok;
}

void MqttClientService::subscribe() {
    _client.subscribe(commandTopic().c_str());
    _client.subscribe((String("rub/") + _deviceId + "/config").c_str());
    _client.subscribe(otaTopic().c_str());
}

void MqttClientService::onMessageBridge(char* topic, uint8_t* payload, unsigned int length) {
    if (_instance) {
        _instance->onMessage(topic, payload, length);
    }
}

void MqttClientService::onMessage(char* topic, uint8_t* payload, unsigned int length) {
    char message[512]{};
    const unsigned int copyLen = (length < sizeof(message) - 1) ? length : (sizeof(message) - 1);
    std::memcpy(message, payload, copyLen);
    message[copyLen] = '\0';

    const String topicStr = String(topic);
    const String configTopic = String("rub/") + _deviceId + "/config";
    const bool fromCommandTopic = (topicStr == commandTopic());
    const bool fromOtaTopic = (topicStr == otaTopic());
    const bool fromConfigTopic = (topicStr == configTopic);
    if (!fromCommandTopic && !fromOtaTopic && !fromConfigTopic) {
        return;
    }

    StaticJsonDocument<256> doc;
    if (deserializeJson(doc, message) != DeserializationError::Ok) {
        return;
    }

    const char* command = doc["command"] | "";
    if (command[0] == '\0') {
        command = doc["cmd"] | "";
    }
    if (command[0] == '\0') {
        command = doc["action"] | "";
    }
    if (command[0] == '\0' && fromOtaTopic) {
        command = "OTA_UPDATE";
    }
    if (command[0] == '\0' && fromConfigTopic) {
        if (doc.containsKey("ota_host") || doc.containsKey("ota_base_url") ||
            doc.containsKey("host") || doc.containsKey("vps") || doc.containsKey("server")) {
            command = "OTA_SET_HOST";
        } else if (doc["ota_update"] | false) {
            command = "OTA_UPDATE";
        } else if (doc["ota_check"] | false) {
            command = "OTA_CHECK";
        }
    }
    if (_commandCallback && command[0] != '\0') {
        _commandCallback(command, message);
    }
}
