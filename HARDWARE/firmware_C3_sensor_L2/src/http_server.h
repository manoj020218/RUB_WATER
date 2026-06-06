#pragma once
#include <Arduino.h>
#include "storage.h"

struct AppState {
    uint32_t raw_distance_mm;
    uint32_t water_level_mm;
    bool     relay1;
    bool     relay2;
    bool     sensor_ok;
    uint32_t uptime_s;
};

void webserver_init(DeviceConfig *cfg, AppState *state);
void webserver_handle();
bool webserver_wifi_should_sleep();   // true when no HTTP activity for WIFI_IDLE_TIMEOUT_MS
uint32_t webserver_wifi_sleep_in_s(); // seconds until WiFi sleep (0 = already sleeping)
