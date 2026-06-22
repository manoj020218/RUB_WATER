#pragma once

#include <Arduino.h>

struct VpsOtaPackage;

class VpsOtaHook {
public:
    static VpsOtaHook& getInstance();

    void begin(const char* deviceId, const char* deviceToken);
    void loop();

    bool isRunning() const { return _taskRunning; }
    String lastError() const { return _lastError; }

private:
    VpsOtaHook() = default;

    struct OtaTaskContext;

    char _deviceId[32]{};
    char _deviceToken[128]{};
    bool _started = false;
    bool _taskRunning = false;
    uint32_t _lastPollMs = 0;
    String _lastError;

    bool fetchPendingJob(struct VpsOtaPackage& pkg, String& jobId);
    bool postJobReport(const char* jobId, const char* status, const char* error, size_t bytesWritten, size_t totalBytes);
    bool startOtaTask(const struct VpsOtaPackage& pkg, const String& jobId);

    static void otaTaskEntry(void* param);
    void runOtaTask(OtaTaskContext* ctx);
};
