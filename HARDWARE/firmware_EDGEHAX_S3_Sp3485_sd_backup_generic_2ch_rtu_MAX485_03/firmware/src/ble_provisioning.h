#pragma once

#include <Arduino.h>

// BLE provisioning — WiFi SSID + password only.
// Device token is pre-seeded; never exposed over BLE.
// BLE name: JXFG + last 6 hex chars of MAC  (e.g. JXFGBAF968)
// Characteristic ff01: WRITE — app sends commands (JSON)
// Characteristic ff02: NOTIFY+READ — device pushes status events (JSON)
class BleProvisioning {
public:
    static BleProvisioning& getInstance();

    void begin();
    void loop();
    void stop();
    void notify(const String& json);   // push event to subscribed app

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
