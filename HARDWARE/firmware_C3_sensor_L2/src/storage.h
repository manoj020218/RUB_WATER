#pragma once
#include <Arduino.h>

struct DeviceConfig {
    uint32_t zero_distance_mm;
    uint32_t level1_threshold_mm;
    uint32_t level2_threshold_mm;
    uint32_t trigger_delay_s;
    uint32_t clear_delay_s;
    char     device_name[16];
    uint32_t config_version;
    uint8_t  ssid_hidden;        // 1 = hidden AP, 0 = visible
    uint32_t sensor_interval_ms; // ms between ultrasonic reads (100–180000)
    char     password[32];       // login password, changeable via UI
    uint8_t  auto_restart_hours; // reboot every N hours (0 = disabled)
};

void storage_init();
void storage_load(DeviceConfig &cfg);
void storage_save(const DeviceConfig &cfg);
void storage_reset_defaults(DeviceConfig &cfg);
void storage_clear();
