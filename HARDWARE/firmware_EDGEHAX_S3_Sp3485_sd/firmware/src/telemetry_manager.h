#pragma once

#include <Arduino.h>

class TelemetryManager {
public:
    static TelemetryManager& getInstance();

    void begin(const char* deviceId);
    void loop();

    void publishEvent(const char* eventType, const char* detail = nullptr);

private:
    TelemetryManager() = default;
    char     _deviceId[32]{};
    uint32_t _lastTelemetryMs = 0;
    uint32_t _telemetryIntervalMs = 180000UL;

    uint32_t dynamicInterval() const;
    void     buildTelemetryJson(char* out, size_t outSize) const;
    void     buildEventJson(char* out, size_t outSize,
                             const char* type, const char* detail) const;
    bool     send(const char* topic_type, const char* payload);
};
