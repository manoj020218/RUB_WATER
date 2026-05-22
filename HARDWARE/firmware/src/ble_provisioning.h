#pragma once

#include <Arduino.h>

#include "config_manager.h"
#include "network_diagnostics.h"

class BleProvisioningService {
public:
    static BleProvisioningService& getInstance();

    void begin(const DeviceConfig& config);
    void loop(const DeviceConfig& config, const NetworkDiagnostics& diagnostics, bool mqttConnected);

    bool isStarted() const;
    const char* getBroadcastName() const;
    const char* getMacSuffix() const;

private:
    friend class BleProvisionCharacteristicCallbacks;
    BleProvisioningService() = default;
    void buildIdentity();
    void startAdvertising();
    void processPendingCommand(const DeviceConfig& config);
    String handleCommand(const String& request, const DeviceConfig& config);
    String responseError(const char* message, const char* cmd = nullptr);
    void queueIncoming(const String& request);

    char _macSuffix[5] = "0000";
    char _bleName[20] = "JNX-FG0000";
    bool _started = false;
    bool _pendingCommandReady = false;
    String _pendingCommand;
    NetworkDiagnostics _latestDiagnostics{};
    bool _mqttConnected = false;
};
