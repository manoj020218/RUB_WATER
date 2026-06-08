#pragma once

#include <Arduino.h>

enum class LedPriority : uint8_t {
    BOOT = 0,
    WIFI_DISCONNECTED,
    VPS_UNREACHABLE,   // WiFi connected but MQTT never reached — white fast blink
    LOCAL_MODE,
    SD_WARNING,
    CLOUD_CONNECTED,
    ALERT,
    SENSOR_FAULT,
    DANGER,
    OTA,
    AP_MAINTENANCE
};

class StatusLed {
public:
    static StatusLed& getInstance();

    void begin();
    void loop();

private:
    StatusLed() = default;
    uint32_t _lastUpdateMs      = 0;
    uint32_t _phaseMs           = 0;
    bool     _phase             = false;
    bool     _mqttEverConnected = false;

    LedPriority currentPriority();
    void applyPattern(LedPriority prio);

    void setOrange(bool on);
    void setWhite(bool on);
    void setGreen(bool on);
    void allOff();
};
