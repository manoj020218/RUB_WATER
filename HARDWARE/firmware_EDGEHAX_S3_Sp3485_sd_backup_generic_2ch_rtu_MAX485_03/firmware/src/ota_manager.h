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

private:
    OtaManager() = default;
    bool     _running = false;
    uint32_t _lastCheckMs = 0;
    bool     _localUploadActive = false;
};
