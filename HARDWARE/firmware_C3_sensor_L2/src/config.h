#pragma once

// ─── Pin Mapping ─────────────────────────────────────────────────────────────
#define SENSOR_UART_RX_PIN     20
#define SENSOR_UART_TX_PIN     21
#define RELAY_LEVEL1_PIN        4
#define RELAY_LEVEL2_PIN        5
#define STATUS_LED_PIN          8   // ESP32-C3 onboard blue LED

// ─── Relay Output Logic ───────────────────────────────────────────────────────
// 1 = relay board is active-LOW (most common); 0 = active-HIGH
#define RELAY_ACTIVE_LOW        1

// ─── LED ─────────────────────────────────────────────────────────────────────
#define CONFIG_SAVED_DURATION_MS  30000UL
#define FAST_BLINK_PERIOD_MS       100UL
#define SLOW_BLINK_PERIOD_MS      1000UL

// ─── Sensor UART ─────────────────────────────────────────────────────────────
#define SENSOR_BAUD_RATE        9600
#define SENSOR_MIN_MM            280
#define SENSOR_MAX_MM           2500
#define SENSOR_FILTER_SAMPLES      5
#define SENSOR_FAULT_TIMEOUT_S    30    // declare FAULT after this many seconds of no valid reading

// ─── Relay Hysteresis ────────────────────────────────────────────────────────
#define RELAY1_HYSTERESIS_MM      30
#define RELAY2_HYSTERESIS_MM      50

// ─── Firmware Identity ────────────────────────────────────────────────────────
#define FIRMWARE_VERSION        "1.4.0"
#define FIRMWARE_DATE           "2026-06-23"

// ─── WiFi AP ─────────────────────────────────────────────────────────────────
#define AP_CHANNEL               6
#define AP_MAX_CONNECTIONS       4

// ─── Thermal Management ───────────────────────────────────────────────────────
// BLE advertises only at install time so the installer can identify the device.
// After this timeout the radio goes quiet — no functional impact once installed.
#define BLE_ADV_TIMEOUT_MS      (5UL * 60 * 1000)  // stop BLE after 5 min

// ─── HTTP ────────────────────────────────────────────────────────────────────
#define HTTP_PORT                80
#define SESSION_TIMEOUT_MS       (30UL * 60 * 1000)   // 30 min
#define WIFI_IDLE_TIMEOUT_MS     (30UL * 60 * 1000)   // WiFi off after 30 min of no HTTP activity
#define WIFI_WAKE_HOLD_MS        3000UL               // hold BOOT this long to wake WiFi via restart

// ─── Defaults ────────────────────────────────────────────────────────────────
#define DEFAULT_LEVEL1_MM       200
#define DEFAULT_LEVEL2_MM       400
#define DEFAULT_TRIGGER_DELAY_S  60
#define DEFAULT_CLEAR_DELAY_S   300
#define DEFAULT_ZERO_MM        1200
#define DEFAULT_SENSOR_INTERVAL_MS 1000   // ms between ultrasonic reads (100–180000)
#define DEFAULT_PASSWORD        "Hanuman#2026"
#define NVS_NAMESPACE           "fgsens"
#define CONFIG_VERSION           2
