#pragma once

#include <Arduino.h>

class WifiManager {
public:
    static WifiManager& getInstance();

    void begin();
    void loop();

    void setHostname(const char* hostname);
    void setCredentials(const char* ssid, const char* password, bool persist = true);
    bool connectNow(uint32_t timeoutMs = 20000UL);
    bool isConnected() const;
    bool hasCredentials() const;
    bool isConnectTimedOut() const;
    int32_t rssi() const;
    String localIp() const;
    String hostname() const;
    String configuredSsid() const;
    bool onBackupNetwork() const;      // connected via the standard FLOODGUARD backup SSID
    const char* activeSsid() const;

private:
    bool     _onBackup           = false;
    uint32_t _backupStartMs      = 0;
    uint32_t _primaryDownSinceMs = 0;
    WifiManager() = default;
    char     _ssid[64]{};
    char     _pass[64]{};
    char     _hostname[64]{};
    bool     _hasCredentials   = false;
    uint32_t _lastAttemptMs    = 0;
    uint32_t _connectStartMs   = 0;
    bool     _connectTimedOut  = false;
    bool     _firstConnectDone = false;
    uint32_t _lastIpLogMs      = 0;

    void loadFromNvs();
    void persistToNvs();
};
