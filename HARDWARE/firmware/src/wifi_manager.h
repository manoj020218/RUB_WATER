#pragma once

#include <Arduino.h>

class WifiManager {
public:
    static WifiManager& getInstance();

    void begin(const char* ssid, const char* password);
    void loop();
    bool isConnected() const;
    int32_t getRssi() const;
    String getLocalIp() const;

private:
    WifiManager() = default;
    char _ssid[64]{};
    char _password[64]{};
    unsigned long _lastConnectAttemptMs = 0;
};

