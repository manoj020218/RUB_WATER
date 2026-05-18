#include "ota_manager.h"

#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <HTTPUpdate.h>
#include <Preferences.h>
#include <WiFiClient.h>
#include <WiFiClientSecure.h>

#include <cctype>
#include <cstdio>
#include <cstring>

namespace {
constexpr char OTA_PREFS_NS[] = "fg_ota";
constexpr char OTA_PREF_BASE_URL_KEY[] = "base_url";
constexpr uint32_t OTA_MIN_CHECK_INTERVAL_MS = 60000UL;
}  // namespace

OtaManager& OtaManager::getInstance() {
    static OtaManager instance;
    return instance;
}

void OtaManager::begin(const DeviceConfig& config) {
    std::memset(_productPid, 0, sizeof(_productPid));
    std::memset(_hardwareCode, 0, sizeof(_hardwareCode));
    std::memset(_deviceId, 0, sizeof(_deviceId));
    std::memset(_locationId, 0, sizeof(_locationId));
    std::memset(_currentVersion, 0, sizeof(_currentVersion));
    std::memset(_otaBaseUrl, 0, sizeof(_otaBaseUrl));
    std::memset(_manifestPath, 0, sizeof(_manifestPath));
    std::memset(_channel, 0, sizeof(_channel));
    std::memset(_pendingUrl, 0, sizeof(_pendingUrl));
    std::memset(_pendingVersion, 0, sizeof(_pendingVersion));

    std::strncpy(_productPid, config.productPid, sizeof(_productPid) - 1);
    std::strncpy(_hardwareCode, config.hardwareCode, sizeof(_hardwareCode) - 1);
    std::strncpy(_deviceId, config.deviceId, sizeof(_deviceId) - 1);
    std::strncpy(_locationId, config.locationId, sizeof(_locationId) - 1);
    std::strncpy(_currentVersion, config.firmwareVersion, sizeof(_currentVersion) - 1);
    std::strncpy(_otaBaseUrl, config.otaBaseUrl, sizeof(_otaBaseUrl) - 1);
    std::strncpy(_manifestPath, config.otaManifestPath, sizeof(_manifestPath) - 1);
    std::strncpy(_channel, config.otaChannel, sizeof(_channel) - 1);
    _checkIntervalMs = config.otaCheckIntervalMs;
    if (_checkIntervalMs < OTA_MIN_CHECK_INTERVAL_MS) {
        _checkIntervalMs = OTA_MIN_CHECK_INTERVAL_MS;
    }

    _lastCheckMs = 0;
    _pendingCheck = false;
    _pendingApply = false;
    _pendingDirectUpdate = false;
    _updating = false;

    loadPersistedHost();
    setStatus("OTA_READY");
}

void OtaManager::loop(bool dangerActive, bool wifiConnected) {
    if (!wifiConnected || dangerActive || _updating) {
        return;
    }

    const unsigned long now = millis();

    if (_pendingDirectUpdate) {
        _updating = true;
        _pendingDirectUpdate = false;
        bool ok = performUpdate(_pendingUrl, _pendingVersion);
        _updating = false;
        if (!ok) {
            setStatus("OTA_DIRECT_UPDATE_FAILED");
        }
        return;
    }

    if (_pendingCheck) {
        const bool applyIfAvailable = _pendingApply;
        _pendingCheck = false;
        _pendingApply = false;

        _updating = true;
        bool ok = runManifestCheck(applyIfAvailable);
        _updating = false;
        if (!ok) {
            setStatus("OTA_CHECK_FAILED");
        }
        return;
    }

    if (_checkIntervalMs == 0 || now - _lastCheckMs < _checkIntervalMs) {
        return;
    }

    _lastCheckMs = now;
    _updating = true;
    bool ok = runManifestCheck(false);
    _updating = false;
    if (!ok) {
        setStatus("OTA_PERIODIC_CHECK_FAILED");
    }
}

bool OtaManager::requestCheck(bool applyIfAvailable) {
    _pendingCheck = true;
    if (applyIfAvailable) {
        _pendingApply = true;
        setStatus("OTA_UPDATE_QUEUED");
    } else {
        setStatus("OTA_CHECK_QUEUED");
    }
    return true;
}

bool OtaManager::requestDirectUpdate(const char* firmwareUrl, const char* targetVersion) {
    copyTrimmed(_pendingUrl, sizeof(_pendingUrl), firmwareUrl);
    if (_pendingUrl[0] == '\0') {
        return false;
    }

    copyTrimmed(_pendingVersion, sizeof(_pendingVersion), targetVersion ? targetVersion : "");
    _pendingDirectUpdate = true;
    setStatus("OTA_DIRECT_UPDATE_QUEUED");
    return true;
}

bool OtaManager::setOtaHost(const char* hostOrBaseUrl) {
    char trimmed[128]{};
    copyTrimmed(trimmed, sizeof(trimmed), hostOrBaseUrl);
    if (trimmed[0] == '\0') {
        return false;
    }

    String normalized = String(trimmed);
    normalized.trim();
    if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
        normalized = String("http://") + normalized;
    }
    while (normalized.endsWith("/")) {
        normalized.remove(normalized.length() - 1);
    }
    if (normalized.length() == 0 || normalized.length() >= sizeof(_otaBaseUrl)) {
        return false;
    }

    std::memset(_otaBaseUrl, 0, sizeof(_otaBaseUrl));
    std::strncpy(_otaBaseUrl, normalized.c_str(), sizeof(_otaBaseUrl) - 1);
    persistHost();
    setStatus("OTA_HOST_UPDATED");
    return true;
}

const char* OtaManager::otaHost() const {
    return _otaBaseUrl;
}

const char* OtaManager::lastStatus() const {
    return _status;
}

bool OtaManager::runManifestCheck(bool applyIfAvailable) {
    UpdateManifest manifest{};
    if (!fetchManifest(manifest)) {
        return false;
    }

    bool hasUpdate = manifest.updateAvailable;
    if (!hasUpdate && manifest.version[0] != '\0') {
        hasUpdate = compareVersion(manifest.version, _currentVersion) > 0;
    }
    if (!hasUpdate || manifest.firmwareUrl[0] == '\0') {
        setStatus("OTA_NO_UPDATE");
        return true;
    }

    if (!applyIfAvailable && !manifest.force) {
        setStatus("OTA_UPDATE_AVAILABLE");
        return true;
    }

    return performUpdate(manifest.firmwareUrl, manifest.version);
}

bool OtaManager::fetchManifest(UpdateManifest& manifest) {
    const String manifestUrl = buildManifestUrl();
    if (manifestUrl.isEmpty()) {
        return false;
    }

    HTTPClient http;
    http.setConnectTimeout(8000);
    http.setTimeout(15000);
    http.setFollowRedirects(HTTPC_FORCE_FOLLOW_REDIRECTS);

    bool started = false;
    if (manifestUrl.startsWith("https://")) {
        WiFiClientSecure secureClient;
        secureClient.setInsecure();
        started = http.begin(secureClient, manifestUrl);
    } else {
        started = http.begin(manifestUrl);
    }
    if (!started) {
        return false;
    }

    const int code = http.GET();
    if (code != HTTP_CODE_OK) {
        http.end();
        return false;
    }

    const String payload = http.getString();
    http.end();
    if (payload.length() == 0) {
        return false;
    }

    StaticJsonDocument<768> doc;
    if (deserializeJson(doc, payload) != DeserializationError::Ok) {
        return false;
    }

    if (doc.containsKey("update_available")) {
        manifest.updateAvailable = doc["update_available"].as<bool>();
    } else if (doc.containsKey("available")) {
        manifest.updateAvailable = doc["available"].as<bool>();
    } else if (doc.containsKey("has_update")) {
        manifest.updateAvailable = doc["has_update"].as<bool>();
    }

    if (doc.containsKey("force")) {
        manifest.force = doc["force"].as<bool>();
    } else if (doc.containsKey("mandatory")) {
        manifest.force = doc["mandatory"].as<bool>();
    }

    const char* version = doc["version"] | "";
    if (version[0] == '\0') {
        version = doc["target_version"] | "";
    }

    const char* url = doc["firmware_url"] | "";
    if (url[0] == '\0') {
        url = doc["url"] | "";
    }
    if (url[0] == '\0') {
        url = doc["bin_url"] | "";
    }
    if (url[0] == '\0' && doc["data"].is<JsonObject>()) {
        JsonObject data = doc["data"].as<JsonObject>();
        version = data["version"] | version;
        const char* nestedUrl = data["firmware_url"] | "";
        if (nestedUrl[0] == '\0') {
            nestedUrl = data["url"] | "";
        }
        if (nestedUrl[0] == '\0') {
            nestedUrl = data["bin_url"] | "";
        }
        url = nestedUrl[0] == '\0' ? url : nestedUrl;
    }

    copyTrimmed(manifest.version, sizeof(manifest.version), version);
    const String resolvedUrl = resolveFirmwareUrl(url);
    if (resolvedUrl.length() > 0) {
        std::strncpy(manifest.firmwareUrl, resolvedUrl.c_str(), sizeof(manifest.firmwareUrl) - 1);
    }
    return true;
}

bool OtaManager::performUpdate(const char* firmwareUrl, const char* targetVersion) {
    const String resolvedUrl = resolveFirmwareUrl(firmwareUrl);
    if (resolvedUrl.length() == 0) {
        return false;
    }

    setStatus("OTA_DOWNLOADING");
    HTTPUpdate httpUpdater;
    httpUpdater.rebootOnUpdate(true);
    t_httpUpdate_return result = HTTP_UPDATE_FAILED;

    if (resolvedUrl.startsWith("https://")) {
        WiFiClientSecure secureClient;
        secureClient.setInsecure();
        result = httpUpdater.update(secureClient, resolvedUrl, _currentVersion);
    } else {
        WiFiClient client;
        result = httpUpdater.update(client, resolvedUrl, _currentVersion);
    }

    if (result == HTTP_UPDATE_OK) {
        copyTrimmed(_currentVersion, sizeof(_currentVersion), targetVersion ? targetVersion : _currentVersion);
        setStatus("OTA_OK_REBOOTING");
        return true;
    }

    if (result == HTTP_UPDATE_NO_UPDATES) {
        setStatus("OTA_SERVER_NO_UPDATE");
        return true;
    }

    char err[128]{};
    std::snprintf(err, sizeof(err), "OTA_FAIL_%d", httpUpdater.getLastError());
    setStatus(err);
    return false;
}

String OtaManager::buildManifestUrl() const {
    if (_otaBaseUrl[0] == '\0') {
        return String();
    }

    String base = String(_otaBaseUrl);
    base.trim();
    if (!base.startsWith("http://") && !base.startsWith("https://")) {
        base = String("http://") + base;
    }
    while (base.endsWith("/")) {
        base.remove(base.length() - 1);
    }

    String path = String(_manifestPath[0] == '\0' ? "/api/ota/check" : _manifestPath);
    if (!path.startsWith("/")) {
        path = String("/") + path;
    }

    String url = base + path;
    url += "?pid=" + String(_productPid);
    url += "&hw=" + String(_hardwareCode);
    url += "&device_id=" + String(_deviceId);
    url += "&location_id=" + String(_locationId);
    url += "&version=" + String(_currentVersion);
    url += "&channel=" + String(_channel);
    return url;
}

String OtaManager::resolveFirmwareUrl(const char* raw) const {
    if (!raw || raw[0] == '\0') {
        return String();
    }

    String candidate = String(raw);
    candidate.trim();
    if (candidate.startsWith("http://") || candidate.startsWith("https://")) {
        return candidate;
    }

    String base = String(_otaBaseUrl);
    base.trim();
    if (!base.startsWith("http://") && !base.startsWith("https://")) {
        base = String("http://") + base;
    }
    while (base.endsWith("/")) {
        base.remove(base.length() - 1);
    }
    if (!candidate.startsWith("/")) {
        candidate = String("/") + candidate;
    }
    return base + candidate;
}

int OtaManager::compareVersion(const char* candidate, const char* current) {
    auto readPart = [](const char*& p) -> int {
        while (*p != '\0' && !std::isdigit(static_cast<unsigned char>(*p))) {
            ++p;
        }
        int value = 0;
        while (*p != '\0' && std::isdigit(static_cast<unsigned char>(*p))) {
            value = (value * 10) + (*p - '0');
            ++p;
        }
        while (*p != '\0' && *p != '.') {
            ++p;
        }
        if (*p == '.') {
            ++p;
        }
        return value;
    };

    const char* a = candidate ? candidate : "";
    const char* b = current ? current : "";
    for (int i = 0; i < 4; ++i) {
        const int av = readPart(a);
        const int bv = readPart(b);
        if (av > bv) {
            return 1;
        }
        if (av < bv) {
            return -1;
        }
    }
    return 0;
}

void OtaManager::copyTrimmed(char* out, size_t outSize, const char* in) {
    if (!out || outSize == 0) {
        return;
    }
    out[0] = '\0';
    if (!in) {
        return;
    }

    while (*in != '\0' && std::isspace(static_cast<unsigned char>(*in))) {
        ++in;
    }

    size_t len = std::strlen(in);
    while (len > 0 && std::isspace(static_cast<unsigned char>(in[len - 1]))) {
        --len;
    }
    if (len >= outSize) {
        len = outSize - 1;
    }

    std::memcpy(out, in, len);
    out[len] = '\0';
}

void OtaManager::setStatus(const char* status) {
    std::memset(_status, 0, sizeof(_status));
    std::strncpy(_status, status ? status : "", sizeof(_status) - 1);
}

void OtaManager::loadPersistedHost() {
    Preferences prefs;
    if (!prefs.begin(OTA_PREFS_NS, true)) {
        return;
    }

    const String savedBaseUrl = prefs.getString(OTA_PREF_BASE_URL_KEY, "");
    prefs.end();
    if (savedBaseUrl.length() == 0) {
        return;
    }

    copyTrimmed(_otaBaseUrl, sizeof(_otaBaseUrl), savedBaseUrl.c_str());
}

void OtaManager::persistHost() const {
    Preferences prefs;
    if (!prefs.begin(OTA_PREFS_NS, false)) {
        return;
    }

    prefs.putString(OTA_PREF_BASE_URL_KEY, _otaBaseUrl);
    prefs.end();
}
