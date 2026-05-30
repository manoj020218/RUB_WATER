#pragma once

#include <Arduino.h>

namespace DeviceProfile {
static const char PRODUCT_PID[] = "FLOODGUARD-S3-01";
static const char HARDWARE_CODE[] = "BA-S3-DA4";
static const char FIRMWARE_VERSION[] = "0.2.0-dev";

static const char DEFAULT_DEVICE_ID[] = "RUB043-CTRL01";
static const char DEFAULT_LOCATION_ID[] = "RUB043";

static const char DEFAULT_WIFI_SSID[] = "CHANGE_WIFI_SSID";
static const char DEFAULT_WIFI_PASS[] = "CHANGE_WIFI_PASSWORD";
static const char DEFAULT_MQTT_HOST[] = "api.floodguard.iotsoft.in";
static const uint16_t DEFAULT_MQTT_PORT = 1883;
// Empty user = mqtt_client.cpp will use deviceId as username, which matches the
// Mosquitto ACL (user RUB043-CTRL01 → rub/RUB043-CTRL01/#). Do NOT set a
// placeholder user here or the fallback in loadPersistedConnection won't fire.
static const char DEFAULT_MQTT_USER[] = "";
static const char DEFAULT_MQTT_PASS[] = "change_me";
static const char DEFAULT_HTTP_BASE_URL[] = "http://api.floodguard.iotsoft.in";
static const char DEFAULT_OTA_BASE_URL[] = "http://flash.iotsoft.in";
static const char DEFAULT_OTA_MANIFEST_PATH[] = "/api/ota/check";
static const char DEFAULT_OTA_CHANNEL[] = "stable";
static const uint32_t DEFAULT_OTA_CHECK_INTERVAL_MS = 86400000UL;

static const int RS485_RX_PIN = 21;
static const int RS485_TX_PIN = -1;  // TX not wired; DYP-A01 is receive-only
static const int RS485_DERE_PIN = -1;  // auto-flow module, no DE/RE pin

static const int SWITCH_300_PIN = 4;
static const int SWITCH_500_PIN = 5;

static const int RELAY_SIREN_PIN = 6;
static const int RELAY_BEACON_PIN = 7;
static const int RELAY_VOICE_PIN = 8;
static const int RELAY_BARRIER_PIN = 9;
static const int RELAY_SPARE_PIN = -1;   // not populated on this board

static const int SIM800_TX_PIN = 11;
static const int SIM800_RX_PIN = 12;

static const int RF_TRIGGER_ENTRY_PIN = 13;
static const int RF_TRIGGER_EXIT_PIN = 14;

// ADC module output pin for 12V battery/supply sensing.
// Update these constants to match field wiring/module ratio.
static const int BATTERY_ADC_PIN = 10;
static constexpr float BATTERY_ADC_DIVIDER_RATIO = 5.0f;   // Vin ~= Vadc * ratio
static constexpr float BATTERY_ADC_CALIBRATION = 1.0f;     // Fine tune after multimeter comparison
static const uint8_t BATTERY_ADC_SAMPLES = 12;

static const uint8_t RELAY_ON_LEVEL = LOW;
static const uint8_t RELAY_OFF_LEVEL = HIGH;
static const uint8_t RF_ACTIVE_LEVEL = LOW;
static const uint8_t RF_IDLE_LEVEL = HIGH;

static const uint32_t WIFI_RETRY_INTERVAL_MS = 10000UL;
}  // namespace DeviceProfile
