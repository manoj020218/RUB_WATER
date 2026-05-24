#include <Arduino.h>
#include <WiFi.h>
#include <NimBLEDevice.h>
#include "config.h"
#include "storage.h"
#include "sensor.h"
#include "relay.h"
#include "led.h"
#include "webserver.h"

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
    Serial.println("\n[FgSens] Booting...");

    // WiFi AP must be up before reading MAC
    WiFi.mode(WIFI_AP);

    // Load persisted config, then fix device name from MAC (never stored in NVS)
    storage_init();
    storage_load(g_cfg);
    build_device_name(g_cfg.device_name, sizeof(g_cfg.device_name));

    WiFi.softAP(g_cfg.device_name, nullptr, AP_CHANNEL, 0, AP_MAX_CONNECTIONS);
    Serial.printf("[WiFi] AP SSID: %s  IP: %s\n", g_cfg.device_name, WiFi.softAPIP().toString().c_str());

    sensor_init();
    relay_init();
    led_init();
    webserver_init(&g_cfg, &g_state);

    // BLE — advertise device identity (name only, no services needed)
    NimBLEDevice::init(std::string(g_cfg.device_name));
    NimBLEAdvertising *pAdv = NimBLEDevice::getAdvertising();
    pAdv->setName(g_cfg.device_name);
    pAdv->setScanResponse(false);
    pAdv->start();
    Serial.printf("[BLE]  Advertising as: %s\n", g_cfg.device_name);

    Serial.printf("[FgSens] Ready.  Level1=%u mm  Level2=%u mm  Zero=%u mm\n",
        g_cfg.level1_threshold_mm,
        g_cfg.level2_threshold_mm,
        g_cfg.zero_distance_mm);
}

void loop() {
    sensor_update();

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
    webserver_handle();

    delay(10);
}
