#pragma once

#include <Arduino.h>

class HttpFallback {
public:
    static HttpFallback& getInstance();

    void begin(const char* deviceId, const char* token);

    // Non-blocking: queues payload, attempts on loop()
    bool queue(const char* type, const char* payload);
    void loop();

    bool lastOk() const { return _lastOk; }

private:
    HttpFallback() = default;
    char     _deviceId[32]{};
    char     _token[128]{};
    bool     _lastOk = false;
    uint32_t _lastAttemptMs = 0;

    // Single pending payload (only when MQTT is down)
    char     _pendingType[16]{};
    char     _pendingPayload[512]{};
    bool     _hasPending = false;

    bool postNow(const char* type, const char* payload);
};
