#pragma once

#include <Arduino.h>

class OtaManager {
public:
    static OtaManager& getInstance();

    void begin();
    void loop();

    bool isRunning() const { return _running; }
    bool isSafeToOta() const;

    // Called by local webserver for manual firmware upload
    bool beginLocalUpload(size_t contentLength);
    bool writeChunk(const uint8_t* data, size_t len);
    bool endLocalUpload(String& reason);

    // Remote OTA: download firmware from URL and flash.
    // Returns false on failure (reason in lastRemoteError()).
    // On success, publishes command_ack (best-effort) then calls ESP.restart() — never returns.
    bool beginRemoteOta(const char* url, const char* commandId = "");

    // Result of last local upload — read by webserver after upload callback completes
    bool          lastLocalOk()     const { return _lastLocalOk; }
    const String& lastLocalError()  const { return _lastLocalError; }
    const String& lastRemoteError() const { return _lastRemoteError; }

private:
    OtaManager() = default;
    bool     _running = false;
    uint32_t _lastCheckMs = 0;
    bool     _localUploadActive = false;
    bool     _lastLocalOk = false;
    String   _lastLocalError;
    String   _lastRemoteError;
};
