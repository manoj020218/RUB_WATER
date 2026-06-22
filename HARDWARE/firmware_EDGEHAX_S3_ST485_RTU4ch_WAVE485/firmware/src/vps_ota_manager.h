#pragma once

#include <Arduino.h>
#include <esp_partition.h>

enum class VpsOtaStage : uint8_t {
    IDLE = 0,
    FETCHING_MANIFEST,
    PREPARING_SLOT,
    DOWNLOADING,
    VERIFYING,
    ACTIVATING,
    COMPLETED,
    FAILED
};

struct VpsOtaTlsConfig {
    const char* caCert = nullptr;
    const char* authorizationHeader = nullptr;
    bool allowInsecureTls = false;
    bool allowHttp = false;
};

struct VpsOtaOptions {
    VpsOtaTlsConfig tls;
    uint16_t connectTimeoutMs = 10000;
    uint16_t readTimeoutMs    = 15000;
    uint32_t stallTimeoutMs   = 20000;
    uint8_t  maxRetries       = 6;
    size_t   bufferSize       = 8192;
    bool     autoReboot       = true;
};

struct VpsOtaPackage {
    String firmwareUrl;
    String sha256;   // SHA-256 of the exact .bin file bytes
    uint32_t sizeBytes = 0;
    String version;
    bool force = false;
};

typedef bool (*VpsOtaPreflightFn)(void* ctx);
typedef void (*VpsOtaProgressFn)(VpsOtaStage stage, size_t current, size_t total, void* ctx);

class VpsOtaManager {
public:
    static VpsOtaManager& getInstance();

    // Call once at boot to clear stale sessions and confirm the running image.
    void begin();

    // Expected manifest shape:
    // {
    //   "version": "2026.06.22-1",
    //   "url": "https://your-vps/path/firmware.bin",
    //   "sha256": "<64 hex chars of the exact .bin file>",
    //   "size": 2097152,
    //   "force": false
    // }
    bool runManifest(const char* manifestUrl, const VpsOtaOptions& options = VpsOtaOptions{});
    bool runPackage(const VpsOtaPackage& package, const VpsOtaOptions& options = VpsOtaOptions{});
    bool resumePending(const VpsOtaOptions& options = VpsOtaOptions{});

    void cancel();

    bool isRunning() const { return _running; }
    bool hasPendingSession() const;
    VpsOtaStage stage() const { return _stage; }
    String lastError() const { return _lastError; }
    size_t bytesWritten() const { return _session.bytesWritten; }
    size_t totalBytes() const { return _session.imageSize; }

    void setPreflightCallback(VpsOtaPreflightFn fn, void* ctx = nullptr);
    void setProgressCallback(VpsOtaProgressFn fn, void* ctx = nullptr);

private:
    VpsOtaManager() = default;

    struct PersistedSession {
        uint32_t magic = 0;
        uint16_t schema = 0;
        uint16_t flags = 0;
        uint32_t targetSubtype = 0;
        uint32_t imageSize = 0;
        uint32_t bytesWritten = 0;
        uint32_t lastPersistedBytes = 0;
        uint8_t  header[16]{};
        char     firmwareUrl[320]{};
        char     sha256[65]{};
        char     version[32]{};
        char     etag[96]{};
    };

    static constexpr uint32_t kSessionMagic     = 0x56505441UL; // "VPTA"
    static constexpr uint16_t kSessionSchema    = 1;
    static constexpr uint16_t kFlagHeaderSaved  = 0x0001;
    static constexpr size_t   kHeaderBytes      = 16;
    static constexpr uint32_t kPersistStepBytes = 64UL * 1024UL;

    bool fetchManifest(const char* manifestUrl, const VpsOtaOptions& options, VpsOtaPackage& outPkg);
    bool resumeOrStartPackage(const VpsOtaPackage& package, const VpsOtaOptions& options);
    bool prepareFreshSession(const VpsOtaPackage& package);
    bool downloadPackage(const VpsOtaOptions& options);
    bool processDownloadAttempt(const VpsOtaOptions& options, bool& completed, bool& restartFromZero);
    bool streamResponseBody(class HTTPClient& http, uint8_t* buffer, size_t bufferSize, uint32_t expectedBodyBytes, bool bodyLengthKnown, uint32_t stallTimeoutMs);
    bool writeChunkToPartition(const uint8_t* data, size_t len);
    bool finalizeDownloadedImage(const VpsOtaOptions& options);
    bool verifyPartitionHash(const esp_partition_t* partition, const char* expectedSha256);
    bool maybeConnectWifi(uint32_t timeoutMs);
    bool loadSession();
    bool saveSession(bool force = false);
    void clearSession();
    bool sessionMatchesPackage(const VpsOtaPackage& package) const;
    bool validatePackage(const VpsOtaPackage& package, bool allowSameVersion) const;
    const esp_partition_t* resolveTargetPartition() const;
    void setFailure(const String& message);
    void setStage(VpsOtaStage nextStage);
    void emitProgress();

    bool _running = false;
    bool _cancelRequested = false;
    VpsOtaStage _stage = VpsOtaStage::IDLE;
    String _lastError;
    PersistedSession _session{};
    VpsOtaPreflightFn _preflightFn = nullptr;
    void* _preflightCtx = nullptr;
    VpsOtaProgressFn _progressFn = nullptr;
    void* _progressCtx = nullptr;
};
