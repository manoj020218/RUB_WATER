#include "config_manager.h"

#include <cstring>

#include "device_profile.h"

ConfigManager& ConfigManager::getInstance() {
    static ConfigManager instance;
    return instance;
}

void ConfigManager::begin() {
    loadDefaults();
}

const DeviceConfig& ConfigManager::getConfig() const {
    return _config;
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
    std::strncpy(_config.firmwareVersion, DeviceProfile::FIRMWARE_VERSION, sizeof(_config.firmwareVersion) - 1);

    _config.thresholds.sensorMountHeightMm = 1200;
    _config.thresholds.alertLevelMm = 300;
    _config.thresholds.dangerLevelMm = 500;
    _config.thresholds.dangerClearLevelMm = 450;
    _config.thresholds.triggerConfirmMs = 60000;
    _config.thresholds.clearConfirmMs = 300000;

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
