#pragma once
#include <Arduino.h>

void relay_init();
void relay_update(uint32_t water_level_mm,
                  uint32_t level1_mm, uint32_t level2_mm,
                  uint32_t trigger_delay_s, uint32_t clear_delay_s,
                  bool sensor_ok);
bool relay_get_state(int relay);  // relay = 1 or 2
