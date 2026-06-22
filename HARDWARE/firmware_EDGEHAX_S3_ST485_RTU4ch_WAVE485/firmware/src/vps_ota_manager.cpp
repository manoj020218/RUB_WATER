#include "vps_ota_manager.h"

#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WiFiClient.h>
#include <WiFiClientSecure.h>
#include <ctype.h>
#include <esp_ota_ops.h>
#include <esp_partition.h>
#include <esp_spi_flash.h>
#include <mbedtls/sha256.h>

#include "wifi_manager.h"

namespace {
constexpr const char* kNvsNamespace = "vps_ota";
constexpr const char* kNvsKey       = "session";

bool copyString(const String& value, char* dst, size_t dstSize) {
    if (dstSize == 0 || value.length() >= dstSize) return false;
    memcpy(dst, value.c_str(), value.length());
    dst[value.length()] = '\0';
    return true;
}

bool normalizeSha256(const String& value, char* out) {
    if (value.length() != 64) return false;
    for (size_t i = 0; i < 64; ++i) {
        const char c = value[i];
        if (!isxdigit(static_cast<unsigned char>(c))) return false;
        out[i] = static_cast<char>(tolower(static_cast<unsigned char>(c)));
    }
    out[64] = '\0';
    return true;
}

String toHexLower(const uint8_t* bytes, size_t len) {
    static const char* kHex = "0123456789abcdef";
    String out;
    out.reserve(len * 2U);
    for (size_t i = 0; i < len; ++i) {
        out += kHex[(bytes[i] >> 4) & 0x0F];
        out += kHex[bytes[i] & 0x0F];
    }
    return out;
}

uint32_t alignUp(uint32_t value, uint32_t alignment) {
    if (alignment == 0) return value;
    const uint32_t rem = value % alignment;
    return rem ? (value + alignment - rem) : value;
}

bool isHttpUrl(const String& url) {
    return url.startsWith("http://");
}

bool isHttpsUrl(const String& url) {
    return url.startsWith("https://");
}

bool sameText(const char* a, const String& b) {
    return String(a) == b;
}

bool parseContentRange(const String& header, uint32_t& start, uint32_t& end, uint32_t& total) {
    if (!header.startsWith("bytes ")) return false;
    const int dash = header.indexOf('-', 6);
    const int slash = header.indexOf('/', dash + 1);
    if (dash < 0 || slash < 0) return false;
    const String startStr = header.substring(6, dash);
    const String endStr   = header.substring(dash + 1, slash);
    const String totalStr = header.substring(slash + 1);
    if (!startStr.length() || !endStr.length() || !totalStr.length()) return false;
    start = static_cast<uint32_t>(startStr.toInt());
    end   = static_cast<uint32_t>(endStr.toInt());
    total = static_cast<uint32_t>(totalStr.toInt());
    return total > 0 && end >= start;
}

} // namespace

VpsOtaManager& VpsOtaManager::getInstance() {
    static VpsOtaManager inst;
    return inst;
}

void VpsOtaManager::begin() {
    const esp_err_t markErr = esp_ota_mark_app_valid_cancel_rollback();
    if (markErr == ESP_OK) {
        Serial.println("[VPS OTA] Running app marked valid");
    }

    if (!loadSession()) return;

    const esp_partition_t* running = esp_ota_get_running_partition();
    if (running && running->subtype == static_cast<esp_partition_subtype_t>(_session.targetSubtype)) {
        Serial.println("[VPS OTA] Clearing stale session for active partition");
        clearSession();
    }
}

bool VpsOtaManager::runManifest(const char* manifestUrl, const VpsOtaOptions& options) {
    if (!manifestUrl || !manifestUrl[0]) {
        setFailure("manifest_url_missing");
        return false;
    }
    if (_running) {
        setFailure("ota_already_running");
        return false;
    }

    VpsOtaPackage pkg;
    if (!fetchManifest(manifestUrl, options, pkg)) return false;
    return resumeOrStartPackage(pkg, options);
}

bool VpsOtaManager::runPackage(const VpsOtaPackage& package, const VpsOtaOptions& options) {
    if (_running) {
        setFailure("ota_already_running");
        return false;
    }
    return resumeOrStartPackage(package, options);
}

bool VpsOtaManager::resumePending(const VpsOtaOptions& options) {
    if (_running) {
        setFailure("ota_already_running");
        return false;
    }
    if (!loadSession()) {
        setFailure("no_pending_ota_session");
        return false;
    }
    if (!maybeConnectWifi(options.connectTimeoutMs)) {
        setFailure("wifi_not_connected");
        return false;
    }
    if (_preflightFn && !_preflightFn(_preflightCtx)) {
        setFailure("ota_preflight_blocked");
        return false;
    }

    _running = true;
    _cancelRequested = false;
    _lastError = "";
    setStage(VpsOtaStage::DOWNLOADING);
    const bool ok = downloadPackage(options) && finalizeDownloadedImage(options);
    _running = false;
    if (!ok && _stage != VpsOtaStage::FAILED) {
        setFailure("ota_resume_failed");
    }
    return ok;
}

void VpsOtaManager::cancel() {
    _cancelRequested = true;
}

bool VpsOtaManager::hasPendingSession() const {
    return _session.magic == kSessionMagic &&
           _session.schema == kSessionSchema &&
           _session.imageSize > 0 &&
           _session.firmwareUrl[0] != '\0' &&
           _session.sha256[0] != '\0';
}

void VpsOtaManager::setPreflightCallback(VpsOtaPreflightFn fn, void* ctx) {
    _preflightFn = fn;
    _preflightCtx = ctx;
}

void VpsOtaManager::setProgressCallback(VpsOtaProgressFn fn, void* ctx) {
    _progressFn = fn;
    _progressCtx = ctx;
}

bool VpsOtaManager::fetchManifest(const char* manifestUrl, const VpsOtaOptions& options, VpsOtaPackage& outPkg) {
    if (!maybeConnectWifi(options.connectTimeoutMs)) {
        setFailure("wifi_not_connected");
        return false;
    }

    const String url = manifestUrl;
    if (isHttpUrl(url) && !options.tls.allowHttp) {
        setFailure("plain_http_manifest_blocked");
        return false;
    }
    if (!isHttpUrl(url) && !isHttpsUrl(url)) {
        setFailure("manifest_url_invalid");
        return false;
    }

    setStage(VpsOtaStage::FETCHING_MANIFEST);

    WiFiClient plainClient;
    WiFiClientSecure tlsClient;
    WiFiClient* client = nullptr;
    HTTPClient http;

    if (isHttpsUrl(url)) {
        if (options.tls.caCert && options.tls.caCert[0]) {
            tlsClient.setCACert(options.tls.caCert);
        } else if (options.tls.allowInsecureTls) {
            tlsClient.setInsecure();
        } else {
            setFailure("https_manifest_requires_ca_or_insecure_flag");
            return false;
        }
        client = &tlsClient;
    } else {
        client = &plainClient;
    }

    http.setConnectTimeout(options.connectTimeoutMs);
    http.setTimeout(options.readTimeoutMs);
    http.setReuse(false);
    http.setFollowRedirects(HTTPC_FORCE_FOLLOW_REDIRECTS);
    if (!http.begin(*client, url)) {
        setFailure("manifest_http_begin_failed");
        return false;
    }
    if (options.tls.authorizationHeader && options.tls.authorizationHeader[0]) {
        http.addHeader("Authorization", options.tls.authorizationHeader);
    }

    const int code = http.GET();
    if (code != HTTP_CODE_OK) {
        Serial.printf("[VPS OTA] Manifest HTTP error: %d\n", code);
        http.end();
        setFailure("manifest_http_error");
        return false;
    }

    StaticJsonDocument<512> doc;
    DeserializationError err = deserializeJson(doc, http.getStream());
    http.end();
    if (err != DeserializationError::Ok) {
        setFailure("manifest_json_invalid");
        return false;
    }

    outPkg.firmwareUrl = doc["url"] | "";
    outPkg.sha256      = doc["sha256"] | "";
    outPkg.sizeBytes   = doc["size"] | 0;
    outPkg.version     = doc["version"] | "";
    outPkg.force       = doc["force"] | false;

    if (!validatePackage(outPkg, outPkg.force)) {
        if (_lastError.isEmpty()) setFailure("manifest_content_invalid");
        return false;
    }
    return true;
}

bool VpsOtaManager::resumeOrStartPackage(const VpsOtaPackage& package, const VpsOtaOptions& options) {
    if (!validatePackage(package, package.force)) {
        if (_lastError.isEmpty()) setFailure("ota_package_invalid");
        return false;
    }
    if (!maybeConnectWifi(options.connectTimeoutMs)) {
        setFailure("wifi_not_connected");
        return false;
    }
    if (_preflightFn && !_preflightFn(_preflightCtx)) {
        setFailure("ota_preflight_blocked");
        return false;
    }

    _running = true;
    _cancelRequested = false;
    _lastError = "";

    bool ok = false;
    if (loadSession() && sessionMatchesPackage(package)) {
        setStage(VpsOtaStage::DOWNLOADING);
        ok = downloadPackage(options) && finalizeDownloadedImage(options);
    } else {
        if (hasPendingSession()) clearSession();
        ok = prepareFreshSession(package) && downloadPackage(options) && finalizeDownloadedImage(options);
    }

    _running = false;
    if (!ok && _stage != VpsOtaStage::FAILED) {
        setFailure("ota_run_failed");
    }
    return ok;
}

bool VpsOtaManager::prepareFreshSession(const VpsOtaPackage& package) {
    setStage(VpsOtaStage::PREPARING_SLOT);

    const esp_partition_t* target = esp_ota_get_next_update_partition(nullptr);
    if (!target) {
        setFailure("no_ota_target_partition");
        return false;
    }
    if (target->size < package.sizeBytes) {
        setFailure("firmware_larger_than_ota_slot");
        return false;
    }

    const uint32_t eraseSize = alignUp(package.sizeBytes, SPI_FLASH_SEC_SIZE);
    const esp_err_t eraseErr = esp_partition_erase_range(target, 0, eraseSize);
    if (eraseErr != ESP_OK) {
        Serial.printf("[VPS OTA] Erase failed: 0x%x\n", static_cast<unsigned>(eraseErr));
        setFailure("ota_slot_erase_failed");
        return false;
    }

    memset(&_session, 0, sizeof(_session));
    _session.magic = kSessionMagic;
    _session.schema = kSessionSchema;
    _session.targetSubtype = static_cast<uint32_t>(target->subtype);
    _session.imageSize = package.sizeBytes;

    if (!copyString(package.firmwareUrl, _session.firmwareUrl, sizeof(_session.firmwareUrl)) ||
        !normalizeSha256(package.sha256, _session.sha256) ||
        !copyString(package.version, _session.version, sizeof(_session.version))) {
        setFailure("ota_session_metadata_invalid");
        return false;
    }

    _session.bytesWritten = 0;
    _session.lastPersistedBytes = 0;
    if (!saveSession(true)) {
        setFailure("ota_session_persist_failed");
        return false;
    }
    emitProgress();
    return true;
}

bool VpsOtaManager::downloadPackage(const VpsOtaOptions& options) {
    if (_session.bytesWritten >= _session.imageSize) {
        return true;
    }

    setStage(VpsOtaStage::DOWNLOADING);
    uint8_t attempts = 0;

    while (_session.bytesWritten < _session.imageSize) {
        if (_cancelRequested) {
            setFailure("ota_cancelled");
            return false;
        }
        if (!maybeConnectWifi(options.connectTimeoutMs)) {
            if (++attempts > options.maxRetries) {
                setFailure("wifi_reconnect_failed");
                return false;
            }
            delay(1000);
            continue;
        }

        bool completed = false;
        bool restartThisPass = false;
        if (processDownloadAttempt(options, completed, restartThisPass)) {
            attempts = 0;
            if (completed) return true;
        } else {
            if (restartThisPass) {
                attempts = 0;
                VpsOtaPackage pkg;
                pkg.firmwareUrl = String(_session.firmwareUrl);
                pkg.sha256      = String(_session.sha256);
                pkg.sizeBytes   = _session.imageSize;
                pkg.version     = String(_session.version);
                pkg.force       = true;
                if (!prepareFreshSession(pkg)) return false;
                continue;
            }
            if (++attempts > options.maxRetries) {
                setFailure(_lastError.isEmpty() ? "download_retries_exhausted" : _lastError);
                return false;
            }
            delay(1500);
        }
    }
    return true;
}

bool VpsOtaManager::processDownloadAttempt(const VpsOtaOptions& options, bool& completed, bool& restartFromZero) {
    completed = false;
    restartFromZero = false;

    const String url = _session.firmwareUrl;
    const bool resumeRequested = (_session.bytesWritten > 0);

    WiFiClient plainClient;
    WiFiClientSecure tlsClient;
    WiFiClient* client = nullptr;
    HTTPClient http;

    if (isHttpsUrl(url)) {
        if (options.tls.caCert && options.tls.caCert[0]) {
            tlsClient.setCACert(options.tls.caCert);
        } else if (options.tls.allowInsecureTls) {
            tlsClient.setInsecure();
        } else {
            setFailure("https_firmware_requires_ca_or_insecure_flag");
            return false;
        }
        client = &tlsClient;
    } else if (isHttpUrl(url) && options.tls.allowHttp) {
        client = &plainClient;
    } else {
        setFailure("firmware_url_scheme_blocked");
        return false;
    }

    http.setConnectTimeout(options.connectTimeoutMs);
    http.setTimeout(options.readTimeoutMs);
    http.setReuse(false);
    http.setFollowRedirects(HTTPC_FORCE_FOLLOW_REDIRECTS);
    if (!http.begin(*client, url)) {
        setFailure("firmware_http_begin_failed");
        return false;
    }
    if (options.tls.authorizationHeader && options.tls.authorizationHeader[0]) {
        http.addHeader("Authorization", options.tls.authorizationHeader);
    }
    if (resumeRequested) {
        http.addHeader("Range", String("bytes=") + String(_session.bytesWritten) + "-");
        if (_session.etag[0] != '\0') {
            http.addHeader("If-Range", _session.etag);
        }
    }

    const char* headerKeys[] = {"Content-Length", "Content-Range", "Accept-Ranges", "ETag"};
    http.collectHeaders(headerKeys, 4);
    const int code = http.GET();
    if (code != HTTP_CODE_OK && code != HTTP_CODE_PARTIAL_CONTENT) {
        Serial.printf("[VPS OTA] Firmware HTTP error: %d\n", code);
        http.end();
        setFailure("firmware_http_error");
        return false;
    }

    const String etag = http.header("ETag");
    if (etag.length()) {
        if (_session.etag[0] == '\0') {
            copyString(etag, _session.etag, sizeof(_session.etag));
            saveSession(true);
        } else if (String(_session.etag) != etag) {
            http.end();
            restartFromZero = true;
            setFailure("firmware_etag_changed");
            return false;
        }
    }

    uint32_t expectedBodyBytes = 0;
    bool bodyLengthKnown = false;

    if (code == HTTP_CODE_PARTIAL_CONTENT) {
        uint32_t start = 0, end = 0, total = 0;
        if (!parseContentRange(http.header("Content-Range"), start, end, total) ||
            start != _session.bytesWritten ||
            total != _session.imageSize) {
            http.end();
            setFailure("invalid_content_range");
            return false;
        }
        expectedBodyBytes = end - start + 1U;
        bodyLengthKnown = true;
    } else {
        if (resumeRequested) {
            http.end();
            restartFromZero = true;
            setFailure("range_resume_not_supported");
            return false;
        }
        const int contentLength = http.getSize();
        if (contentLength > 0) {
            expectedBodyBytes = static_cast<uint32_t>(contentLength);
            bodyLengthKnown = true;
        }
    }

    uint8_t* buffer = static_cast<uint8_t*>(malloc(options.bufferSize));
    if (!buffer) {
        http.end();
        setFailure("ota_buffer_alloc_failed");
        return false;
    }

    const bool streamed = streamResponseBody(http, buffer, options.bufferSize, expectedBodyBytes, bodyLengthKnown, options.stallTimeoutMs);
    free(buffer);
    http.end();

    if (!streamed) return false;

    if (_session.bytesWritten == _session.imageSize) {
        saveSession(true);
        completed = true;
    }
    return true;
}

bool VpsOtaManager::streamResponseBody(HTTPClient& http, uint8_t* buffer, size_t bufferSize, uint32_t expectedBodyBytes, bool bodyLengthKnown, uint32_t stallTimeoutMs) {
    WiFiClient* stream = http.getStreamPtr();
    if (!stream) {
        setFailure("firmware_stream_missing");
        return false;
    }

    const uint32_t initialWritten = _session.bytesWritten;
    uint32_t bodyRead = 0;
    uint32_t lastDataMs = millis();

    while (_session.bytesWritten < _session.imageSize) {
        if (_cancelRequested) {
            setFailure("ota_cancelled");
            return false;
        }

        const int avail = stream->available();
        if (avail > 0) {
            const size_t wanted = min(bufferSize, static_cast<size_t>(avail));
            const int read = stream->readBytes(buffer, wanted);
            if (read <= 0) continue;
            lastDataMs = millis();
            bodyRead += static_cast<uint32_t>(read);
            if (!writeChunkToPartition(buffer, static_cast<size_t>(read))) return false;
            emitProgress();

            if (bodyLengthKnown && bodyRead >= expectedBodyBytes) break;
            continue;
        }

        if (!stream->connected()) break;
        if ((millis() - lastDataMs) > stallTimeoutMs) {
            setFailure("download_stalled");
            return false;
        }
        delay(5);
        yield();
    }

    if (bodyLengthKnown && bodyRead < expectedBodyBytes) {
        setFailure("partial_download_chunk");
        return false;
    }

    if (_session.bytesWritten < _session.imageSize && bodyRead == 0 && initialWritten == _session.bytesWritten) {
        setFailure("firmware_stream_ended_early");
        return false;
    }
    return true;
}

bool VpsOtaManager::writeChunkToPartition(const uint8_t* data, size_t len) {
    const esp_partition_t* target = resolveTargetPartition();
    if (!target) {
        setFailure("ota_target_partition_missing");
        return false;
    }

    size_t consumed = 0;
    while (consumed < len) {
        if (_session.bytesWritten < kHeaderBytes) {
            const size_t remainingHeader = kHeaderBytes - _session.bytesWritten;
            const size_t headerPart = min(remainingHeader, len - consumed);
            memcpy(_session.header + _session.bytesWritten, data + consumed, headerPart);
            _session.bytesWritten += static_cast<uint32_t>(headerPart);
            consumed += headerPart;
            if (_session.bytesWritten >= kHeaderBytes) {
                _session.flags |= kFlagHeaderSaved;
                saveSession(true);
            }
            continue;
        }

        const size_t toWrite = len - consumed;
        const uint32_t flashOffset = _session.bytesWritten;
        const esp_err_t err = esp_partition_write(target, flashOffset, data + consumed, toWrite);
        if (err != ESP_OK) {
            Serial.printf("[VPS OTA] Partition write failed: 0x%x\n", static_cast<unsigned>(err));
            setFailure("partition_write_failed");
            return false;
        }
        _session.bytesWritten += static_cast<uint32_t>(toWrite);
        consumed += toWrite;
    }

    if (_session.bytesWritten == _session.imageSize ||
        (_session.bytesWritten - _session.lastPersistedBytes) >= kPersistStepBytes) {
        saveSession();
    }
    return true;
}

bool VpsOtaManager::finalizeDownloadedImage(const VpsOtaOptions& options) {
    if (_session.bytesWritten != _session.imageSize) {
        setFailure("firmware_not_fully_downloaded");
        return false;
    }
    if (!(_session.flags & kFlagHeaderSaved)) {
        setFailure("firmware_header_incomplete");
        return false;
    }

    const esp_partition_t* target = resolveTargetPartition();
    if (!target) {
        setFailure("ota_target_partition_missing");
        return false;
    }

    setStage(VpsOtaStage::VERIFYING);
    const esp_err_t writeHeaderErr = esp_partition_write(target, 0, _session.header, kHeaderBytes);
    if (writeHeaderErr != ESP_OK) {
        Serial.printf("[VPS OTA] Header write failed: 0x%x\n", static_cast<unsigned>(writeHeaderErr));
        setFailure("header_write_failed");
        return false;
    }

    if (!verifyPartitionHash(target, _session.sha256)) {
        clearSession();
        setFailure("firmware_sha256_mismatch");
        return false;
    }

    esp_app_desc_t desc{};
    if (esp_ota_get_partition_description(target, &desc) == ESP_OK) {
        Serial.printf("[VPS OTA] Target version=%s project=%s\n", desc.version, desc.project_name);
        if (_session.version[0] != '\0' && String(desc.version) != String(_session.version)) {
            Serial.printf("[VPS OTA] Version warning: manifest=%s image=%s\n", _session.version, desc.version);
        }
    }

    setStage(VpsOtaStage::ACTIVATING);
    const esp_err_t activateErr = esp_ota_set_boot_partition(target);
    if (activateErr != ESP_OK) {
        Serial.printf("[VPS OTA] Activate failed: 0x%x\n", static_cast<unsigned>(activateErr));
        setFailure("boot_partition_switch_failed");
        return false;
    }

    clearSession();
    setStage(VpsOtaStage::COMPLETED);
    Serial.println("[VPS OTA] Image verified and activated");

    if (options.autoReboot) {
        Serial.println("[VPS OTA] Rebooting in 1500 ms");
        delay(1500);
        ESP.restart();
    }
    return true;
}

bool VpsOtaManager::verifyPartitionHash(const esp_partition_t* partition, const char* expectedSha256) {
    uint8_t* buffer = static_cast<uint8_t*>(malloc(4096));
    if (!buffer) {
        setFailure("hash_buffer_alloc_failed");
        return false;
    }

    mbedtls_sha256_context ctx;
    mbedtls_sha256_init(&ctx);
    mbedtls_sha256_starts_ret(&ctx, 0);

    uint32_t offset = 0;
    while (offset < _session.imageSize) {
        const size_t chunk = min(static_cast<uint32_t>(4096), _session.imageSize - offset);
        const esp_err_t err = esp_partition_read(partition, offset, buffer, chunk);
        if (err != ESP_OK) {
            free(buffer);
            mbedtls_sha256_free(&ctx);
            Serial.printf("[VPS OTA] Partition read failed: 0x%x\n", static_cast<unsigned>(err));
            setFailure("partition_readback_failed");
            return false;
        }
        mbedtls_sha256_update_ret(&ctx, buffer, chunk);
        offset += static_cast<uint32_t>(chunk);
        yield();
    }

    uint8_t digest[32]{};
    mbedtls_sha256_finish_ret(&ctx, digest);
    mbedtls_sha256_free(&ctx);
    free(buffer);

    const String actual = toHexLower(digest, sizeof(digest));
    Serial.printf("[VPS OTA] SHA256=%s\n", actual.c_str());
    return actual.equalsIgnoreCase(expectedSha256);
}

bool VpsOtaManager::maybeConnectWifi(uint32_t timeoutMs) {
    if (WifiManager::getInstance().isConnected()) return true;
    Serial.println("[VPS OTA] WiFi reconnect requested");
    return WifiManager::getInstance().connectNow(timeoutMs);
}

bool VpsOtaManager::loadSession() {
    Preferences prefs;
    if (!prefs.begin(kNvsNamespace, true)) return false;
    PersistedSession loaded{};
    const size_t n = prefs.getBytes(kNvsKey, &loaded, sizeof(loaded));
    prefs.end();
    if (n != sizeof(loaded)) return false;
    if (loaded.magic != kSessionMagic || loaded.schema != kSessionSchema) return false;
    if (loaded.imageSize == 0 || loaded.firmwareUrl[0] == '\0' || loaded.sha256[0] == '\0') return false;
    _session = loaded;
    return true;
}

bool VpsOtaManager::saveSession(bool force) {
    if (!hasPendingSession()) return false;
    if (!force && (_session.bytesWritten - _session.lastPersistedBytes) < kPersistStepBytes) return true;

    Preferences prefs;
    if (!prefs.begin(kNvsNamespace, false)) return false;
    PersistedSession snapshot = _session;
    snapshot.lastPersistedBytes = snapshot.bytesWritten;
    const size_t written = prefs.putBytes(kNvsKey, &snapshot, sizeof(snapshot));
    prefs.end();
    if (written != sizeof(_session)) return false;
    _session.lastPersistedBytes = _session.bytesWritten;
    return true;
}

void VpsOtaManager::clearSession() {
    Preferences prefs;
    if (prefs.begin(kNvsNamespace, false)) {
        prefs.remove(kNvsKey);
        prefs.end();
    }
    memset(&_session, 0, sizeof(_session));
}

bool VpsOtaManager::sessionMatchesPackage(const VpsOtaPackage& package) const {
    return hasPendingSession() &&
           _session.imageSize == package.sizeBytes &&
           sameText(_session.firmwareUrl, package.firmwareUrl) &&
           String(_session.sha256).equalsIgnoreCase(package.sha256);
}

bool VpsOtaManager::validatePackage(const VpsOtaPackage& package, bool allowSameVersion) const {
    if (package.sizeBytes == 0) {
        const_cast<VpsOtaManager*>(this)->setFailure("firmware_size_missing");
        return false;
    }
    if (package.firmwareUrl.isEmpty()) {
        const_cast<VpsOtaManager*>(this)->setFailure("firmware_url_missing");
        return false;
    }
    if (isHttpUrl(package.firmwareUrl)) {
        // transport policy is enforced later with options.allowHttp
    } else if (!isHttpsUrl(package.firmwareUrl)) {
        const_cast<VpsOtaManager*>(this)->setFailure("firmware_url_invalid");
        return false;
    }

    char normalized[65]{};
    if (!normalizeSha256(package.sha256, normalized)) {
        const_cast<VpsOtaManager*>(this)->setFailure("firmware_sha256_invalid");
        return false;
    }

    if (!allowSameVersion && package.version.length()) {
        const esp_app_desc_t* runningDesc = esp_ota_get_app_description();
        if (runningDesc && package.version == String(runningDesc->version)) {
            const_cast<VpsOtaManager*>(this)->setFailure("firmware_version_already_running");
            return false;
        }
    }
    return true;
}

const esp_partition_t* VpsOtaManager::resolveTargetPartition() const {
    if (!hasPendingSession()) return nullptr;
    return esp_partition_find_first(
        ESP_PARTITION_TYPE_APP,
        static_cast<esp_partition_subtype_t>(_session.targetSubtype),
        nullptr
    );
}

void VpsOtaManager::setFailure(const String& message) {
    _lastError = message;
    _stage = VpsOtaStage::FAILED;
    emitProgress();
    Serial.printf("[VPS OTA] FAIL: %s\n", message.c_str());
}

void VpsOtaManager::setStage(VpsOtaStage nextStage) {
    _stage = nextStage;
    emitProgress();
}

void VpsOtaManager::emitProgress() {
    if (_progressFn) {
        _progressFn(_stage, _session.bytesWritten, _session.imageSize, _progressCtx);
    }
}
