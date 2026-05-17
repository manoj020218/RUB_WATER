#pragma once

#include <Arduino.h>

namespace DeviceProfile {
inline constexpr char PRODUCT_PID[] = "FLOODGUARD-S3-01";
inline constexpr char HARDWARE_CODE[] = "BA-S3-DA4";
inline constexpr char FIRMWARE_VERSION[] = "0.2.0-dev";

inline constexpr char DEFAULT_DEVICE_ID[] = "RUB043-CTRL01";
inline constexpr char DEFAULT_LOCATION_ID[] = "RUB043";

inline constexpr char DEFAULT_WIFI_SSID[] = "CHANGE_WIFI_SSID";
inline constexpr char DEFAULT_WIFI_PASS[] = "CHANGE_WIFI_PASSWORD";
inline constexpr char DEFAULT_MQTT_HOST[] = "FGServer.jenix.in";
inline constexpr uint16_t DEFAULT_MQTT_PORT = 1883;
inline constexpr char DEFAULT_MQTT_USER[] = "floodguard_device";
inline constexpr char DEFAULT_MQTT_PASS[] = "change_me";
inline constexpr char DEFAULT_HTTP_BASE_URL[] = "http://FGServer.jenix.in";

inline constexpr int RS485_RX_PIN = 16;
inline constexpr int RS485_TX_PIN = 17;
inline constexpr int RS485_DERE_PIN = 18;

inline constexpr int SWITCH_300_PIN = 4;
inline constexpr int SWITCH_500_PIN = 5;

inline constexpr int RELAY_SIREN_PIN = 6;
inline constexpr int RELAY_BEACON_PIN = 7;
inline constexpr int RELAY_VOICE_PIN = 8;
inline constexpr int RELAY_BARRIER_PIN = 9;
inline constexpr int RELAY_SPARE_PIN = 10;

inline constexpr int SIM800_TX_PIN = 11;
inline constexpr int SIM800_RX_PIN = 12;

inline constexpr int RF_TRIGGER_ENTRY_PIN = 13;
inline constexpr int RF_TRIGGER_EXIT_PIN = 14;

inline constexpr uint8_t RELAY_ON_LEVEL = LOW;
inline constexpr uint8_t RELAY_OFF_LEVEL = HIGH;
inline constexpr uint8_t RF_ACTIVE_LEVEL = LOW;
inline constexpr uint8_t RF_IDLE_LEVEL = HIGH;

inline constexpr uint32_t WIFI_RETRY_INTERVAL_MS = 10000UL;
}  // namespace DeviceProfile
