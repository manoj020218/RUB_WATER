#pragma once

#include <Arduino.h>

// Simplified BLE provisioning — WiFi SSID + password ONLY.
// Device token is pre-seeded; never exposed over BLE.
// BLE name: FgMain + 6 hex MAC chars.
// Same UUID as main firmware for app compatibility.
class BleProvisioning {
public:
    static BleProvisioning& getInstance();

    void begin();
    void loop();
    void stop();

    bool     isStarted()   const { return _started; }
    const char* bleName()  const { return _bleName; }

private:
    BleProvisioning() = default;
    bool _started   = false;
    char _bleName[24]{};

    void buildName();
    void startAdvertising();
    void processCommand(const String& json);

    // Queued incoming command from BLE ISR context
    volatile bool _pending = false;
    String        _pendingCmd;

    friend class BleProvCharCallbacks;
};
