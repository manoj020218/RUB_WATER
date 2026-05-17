#pragma once

#include <Arduino.h>

struct NetworkDiagnostics {
    bool wifiConnected;
    bool gatewayReachable;
    bool internetAvailable;
    bool simInserted;
    bool simRegistered;
    bool connected4g;
    int32_t signalRssiDbm;
    int32_t signalRsrpDbm;
    uint8_t signalBars;
    char operatorName[32];
    char wanIp[32];
    char networkMode[8];
};

class NetworkDiagnosticsService {
public:
    static NetworkDiagnosticsService& getInstance();
    void begin();
    void loop(bool wifiConnected, int32_t wifiRssi, const String& localIp);
    const NetworkDiagnostics& getData() const;

private:
    NetworkDiagnosticsService() = default;
    NetworkDiagnostics _data{};
    unsigned long _lastUpdateMs = 0;
};

