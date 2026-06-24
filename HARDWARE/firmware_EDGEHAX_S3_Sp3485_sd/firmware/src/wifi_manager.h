#pragma once

#include <Arduino.h>

class WifiManager {
public:
    static WifiManager& getInstance();

    void begin();
    void loop();

    void setCredentials(const char* ssid, const char* password, bool persist = true);
    bool connectNow(uint32_t timeoutMs = 20000UL);
    bool isConnected() const;
    bool hasCredentials() const;
    int32_t rssi() const;
    String localIp() const;
    String configuredSsid() const;

private:
    WifiManager() = default;
    char     _ssid[64]{};
    char     _pass[64]{};
    bool     _hasCredentials = false;
    uint32_t _lastAttemptMs  = 0;

    void loadFromNvs();
    void persistToNvs();
};
