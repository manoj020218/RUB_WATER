#include <Arduino.h>
#include <WiFi.h>
#include <NimBLEDevice.h>
#include "esp_pm.h"
#include "esp_task_wdt.h"
#include "config.h"
#include "storage.h"
#include "sensor.h"
#include "relay.h"
#include "led.h"
#include "http_server.h"

static DeviceConfig g_cfg;
static AppState     g_state = {};

// Build "FgSensXXXXXX" from last 3 bytes of WiFi MAC
static void build_device_name(char *name, size_t maxlen) {
    uint8_t mac[6];
    WiFi.macAddress(mac);
    snprintf(name, maxlen, "FgSens%02X%02X%02X", mac[3], mac[4], mac[5]);
}

void setup() {
    Serial.begin(115200);
    delay(500);

    // Startup blink: 3 fast flashes confirm firmware is running
    pinMode(STATUS_LED_PIN, OUTPUT);
    for (int i = 0; i < 3; i++) {
        digitalWrite(STATUS_LED_PIN, HIGH); delay(120);
        digitalWrite(STATUS_LED_PIN, LOW);  delay(120);
    }

    // BOOT button (GPIO9, active-LOW):
    //   hold < 10 s at power-up → force SSID visible this session
    //   hold ≥ 10 s at power-up → factory reset (clear NVS, restart)
    pinMode(9, INPUT_PULLUP);
    delay(100);
    bool boot_held = false;
    if (digitalRead(9) == LOW) {
        boot_held = true;
        uint32_t hold_start = millis();
        while (digitalRead(9) == LOW) {
            uint32_t held_ms = millis() - hold_start;
            if (held_ms >= 10000) {
                Serial.println("[setup] BOOT held 10 s — factory reset, clearing NVS");
                storage_clear();
                delay(200);
                ESP.restart();
            }
            // Blink: slow (500 ms) for first 3 s, fast (150 ms) after to signal reset imminent
            uint32_t period = (held_ms < 3000) ? 500 : 150;
            digitalWrite(STATUS_LED_PIN, (held_ms / period) % 2);
            delay(50);
        }
    }

    // ── Thermal: CPU frequency + automatic light sleep ────────────────────────
    // CPU halved from 160→80 MHz; idles down to 40 MHz when quiet.
    // Light sleep halts the CPU during every delay() call (wakes in <1 ms on
    // interrupt). WiFi hardware keeps running independently — AP beacon, HTTP,
    // and relay GPIO are unaffected. Sensor UART FIFO buffers between reads.
    setCpuFrequencyMhz(80);
    esp_pm_config_esp32c3_t pm_cfg = {
        .max_freq_mhz      = 80,
        .min_freq_mhz      = 40,
        .light_sleep_enable = true
    };
    esp_pm_configure(&pm_cfg);

    // WiFi AP must be started before reading MAC address
    WiFi.mode(WIFI_AP);

    storage_init();
    storage_load(g_cfg);
    build_device_name(g_cfg.device_name, sizeof(g_cfg.device_name));

    uint8_t hidden = (boot_held ? 0 : g_cfg.ssid_hidden);
    if (boot_held) Serial.println("[WiFi] BOOT held — forcing SSID visible this session");

    // Open network — auth is on the HTTP login page; hide SSID via web UI after install
    bool apOk = WiFi.softAP(g_cfg.device_name, "", AP_CHANNEL, hidden, AP_MAX_CONNECTIONS);
    // ── Thermal: TX power 11→8.5 dBm ─────────────────────────────────────────
    // Device operates <5 m from the phone. 8.5 dBm (~7 mW) is ample; saves
    // ~40% RF transmit power vs the previous 11 dBm setting.
    WiFi.setTxPower(WIFI_POWER_8_5dBm);
    Serial.printf("[WiFi] softAP '%s' %s  hidden=%d  IP: %s\n",
        g_cfg.device_name,
        apOk ? "OK" : "FAILED",
        hidden,
        WiFi.softAPIP().toString().c_str());

    sensor_init();
    relay_init();
    led_init();
    webserver_init(&g_cfg, &g_state);

    // Hardware watchdog: reset device if loop() hangs for >30 s
    esp_task_wdt_init(30, true);
    esp_task_wdt_add(NULL);

    // BLE — advertise device identity (name only, no services needed)
    NimBLEDevice::init(std::string(g_cfg.device_name));
    NimBLEAdvertising *pAdv = NimBLEDevice::getAdvertising();
    pAdv->setName(g_cfg.device_name);
    pAdv->setScanResponse(false);
    pAdv->start();

    Serial.printf("[FgSens] v%s (%s)  Ready.  Level1=%umm  Level2=%umm  Zero=%umm\n",
        FIRMWARE_VERSION, FIRMWARE_DATE,
        g_cfg.level1_threshold_mm, g_cfg.level2_threshold_mm, g_cfg.zero_distance_mm);
}

void loop() {
    esp_task_wdt_reset();

    // Rate-limited sensor read — interval configurable from web UI
    static uint32_t g_last_sensor_ms = 0;
    uint32_t        now              = millis();
    if (now - g_last_sensor_ms >= g_cfg.sensor_interval_ms) {
        g_last_sensor_ms = now;
        sensor_update();
    }

    uint32_t raw      = sensor_get_distance_mm();
    bool     sens_ok  = (sensor_get_status() == SENSOR_OK);

    // water_level_mm = zero_distance - raw (clamped to 0)
    uint32_t water = 0;
    if (sens_ok && g_cfg.zero_distance_mm > raw) {
        water = g_cfg.zero_distance_mm - raw;
    }

    relay_update(water,
                 g_cfg.level1_threshold_mm,
                 g_cfg.level2_threshold_mm,
                 g_cfg.trigger_delay_s,
                 g_cfg.clear_delay_s,
                 sens_ok);

    bool r1 = relay_get_state(1);
    bool r2 = relay_get_state(2);

    // Update shared state for webserver
    g_state.raw_distance_mm = raw;
    g_state.water_level_mm  = water;
    g_state.relay1          = r1;
    g_state.relay2          = r2;
    g_state.sensor_ok       = sens_ok;
    g_state.uptime_s        = millis() / 1000UL;

    led_update(r1, r2);

    // ── Thermal: stop BLE after 5 min ────────────────────────────────────────
    // BLE advertising is only needed at install time so the technician can
    // identify the device name via a BLE scanner. After 5 minutes nobody
    // needs it and the radio stays quiet. Web UI and relays are unaffected.
    static bool g_ble_stopped = false;
    if (!g_ble_stopped && millis() >= BLE_ADV_TIMEOUT_MS) {
        NimBLEDevice::getAdvertising()->stop();
        g_ble_stopped = true;
        Serial.println("[BLE] Advertising stopped (5 min timeout)");
    }

    // ─── WiFi idle sleep / BOOT wake ─────────────────────────────────────────
    static bool     g_wifi_sleeping = false;
    static uint32_t g_boot_held_ms  = 0;

    if (!g_wifi_sleeping) {
        webserver_handle();
        if (webserver_wifi_should_sleep()) {
            Serial.println("[WiFi] Idle timeout — WiFi off. Hold BOOT 3 s to wake.");
            WiFi.mode(WIFI_OFF);
            g_wifi_sleeping = true;
        }
    } else {
        if (digitalRead(9) == LOW) {
            if (g_boot_held_ms == 0) g_boot_held_ms = millis();
            else if (millis() - g_boot_held_ms >= WIFI_WAKE_HOLD_MS) {
                Serial.println("[WiFi] BOOT held — restarting to wake WiFi");
                delay(200);
                ESP.restart();
            }
        } else {
            g_boot_held_ms = 0;
        }
    }

    // ── Thermal: loop delay ───────────────────────────────────────────────────
    // 50 ms awake (was 10 ms): runs at 20 Hz instead of 100 Hz — relay timer
    // accuracy ±50 ms on a 60 s trigger delay = 0.08% error, negligible.
    // 200 ms when WiFi sleeping: only checking BOOT button, nothing time-critical.
    // Combined with light sleep, the CPU is active <5% of the time at idle.
    delay(g_wifi_sleeping ? 200 : 50);
}
