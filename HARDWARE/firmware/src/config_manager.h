#pragma once

#include <Arduino.h>

enum class AlarmState : uint8_t {
    NORMAL = 0,
    ALERT_PENDING_VERIFICATION,
    ALERT_ORANGE,
    ALERT_ORANGE_CONFIRMED,
    ALERT_SENSOR_MISMATCH,
    DANGER_PENDING,
    DANGER_CONFIRMED,
    DANGER_WITH_SENSOR_MISMATCH,
    DANGER_WITH_RS485_FAULT,
    ALERT_WITH_RS485_FAULT,
    CLEAR_PENDING,
    SENSOR_FAULT,
    OFFLINE_LOCAL_MODE
};

struct FloodGuardRuntimeConfig {
    uint16_t alertLevelMm;
    uint16_t dangerLevelMm;
    uint16_t clearLevelMm;
    uint16_t triggerDelaySeconds;
    uint16_t clearDelaySeconds;

    bool rs485SensorEnabled;
    bool switchSensorEnabled;

    uint16_t switchLevel1Mm;
    uint16_t switchLevel2Mm;

    uint16_t sensorMountHeightMm;
    uint16_t mismatchDurationSeconds;

    char deviceId[40];
    char locationId[40];
    char localAdminPinHash[24];

    uint32_t configVersion;
    uint32_t lastSavedEpoch;
};

struct ReportingProfile {
    uint32_t dryIntervalMs;
    uint32_t waterDetectedIntervalMs;
    uint32_t alertIntervalMs;
    uint32_t rapidIntervalMs;
    uint32_t dangerIntervalMs;
};

struct RouterDiagnosticsConfig {
    bool enableRouterAutoReboot;
    uint32_t internetDownRebootAfterMs;
};

struct GpioConfig {
    int rs485RxPin;
    int rs485TxPin;
    int rs485DeRePin;

    int switch300Pin;
    int switch500Pin;

    int relaySirenPin;
    int relayBeaconPin;
    int relayVoicePin;
    int relayBarrierPin;
    int relaySparePin;

    int sim800TxPin;
    int sim800RxPin;

    int rfTriggerEntryPin;
    int rfTriggerExitPin;
};

struct DeviceConfig {
    char productPid[32];
    char hardwareCode[32];
    char deviceId[32];
    char locationId[32];
    char wifiSsid[64];
    char wifiPass[64];
    char mqttHost[128];
    uint16_t mqttPort;
    char mqttUser[64];
    char mqttPass[64];
    char httpBaseUrl[128];
    char otaBaseUrl[128];
    char otaManifestPath[64];
    char otaChannel[24];
    uint32_t otaCheckIntervalMs;
    char firmwareVersion[32];
    ReportingProfile reporting;
    RouterDiagnosticsConfig diagnostics;
    GpioConfig gpio;
};

struct ConfigChangeNotice {
    bool pending;
    bool localSource;
    uint32_t configVersion;
    char source[32];
};

class ConfigManager {
public:
    static ConfigManager& getInstance();

    void begin();
    const DeviceConfig& getConfig() const;
    const FloodGuardRuntimeConfig& getRuntimeConfig() const;
    bool applyRuntimeConfigFromJson(const char* payload, String& reason, const char* source = "mqtt");
    bool applyRuntimeConfig(const FloodGuardRuntimeConfig& nextConfig, String& reason, const char* source = "mqtt");
    bool setLocalAdminPin(const String& pin, String& reason);
    bool verifyLocalPin(const String& pin) const;
    bool consumeChangeNotice(ConfigChangeNotice& notice);
    bool buildRuntimeConfigJson(char* out, size_t outSize) const;
    static const char* localAdminPinHint();

private:
    ConfigManager() = default;
    DeviceConfig _config{};
    FloodGuardRuntimeConfig _runtimeConfig{};
    ConfigChangeNotice _changeNotice{};

    void loadDefaults();
    void loadRuntimeDefaults();
    bool loadRuntimeConfigFromNvs();
    bool persistRuntimeConfigToNvs();
    void syncRuntimeIdentifiers();
    static void copyCString(char* dest, size_t destSize, const char* src);
    static String hashPin(const String& pin);
    static bool parseRuntimeConfigJson(const char* payload, const FloodGuardRuntimeConfig& base, FloodGuardRuntimeConfig& outConfig, String& reason);
    static bool validateRuntimeConfig(const FloodGuardRuntimeConfig& cfg, String& reason);
};
