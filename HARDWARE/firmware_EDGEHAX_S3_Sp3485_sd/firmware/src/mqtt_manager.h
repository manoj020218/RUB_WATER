#pragma once

#include <Arduino.h>
#include <PubSubClient.h>
#include <WiFiClient.h>

typedef void (*MqttCmdCallback)(const char* topic, const char* payload);

class MqttManager {
public:
    static MqttManager& getInstance();

    void begin(const char* deviceId, const char* token);
    void loop();
    bool isConnected();

    bool publish(const char* topic, const char* payload, bool retained = false);
    void setCommandCallback(MqttCmdCallback cb);

    String telemetryTopic() const;
    String eventTopic()     const;
    String commandTopic()   const;
    String configTopic()    const;

private:
    MqttManager() = default;
    WiFiClient    _wifiClient;
    PubSubClient  _mqtt{_wifiClient};
    char          _deviceId[32]{};
    char          _user[32]{};
    char          _pass[128]{};
    uint32_t      _lastAttemptMs = 0;
    uint32_t      _retryIntervalMs = 5000UL;
    uint8_t       _failures = 0;
    MqttCmdCallback _cmdCb = nullptr;

    bool reconnect();
    void subscribe();
    static void onMessageBridge(char* topic, uint8_t* payload, unsigned int len);
    void onMessage(char* topic, uint8_t* payload, unsigned int len);
};
