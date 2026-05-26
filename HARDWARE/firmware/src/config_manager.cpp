#include "config_manager.h"

#include <ArduinoJson.h>
#include <Preferences.h>
#include <cstring>
#include <ctime>

#include "device_profile.h"

namespace {
constexpr const char* kPrefsNamespace = "fgcfg";
constexpr const char* kRuntimeConfigKey = "runtime_cfg";
constexpr const char* kDefaultLocalPin = "654321";

template <typename T>
void copyIfPresent(
    JsonObjectConst obj,
    const char* primaryKey,
    const char* fallbackKey,
    T& target
) {
    if (obj.containsKey(primaryKey)) {
        target = obj[primaryKey].as<T>();
        return;
    }
    if (fallbackKey && obj.containsKey(fallbackKey)) {
        target = obj[fallbackKey].as<T>();
    }
}

const char* firstString(JsonObjectConst obj, const char* primaryKey, const char* fallbackKey) {
    if (obj.containsKey(primaryKey)) {
        return obj[primaryKey] | "";
    }
    if (fallbackKey && obj.containsKey(fallbackKey)) {
        return obj[fallbackKey] | "";
    }
    return "";
}
}  // namespace

ConfigManager& ConfigManager::getInstance() {
    static ConfigManager instance;
    return instance;
}

void ConfigManager::begin() {
    loadDefaults();
    loadRuntimeDefaults();

    if (!loadRuntimeConfigFromNvs()) {
        persistRuntimeConfigToNvs();
    }

    syncRuntimeIdentifiers();
    _changeNotice.pending = false;
}

const DeviceConfig& ConfigManager::getConfig() const {
    return _config;
}

const FloodGuardRuntimeConfig& ConfigManager::getRuntimeConfig() const {
    return _runtimeConfig;
}

bool ConfigManager::applyRuntimeConfigFromJson(const char* payload, String& reason, const char* source) {
    FloodGuardRuntimeConfig next = _runtimeConfig;
    if (!parseRuntimeConfigJson(payload, _runtimeConfig, next, reason)) {
        return false;
    }
    return applyRuntimeConfig(next, reason, source);
}

bool ConfigManager::applyRuntimeConfig(const FloodGuardRuntimeConfig& nextConfig, String& reason, const char* source) {
    FloodGuardRuntimeConfig candidate = nextConfig;

    if (!validateRuntimeConfig(candidate, reason)) {
        return false;
    }

    candidate.configVersion = (_runtimeConfig.configVersion == 0)
        ? 1
        : (_runtimeConfig.configVersion + 1);
    candidate.lastSavedEpoch = static_cast<uint32_t>(time(nullptr));

    const FloodGuardRuntimeConfig previous = _runtimeConfig;
    _runtimeConfig = candidate;

    if (!persistRuntimeConfigToNvs()) {
        _runtimeConfig = previous;
        reason = "Failed to write config to NVS";
        return false;
    }

    syncRuntimeIdentifiers();
    _changeNotice.pending = true;
    _changeNotice.localSource = String(source ? source : "") == "device_local_page";
    _changeNotice.configVersion = _runtimeConfig.configVersion;
    copyCString(_changeNotice.source, sizeof(_changeNotice.source), source ? source : "unknown");
    return true;
}

bool ConfigManager::setLocalAdminPin(const String& pin, String& reason) {
    const String trimmed = String(pin);
    if (trimmed.length() < 4 || trimmed.length() > 12) {
        reason = "PIN length must be between 4 and 12";
        return false;
    }

    FloodGuardRuntimeConfig next = _runtimeConfig;
    copyCString(next.localAdminPinHash, sizeof(next.localAdminPinHash), hashPin(trimmed).c_str());
    return applyRuntimeConfig(next, reason, "device_local_page");
}

bool ConfigManager::verifyLocalPin(const String& pin) const {
    const String providedHash = hashPin(pin);
    return providedHash.equals(String(_runtimeConfig.localAdminPinHash));
}

bool ConfigManager::consumeChangeNotice(ConfigChangeNotice& notice) {
    if (!_changeNotice.pending) {
        return false;
    }
    notice = _changeNotice;
    _changeNotice.pending = false;
    return true;
}

bool ConfigManager::buildRuntimeConfigJson(char* out, size_t outSize) const {
    if (!out || outSize == 0) {
        return false;
    }

    StaticJsonDocument<896> doc;
    doc["alert_level_mm"] = _runtimeConfig.alertLevelMm;
    doc["danger_level_mm"] = _runtimeConfig.dangerLevelMm;
    doc["clear_level_mm"] = _runtimeConfig.clearLevelMm;
    doc["trigger_delay_seconds"] = _runtimeConfig.triggerDelaySeconds;
    doc["clear_delay_seconds"] = _runtimeConfig.clearDelaySeconds;
    doc["rs485_sensor_enabled"] = _runtimeConfig.rs485SensorEnabled;
    doc["switch_sensor_enabled"] = _runtimeConfig.switchSensorEnabled;
    doc["switch_level_1_mm"] = _runtimeConfig.switchLevel1Mm;
    doc["switch_level_2_mm"] = _runtimeConfig.switchLevel2Mm;
    doc["sensor_mount_height_mm"] = _runtimeConfig.sensorMountHeightMm;
    doc["mismatch_duration_seconds"] = _runtimeConfig.mismatchDurationSeconds;
    doc["device_id"] = _runtimeConfig.deviceId;
    doc["location_id"] = _runtimeConfig.locationId;
    doc["local_admin_pin_hash"] = _runtimeConfig.localAdminPinHash;
    doc["config_version"] = _runtimeConfig.configVersion;
    doc["last_saved_epoch"] = _runtimeConfig.lastSavedEpoch;

    doc["daily_reboot_enabled"] = _runtimeConfig.dailyRebootEnabled;
    char rebootTimeBuf[8]{};
    std::snprintf(rebootTimeBuf, sizeof(rebootTimeBuf), "%02u:%02u",
                  static_cast<unsigned>(_runtimeConfig.dailyRebootHour),
                  static_cast<unsigned>(_runtimeConfig.dailyRebootMinute));
    doc["daily_reboot_time"] = rebootTimeBuf;

    const size_t written = serializeJson(doc, out, outSize);
    return written > 0 && written < outSize;
}

const char* ConfigManager::localAdminPinHint() {
    return kDefaultLocalPin;
}

void ConfigManager::loadDefaults() {
    std::memset(&_config, 0, sizeof(_config));

    std::strncpy(_config.productPid, DeviceProfile::PRODUCT_PID, sizeof(_config.productPid) - 1);
    std::strncpy(_config.hardwareCode, DeviceProfile::HARDWARE_CODE, sizeof(_config.hardwareCode) - 1);
    std::strncpy(_config.deviceId, DeviceProfile::DEFAULT_DEVICE_ID, sizeof(_config.deviceId) - 1);
    std::strncpy(_config.locationId, DeviceProfile::DEFAULT_LOCATION_ID, sizeof(_config.locationId) - 1);
    std::strncpy(_config.wifiSsid, DeviceProfile::DEFAULT_WIFI_SSID, sizeof(_config.wifiSsid) - 1);
    std::strncpy(_config.wifiPass, DeviceProfile::DEFAULT_WIFI_PASS, sizeof(_config.wifiPass) - 1);
    std::strncpy(_config.mqttHost, DeviceProfile::DEFAULT_MQTT_HOST, sizeof(_config.mqttHost) - 1);
    _config.mqttPort = DeviceProfile::DEFAULT_MQTT_PORT;
    std::strncpy(_config.mqttUser, DeviceProfile::DEFAULT_MQTT_USER, sizeof(_config.mqttUser) - 1);
    std::strncpy(_config.mqttPass, DeviceProfile::DEFAULT_MQTT_PASS, sizeof(_config.mqttPass) - 1);
    std::strncpy(_config.httpBaseUrl, DeviceProfile::DEFAULT_HTTP_BASE_URL, sizeof(_config.httpBaseUrl) - 1);
    std::strncpy(_config.otaBaseUrl, DeviceProfile::DEFAULT_OTA_BASE_URL, sizeof(_config.otaBaseUrl) - 1);
    std::strncpy(_config.otaManifestPath, DeviceProfile::DEFAULT_OTA_MANIFEST_PATH, sizeof(_config.otaManifestPath) - 1);
    std::strncpy(_config.otaChannel, DeviceProfile::DEFAULT_OTA_CHANNEL, sizeof(_config.otaChannel) - 1);
    _config.otaCheckIntervalMs = DeviceProfile::DEFAULT_OTA_CHECK_INTERVAL_MS;
    std::strncpy(_config.firmwareVersion, DeviceProfile::FIRMWARE_VERSION, sizeof(_config.firmwareVersion) - 1);

    _config.reporting.dryIntervalMs = 180000;
    _config.reporting.waterDetectedIntervalMs = 10000;
    _config.reporting.alertIntervalMs = 5000;
    _config.reporting.rapidIntervalMs = 2000;
    _config.reporting.dangerIntervalMs = 2000;

    _config.diagnostics.enableRouterAutoReboot = true;
    _config.diagnostics.internetDownRebootAfterMs = 900000;

    _config.gpio.rs485RxPin = DeviceProfile::RS485_RX_PIN;
    _config.gpio.rs485TxPin = DeviceProfile::RS485_TX_PIN;
    _config.gpio.rs485DeRePin = DeviceProfile::RS485_DERE_PIN;

    _config.gpio.switch300Pin = DeviceProfile::SWITCH_300_PIN;
    _config.gpio.switch500Pin = DeviceProfile::SWITCH_500_PIN;

    _config.gpio.relaySirenPin = DeviceProfile::RELAY_SIREN_PIN;
    _config.gpio.relayBeaconPin = DeviceProfile::RELAY_BEACON_PIN;
    _config.gpio.relayVoicePin = DeviceProfile::RELAY_VOICE_PIN;
    _config.gpio.relayBarrierPin = DeviceProfile::RELAY_BARRIER_PIN;
    _config.gpio.relaySparePin = DeviceProfile::RELAY_SPARE_PIN;

    _config.gpio.sim800TxPin = DeviceProfile::SIM800_TX_PIN;
    _config.gpio.sim800RxPin = DeviceProfile::SIM800_RX_PIN;

    _config.gpio.rfTriggerEntryPin = DeviceProfile::RF_TRIGGER_ENTRY_PIN;
    _config.gpio.rfTriggerExitPin = DeviceProfile::RF_TRIGGER_EXIT_PIN;
}

void ConfigManager::loadRuntimeDefaults() {
    std::memset(&_runtimeConfig, 0, sizeof(_runtimeConfig));

    _runtimeConfig.alertLevelMm = 200;
    _runtimeConfig.dangerLevelMm = 500;
    _runtimeConfig.clearLevelMm = 450;
    _runtimeConfig.triggerDelaySeconds = 60;
    _runtimeConfig.clearDelaySeconds = 300;
    _runtimeConfig.rs485SensorEnabled = true;
    _runtimeConfig.switchSensorEnabled = true;
    _runtimeConfig.switchLevel1Mm = 300;
    _runtimeConfig.switchLevel2Mm = 500;
    _runtimeConfig.sensorMountHeightMm = 1200;
    _runtimeConfig.mismatchDurationSeconds = 120;
    _runtimeConfig.configVersion = 1;

    _runtimeConfig.dailyRebootEnabled = true;
    _runtimeConfig.dailyRebootHour = 3;
    _runtimeConfig.dailyRebootMinute = 30;

    copyCString(_runtimeConfig.deviceId, sizeof(_runtimeConfig.deviceId), _config.deviceId);
    copyCString(_runtimeConfig.locationId, sizeof(_runtimeConfig.locationId), _config.locationId);
    copyCString(_runtimeConfig.localAdminPinHash, sizeof(_runtimeConfig.localAdminPinHash), hashPin(kDefaultLocalPin).c_str());
}

bool ConfigManager::loadRuntimeConfigFromNvs() {
    Preferences prefs;
    if (!prefs.begin(kPrefsNamespace, true)) {
        return false;
    }

    const String raw = prefs.getString(kRuntimeConfigKey, "");
    prefs.end();
    if (raw.length() == 0) {
        return false;
    }

    String reason;
    FloodGuardRuntimeConfig next = _runtimeConfig;
    if (!parseRuntimeConfigJson(raw.c_str(), _runtimeConfig, next, reason)) {
        return false;
    }
    if (!validateRuntimeConfig(next, reason)) {
        return false;
    }

    _runtimeConfig = next;
    return true;
}

bool ConfigManager::persistRuntimeConfigToNvs() {
    char payload[768]{};
    if (!buildRuntimeConfigJson(payload, sizeof(payload))) {
        return false;
    }

    Preferences prefs;
    if (!prefs.begin(kPrefsNamespace, false)) {
        return false;
    }

    const bool ok = prefs.putString(kRuntimeConfigKey, payload) > 0;
    prefs.end();
    return ok;
}

void ConfigManager::syncRuntimeIdentifiers() {
    copyCString(_config.deviceId, sizeof(_config.deviceId), _runtimeConfig.deviceId);
    copyCString(_config.locationId, sizeof(_config.locationId), _runtimeConfig.locationId);
}

void ConfigManager::copyCString(char* dest, size_t destSize, const char* src) {
    if (!dest || destSize == 0) {
        return;
    }
    std::memset(dest, 0, destSize);
    if (!src) {
        return;
    }
    std::strncpy(dest, src, destSize - 1);
}

String ConfigManager::hashPin(const String& pin) {
    uint32_t hash = 2166136261UL;
    for (size_t i = 0; i < pin.length(); ++i) {
        hash ^= static_cast<uint8_t>(pin[i]);
        hash *= 16777619UL;
    }
    char out[24]{};
    std::snprintf(out, sizeof(out), "fnv1a_%08lx", static_cast<unsigned long>(hash));
    return String(out);
}

bool ConfigManager::parseRuntimeConfigJson(
    const char* payload,
    const FloodGuardRuntimeConfig& base,
    FloodGuardRuntimeConfig& outConfig,
    String& reason
) {
    if (!payload || payload[0] == '\0') {
        reason = "Empty config payload";
        return false;
    }

    DynamicJsonDocument doc(1536);
    const DeserializationError err = deserializeJson(doc, payload);
    if (err != DeserializationError::Ok) {
        reason = "Invalid JSON payload";
        return false;
    }

    outConfig = base;
    JsonObjectConst obj = doc.as<JsonObjectConst>();
    if (obj.containsKey("config")) {
        obj = obj["config"].as<JsonObjectConst>();
    }

    copyIfPresent<uint16_t>(obj, "alert_level_mm", "alertLevelMm", outConfig.alertLevelMm);
    copyIfPresent<uint16_t>(obj, "danger_level_mm", "dangerLevelMm", outConfig.dangerLevelMm);
    copyIfPresent<uint16_t>(obj, "clear_level_mm", "clearLevelMm", outConfig.clearLevelMm);
    copyIfPresent<uint16_t>(obj, "trigger_delay_seconds", "triggerDelaySeconds", outConfig.triggerDelaySeconds);
    copyIfPresent<uint16_t>(obj, "clear_delay_seconds", "clearDelaySeconds", outConfig.clearDelaySeconds);

    copyIfPresent<bool>(obj, "rs485_sensor_enabled", "rs485SensorEnabled", outConfig.rs485SensorEnabled);
    copyIfPresent<bool>(obj, "switch_sensor_enabled", "switchSensorEnabled", outConfig.switchSensorEnabled);

    copyIfPresent<uint16_t>(obj, "switch_level_1_mm", "switchLevel1Mm", outConfig.switchLevel1Mm);
    copyIfPresent<uint16_t>(obj, "switch_level_2_mm", "switchLevel2Mm", outConfig.switchLevel2Mm);
    copyIfPresent<uint16_t>(obj, "sensor_mount_height_mm", "sensorMountHeightMm", outConfig.sensorMountHeightMm);
    copyIfPresent<uint16_t>(obj, "mismatch_duration_seconds", "mismatchDurationSeconds", outConfig.mismatchDurationSeconds);

    const char* deviceId = firstString(obj, "device_id", "deviceId");
    if (deviceId[0] != '\0') {
        copyCString(outConfig.deviceId, sizeof(outConfig.deviceId), deviceId);
    }
    const char* locationId = firstString(obj, "location_id", "locationId");
    if (locationId[0] != '\0') {
        copyCString(outConfig.locationId, sizeof(outConfig.locationId), locationId);
    }

    copyIfPresent<bool>(obj, "daily_reboot_enabled", "dailyRebootEnabled", outConfig.dailyRebootEnabled);
    const char* rebootTime = firstString(obj, "daily_reboot_time", "dailyRebootTime");
    if (rebootTime[0] != '\0') {
        unsigned h = 0, m = 0;
        if (std::sscanf(rebootTime, "%u:%u", &h, &m) == 2 && h < 24 && m < 60) {
            outConfig.dailyRebootHour   = static_cast<uint8_t>(h);
            outConfig.dailyRebootMinute = static_cast<uint8_t>(m);
        }
    }

    const char* pin = firstString(obj, "local_admin_pin", nullptr);
    if (pin[0] != '\0') {
        copyCString(outConfig.localAdminPinHash, sizeof(outConfig.localAdminPinHash), hashPin(String(pin)).c_str());
    } else {
        const char* storedHash = firstString(obj, "local_admin_pin_hash", nullptr);
        if (storedHash[0] != '\0') {
            copyCString(outConfig.localAdminPinHash, sizeof(outConfig.localAdminPinHash), storedHash);
        }
    }

    return true;
}

bool ConfigManager::validateRuntimeConfig(const FloodGuardRuntimeConfig& cfg, String& reason) {
    if (cfg.alertLevelMm == 0) {
        reason = "alert_level_mm must be greater than 0";
        return false;
    }
    if (cfg.dangerLevelMm <= cfg.alertLevelMm) {
        reason = "danger_level_mm must be greater than alert_level_mm";
        return false;
    }
    if (cfg.clearLevelMm >= cfg.dangerLevelMm) {
        reason = "clear_level_mm must be lower than danger_level_mm";
        return false;
    }
    if (cfg.triggerDelaySeconds < 10 || cfg.triggerDelaySeconds > 600) {
        reason = "trigger_delay_seconds must be between 10 and 600";
        return false;
    }
    if (cfg.clearDelaySeconds < 30 || cfg.clearDelaySeconds > 1800) {
        reason = "clear_delay_seconds must be between 30 and 1800";
        return false;
    }
    if (!cfg.rs485SensorEnabled && !cfg.switchSensorEnabled) {
        reason = "At least one sensor input must be enabled";
        return false;
    }
    if (cfg.sensorMountHeightMm <= cfg.dangerLevelMm) {
        reason = "sensor_mount_height_mm must be greater than danger_level_mm";
        return false;
    }
    if (cfg.deviceId[0] == '\0') {
        reason = "device_id is required";
        return false;
    }
    if (cfg.locationId[0] == '\0') {
        reason = "location_id is required";
        return false;
    }
    if (cfg.localAdminPinHash[0] == '\0') {
        reason = "local admin pin hash is missing";
        return false;
    }
    return true;
}
