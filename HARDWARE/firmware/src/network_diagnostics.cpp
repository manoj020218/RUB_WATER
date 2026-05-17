#include "network_diagnostics.h"

#include <cstring>

NetworkDiagnosticsService& NetworkDiagnosticsService::getInstance() {
    static NetworkDiagnosticsService instance;
    return instance;
}

void NetworkDiagnosticsService::begin() {
    std::memset(&_data, 0, sizeof(_data));
    _data.signalRssiDbm = -127;
    _data.signalRsrpDbm = -140;
    std::strncpy(_data.operatorName, "Unknown", sizeof(_data.operatorName) - 1);
    std::strncpy(_data.wanIp, "0.0.0.0", sizeof(_data.wanIp) - 1);
    std::strncpy(_data.networkMode, "4G", sizeof(_data.networkMode) - 1);
}

void NetworkDiagnosticsService::loop(bool wifiConnected, int32_t wifiRssi, const String& localIp) {
    const unsigned long now = millis();
    if (now - _lastUpdateMs < 5000UL) {
        return;
    }
    _lastUpdateMs = now;

    _data.wifiConnected = wifiConnected;
    _data.gatewayReachable = wifiConnected;
    _data.internetAvailable = wifiConnected;
    _data.signalRssiDbm = wifiRssi;
    _data.signalRsrpDbm = wifiRssi - 15;

    if (wifiRssi >= -60) {
        _data.signalBars = 4;
    } else if (wifiRssi >= -70) {
        _data.signalBars = 3;
    } else if (wifiRssi >= -80) {
        _data.signalBars = 2;
    } else if (wifiRssi >= -90) {
        _data.signalBars = 1;
    } else {
        _data.signalBars = 0;
    }

    _data.simInserted = true;
    _data.simRegistered = true;
    _data.connected4g = true;
    std::strncpy(_data.operatorName, "Jio", sizeof(_data.operatorName) - 1);
    std::strncpy(_data.networkMode, "4G", sizeof(_data.networkMode) - 1);
    std::strncpy(_data.wanIp, localIp.c_str(), sizeof(_data.wanIp) - 1);
}

const NetworkDiagnostics& NetworkDiagnosticsService::getData() const {
    return _data;
}

