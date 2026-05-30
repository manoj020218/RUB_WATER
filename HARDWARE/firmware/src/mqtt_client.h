#pragma once

#include <Arduino.h>
#include <PubSubClient.h>
#include <WiFiClient.h>

#include "local_event_queue.h"

typedef void (*MqttCommandCallback)(const char* command, const char* payload);

class MqttClientService {
public:
    static MqttClientService& getInstance();

    void begin(const char* host, uint16_t port, const char* user, const char* pass, const char* deviceId);
    void updateConnection(const char* host, uint16_t port, const char* user, const char* pass, bool persistToNvs = true);
    void loop();
    bool isConnected();

    bool publish(const char* topic, const char* payload, bool retained = false);
    void setCommandCallback(MqttCommandCallback callback);

    String telemetryTopic() const;
    String eventTopic() const;
    String heartbeatTopic() const;
    String commandTopic() const;
    String commandAckTopic() const;
    String configTopic() const;
    String configAckTopic() const;
    String otaTopic() const;

private:
    MqttClientService() = default;
    static MqttClientService* _instance;

    WiFiClient _wifiClient;
    PubSubClient _client{_wifiClient};
    char _host[128]{};
    char _user[64]{};
    char _pass[64]{};
    char _deviceId[32]{};
    uint16_t _port = 1883;
    unsigned long _lastReconnectAttemptMs = 0;
    unsigned long _reconnectIntervalMs = 5000UL;
    uint8_t _consecutiveFailures = 0;
    MqttCommandCallback _commandCallback = nullptr;

    bool connect();
    void subscribe();
    void loadPersistedConnection();
    void persistConnection();
    static void onMessageBridge(char* topic, uint8_t* payload, unsigned int length);
    void onMessage(char* topic, uint8_t* payload, unsigned int length);
};
