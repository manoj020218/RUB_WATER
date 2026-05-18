#pragma once

#include <Arduino.h>

class WifiManager {
public:
    static WifiManager& getInstance();

    void begin(const char* ssid, const char* password);
    void loop();
    void setCredentials(const char* ssid, const char* password, bool persistToNvs = true);
    bool connectNow(uint32_t timeoutMs = 20000UL);
    bool isConnected() const;
    int32_t getRssi() const;
    String getLocalIp() const;
    String getConfiguredSsid() const;

private:
    WifiManager() = default;
    char _ssid[64]{};
    char _password[64]{};
    unsigned long _lastConnectAttemptMs = 0;
    void loadPersistedCredentials();
    void persistCredentials();
};
