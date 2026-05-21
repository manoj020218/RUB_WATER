#pragma once

#include <Arduino.h>

#include "config_manager.h"

// ESP32-S3 onboard LED status renderer.
// This module is intentionally S3-focused and no-ops on non-S3 targets.
class StatusLedS3 {
public:
    static StatusLedS3& getInstance();

    void begin();
    void loop(AlarmState state, bool wifiConnected, bool internetAvailable, bool cloudConnected);

private:
    StatusLedS3() = default;

    enum class Mode : uint8_t {
        OFF = 0,
        BOOT_WHITE_BREATHE,
        NET_NO_WIFI_RED_BLINK,
        NET_NO_INTERNET_YELLOW_BLINK,
        NET_LOCAL_ONLY_BLUE_PULSE,
        NET_CLOUD_OK_GREEN_SOLID,
        ALERT_ORANGE_BLINK,
        DANGER_MAGENTA_BLINK_FAST,
        FAULT_RED_STROBE,
        OFFLINE_LOCAL_CYAN_SOLID
    };

    bool _initialized = false;
    unsigned long _bootStartMs = 0;
    uint8_t _lastR = 255;
    uint8_t _lastG = 255;
    uint8_t _lastB = 255;

    Mode decideMode(AlarmState state, bool wifiConnected, bool internetAvailable, bool cloudConnected, unsigned long now) const;
    void renderMode(Mode mode, unsigned long now);
    void writeRgb(uint8_t red, uint8_t green, uint8_t blue);
    uint8_t pulseLevel(unsigned long now, unsigned long periodMs, uint8_t minLevel, uint8_t maxLevel) const;
};

