#include "vps_ota_hook.h"

#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

#include "device_profile.h"
#include "ota_manager.h"
#include "vps_ota_manager.h"
#include "wifi_manager.h"

namespace {
constexpr uint32_t kPollIntervalMs = 30000UL;
constexpr uint16_t kTaskStackBytes = 16384;
constexpr uint16_t kHttpConnectTimeoutMs = 8000;
constexpr uint16_t kHttpReadTimeoutMs    = 12000;

const char kApiTlsRootCa[] PROGMEM = R"PEM(
-----BEGIN CERTIFICATE-----
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
-----END CERTIFICATE-----
)PEM";

String apiBaseUrl() {
    return String("https://") + DEFAULT_MQTT_HOST;
}

bool otaPreflight(void*) {
    auto& ota = OtaManager::getInstance();
    return ota.isSafeToOta() && !ota.isRunning();
}
} // namespace

struct VpsOtaHook::OtaTaskContext {
    VpsOtaHook* self = nullptr;
    VpsOtaPackage pkg;
    String jobId;
};

VpsOtaHook& VpsOtaHook::getInstance() {
    static VpsOtaHook inst;
    return inst;
}

void VpsOtaHook::begin(const char* deviceId, const char* deviceToken) {
    if (_started) return;
    _started = true;
    strncpy(_deviceId, deviceId, sizeof(_deviceId) - 1);
    strncpy(_deviceToken, deviceToken, sizeof(_deviceToken) - 1);

    auto& mgr = VpsOtaManager::getInstance();
    mgr.begin();
    mgr.setPreflightCallback(otaPreflight, nullptr);
    Serial.println("[VPS OTA HOOK] Ready");
}

void VpsOtaHook::loop() {
    if (!_started || _taskRunning) return;
    if (!WifiManager::getInstance().isConnected()) return;

    const uint32_t now = millis();
    if ((now - _lastPollMs) < kPollIntervalMs) return;
    _lastPollMs = now;

    VpsOtaPackage pkg;
    String jobId;
    if (!fetchPendingJob(pkg, jobId)) return;
    if (jobId.isEmpty()) return;

    if (!startOtaTask(pkg, jobId)) {
        _lastError = "ota_task_start_failed";
    }
}

bool VpsOtaHook::fetchPendingJob(VpsOtaPackage& pkg, String& jobId) {
    jobId = "";

    WiFiClientSecure client;
    client.setCACert(kApiTlsRootCa);

    HTTPClient http;
    http.setConnectTimeout(kHttpConnectTimeoutMs);
    http.setTimeout(kHttpReadTimeoutMs);
    http.setReuse(false);

    String url = apiBaseUrl() + "/api/device-ota/" + _deviceId + "/pending"
               + "?current_version=" + String(FIRMWARE_VERSION)
               + "&hardware_version=" + String(HARDWARE_VERSION);
    if (!http.begin(client, url)) {
        _lastError = "pending_http_begin_failed";
        return false;
    }
    http.addHeader("x-device-token", _deviceToken);

    const int code = http.GET();
    if (code != HTTP_CODE_OK) {
        http.end();
        return false;
    }

    StaticJsonDocument<768> doc;
    const auto err = deserializeJson(doc, http.getStream());
    http.end();
    if (err != DeserializationError::Ok) {
        _lastError = "pending_json_invalid";
        return false;
    }

    const JsonVariant data = doc["data"];
    if (!data["pending"].as<bool>()) {
        return false;
    }

    jobId = String(data["job_id"] | "");
    pkg.firmwareUrl = String(data["url"] | "");
    pkg.sha256      = String(data["sha256"] | "");
    pkg.sizeBytes   = data["size"] | 0;
    pkg.version     = String(data["version"] | "");
    pkg.force       = data["force"] | false;

    if (jobId.isEmpty() || pkg.firmwareUrl.isEmpty() || pkg.sha256.isEmpty() || pkg.sizeBytes == 0) {
        _lastError = "pending_payload_incomplete";
        return false;
    }

    Serial.printf("[VPS OTA HOOK] Pending job %s version=%s size=%u\n",
                  jobId.c_str(), pkg.version.c_str(), static_cast<unsigned>(pkg.sizeBytes));
    return true;
}

bool VpsOtaHook::postJobReport(const char* jobId, const char* status, const char* error, size_t bytesWritten, size_t totalBytes) {
    if (!jobId || !jobId[0]) return false;
    if (!WifiManager::getInstance().isConnected()) return false;

    WiFiClientSecure client;
    client.setCACert(kApiTlsRootCa);

    HTTPClient http;
    http.setConnectTimeout(kHttpConnectTimeoutMs);
    http.setTimeout(kHttpReadTimeoutMs);
    http.setReuse(false);

    const String url = apiBaseUrl() + "/api/device-ota/" + _deviceId + "/report";
    if (!http.begin(client, url)) return false;
    http.addHeader("Content-Type", "application/json");
    http.addHeader("x-device-token", _deviceToken);

    StaticJsonDocument<384> doc;
    doc["job_id"] = jobId;
    doc["status"] = status;
    doc["bytes_written"] = static_cast<uint32_t>(bytesWritten);
    doc["total_bytes"] = static_cast<uint32_t>(totalBytes);
    doc["firmware_version"] = FIRMWARE_VERSION;
    doc["hardware_version"] = HARDWARE_VERSION;
    if (error && error[0]) {
        doc["error"] = error;
    }

    String body;
    serializeJson(doc, body);
    const int code = http.POST(body);
    http.end();
    return code >= 200 && code < 300;
}

bool VpsOtaHook::startOtaTask(const VpsOtaPackage& pkg, const String& jobId) {
    if (_taskRunning) return false;

    OtaTaskContext* ctx = new OtaTaskContext();
    if (!ctx) return false;
    ctx->self = this;
    ctx->pkg = pkg;
    ctx->jobId = jobId;

    _taskRunning = true;
    BaseType_t rc = xTaskCreatePinnedToCore(
        &VpsOtaHook::otaTaskEntry,
        "vps_ota_task",
        kTaskStackBytes,
        ctx,
        1,
        nullptr,
        1
    );
    if (rc != pdPASS) {
        _taskRunning = false;
        delete ctx;
        return false;
    }
    return true;
}

void VpsOtaHook::otaTaskEntry(void* param) {
    OtaTaskContext* ctx = static_cast<OtaTaskContext*>(param);
    if (ctx && ctx->self) {
        ctx->self->runOtaTask(ctx);
    }
    delete ctx;
    vTaskDelete(nullptr);
}

void VpsOtaHook::runOtaTask(OtaTaskContext* ctx) {
    _lastError = "";
    postJobReport(ctx->jobId.c_str(), "started", nullptr, 0, ctx->pkg.sizeBytes);

    VpsOtaOptions options;
    options.tls.caCert = kApiTlsRootCa;
    options.tls.allowHttp = false;
    options.tls.allowInsecureTls = false;
    options.connectTimeoutMs = 10000;
    options.readTimeoutMs = 15000;
    options.stallTimeoutMs = 20000;
    options.maxRetries = 6;
    options.bufferSize = 8192;
    options.autoReboot = false;

    auto& mgr = VpsOtaManager::getInstance();
    const bool ok = mgr.runPackage(ctx->pkg, options);

    if (ok) {
        postJobReport(ctx->jobId.c_str(), "completed", nullptr, mgr.bytesWritten(), mgr.totalBytes());
        Serial.printf("[VPS OTA HOOK] Job %s complete, rebooting\n", ctx->jobId.c_str());
        _taskRunning = false;
        delay(1200);
        ESP.restart();
        return;
    }

    _lastError = mgr.lastError();
    postJobReport(ctx->jobId.c_str(), "failed", _lastError.c_str(), mgr.bytesWritten(), mgr.totalBytes());
    Serial.printf("[VPS OTA HOOK] Job %s failed: %s\n", ctx->jobId.c_str(), _lastError.c_str());
    _taskRunning = false;
}
