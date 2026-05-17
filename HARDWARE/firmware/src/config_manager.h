#pragma once

#include <Arduino.h>

enum class AlarmState : uint8_t {
    NORMAL = 0,
    WATER_DETECTED,
    ALERT_PENDING,
    ALERT,
    DANGER_PENDING,
    DANGER,
    MUTED_DANGER,
    CLEAR_PENDING,
    SENSOR_FAULT,
    OFFLINE_LOCAL_MODE
};

struct ThresholdConfig {
    int32_t sensorMountHeightMm;
    int32_t alertLevelMm;
    int32_t dangerLevelMm;
    int32_t dangerClearLevelMm;
    uint32_t triggerConfirmMs;
    uint32_t clearConfirmMs;
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
    char firmwareVersion[32];
    ThresholdConfig thresholds;
    ReportingProfile reporting;
    RouterDiagnosticsConfig diagnostics;
    GpioConfig gpio;
};

class ConfigManager {
public:
    static ConfigManager& getInstance();

    void begin();
    const DeviceConfig& getConfig() const;

private:
    ConfigManager() = default;
    DeviceConfig _config{};
    void loadDefaults();
};
