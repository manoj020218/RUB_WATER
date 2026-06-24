#pragma once

#include <Arduino.h>
#include <PubSubClient.h>
#include <WiFiClient.h>

typedef void (*MqttCmdCallback)(const char* topic, const char* payload);

class MqttManager {
public:
    static MqttManager& getInstance();

    void begin(const char* deviceId, const char* hardwareId, const char* token);
    void loop();
    bool isConnected();

    bool publish(const char* topic, const char* payload, bool retained = false);
    void setCommandCallback(MqttCmdCallback cb);

    const char* deviceId() const { return _deviceId; }
    const char* hardwareId() const { return _hardwareId; }
    const char* routeId() const { return _routeId; }
    String topicBase() const;
    String topicBaseFor(const char* routeId) const;
    String legacyTopicBase() const;
    String hardwareTopicBase() const;
    String telemetryTopic() const;
    String eventTopic()     const;
    String heartbeatTopic() const;
    String commandAckTopic() const;
    String configAckTopic() const;
    String commandTopic()   const;
    String configTopic()    const;

private:
    MqttManager() = default;
    WiFiClient    _wifiClient;
    PubSubClient  _mqtt{_wifiClient};
    char          _deviceId[32]{};
    char          _hardwareId[32]{};
    char          _routeId[32]{};
    char          _user[32]{};
    char          _pass[128]{};
    uint32_t      _lastAttemptMs = 0;
    uint32_t      _retryIntervalMs = 5000UL;
    uint8_t       _failures = 0;
    MqttCmdCallback _cmdCb = nullptr;

    bool reconnect();
    bool connectUsingIdentity(const char* authId, bool hardwareRoutePreferred);
    void subscribe();
    static void onMessageBridge(char* topic, uint8_t* payload, unsigned int len);
    void onMessage(char* topic, uint8_t* payload, unsigned int len);
};
