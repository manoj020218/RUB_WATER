#include "mqtt_client.h"

#include <ArduinoJson.h>
#include <Preferences.h>
#include <cstdio>
#include <cstring>

MqttClientService* MqttClientService::_instance = nullptr;

namespace {
constexpr const char* kPrefsNamespace = "fgcfg";
constexpr const char* kPrefsMqttHostKey = "mqtt_host";
constexpr const char* kPrefsMqttPortKey = "mqtt_port";
constexpr const char* kPrefsMqttUserKey = "mqtt_user";
constexpr const char* kPrefsMqttPassKey = "mqtt_pass";
}

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
    loadPersistedConnection();

    _instance = this;
    _client.setServer(_host, _port);
    _client.setKeepAlive(60);
    _client.setBufferSize(512);
    _client.setCallback(MqttClientService::onMessageBridge);
}

void MqttClientService::updateConnection(const char* host, uint16_t port, const char* user, const char* pass, bool persistToNvs) {
    if (host && host[0] != '\0') {
        std::memset(_host, 0, sizeof(_host));
        std::strncpy(_host, host, sizeof(_host) - 1);
    }
    if (port > 0) {
        _port = port;
    }
    if (user != nullptr) {
        std::memset(_user, 0, sizeof(_user));
        std::strncpy(_user, user, sizeof(_user) - 1);
    }
    if (pass != nullptr) {
        std::memset(_pass, 0, sizeof(_pass));
        std::strncpy(_pass, pass, sizeof(_pass) - 1);
    }

    if (_user[0] == '\0' && _deviceId[0] != '\0' && _pass[0] != '\0') {
        std::strncpy(_user, _deviceId, sizeof(_user) - 1);
    }

    if (persistToNvs) {
        persistConnection();
    }

    _client.setServer(_host, _port);
    if (_client.connected()) {
        _client.disconnect();
    }
    _lastReconnectAttemptMs = 0;
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

String MqttClientService::configTopic() const {
    return String("rub/") + _deviceId + "/config";
}

String MqttClientService::configAckTopic() const {
    return String("rub/") + _deviceId + "/config_ack";
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
    const bool useAuth = (_user[0] != '\0') || (_pass[0] != '\0');
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
    _client.subscribe(configTopic().c_str());
    _client.subscribe(otaTopic().c_str());
}

void MqttClientService::loadPersistedConnection() {
    Preferences prefs;
    if (!prefs.begin(kPrefsNamespace, true)) {
        return;
    }

    const String savedHost = prefs.getString(kPrefsMqttHostKey, "");
    const uint16_t savedPort = static_cast<uint16_t>(prefs.getUInt(kPrefsMqttPortKey, 0));
    const String savedUser = prefs.getString(kPrefsMqttUserKey, "");
    const String savedPass = prefs.getString(kPrefsMqttPassKey, "");
    prefs.end();

    if (savedHost.length() > 0) {
        std::memset(_host, 0, sizeof(_host));
        std::strncpy(_host, savedHost.c_str(), sizeof(_host) - 1);
    }
    if (savedPort > 0) {
        _port = savedPort;
    }
    if (savedUser.length() > 0) {
        std::memset(_user, 0, sizeof(_user));
        std::strncpy(_user, savedUser.c_str(), sizeof(_user) - 1);
    }
    if (savedPass.length() > 0) {
        std::memset(_pass, 0, sizeof(_pass));
        std::strncpy(_pass, savedPass.c_str(), sizeof(_pass) - 1);
    }

    if (_user[0] == '\0' && _deviceId[0] != '\0' && _pass[0] != '\0') {
        std::strncpy(_user, _deviceId, sizeof(_user) - 1);
    }
}

void MqttClientService::persistConnection() {
    Preferences prefs;
    if (!prefs.begin(kPrefsNamespace, false)) {
        return;
    }
    prefs.putString(kPrefsMqttHostKey, String(_host));
    prefs.putUInt(kPrefsMqttPortKey, static_cast<uint32_t>(_port));
    prefs.putString(kPrefsMqttUserKey, String(_user));
    prefs.putString(kPrefsMqttPassKey, String(_pass));
    prefs.end();
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
    const bool fromCommandTopic = (topicStr == commandTopic());
    const bool fromOtaTopic = (topicStr == otaTopic());
    const bool fromConfigTopic = (topicStr == configTopic());
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
