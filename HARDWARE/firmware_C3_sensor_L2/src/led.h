#pragma once
#include <Arduino.h>

void led_init();
// Priority: relay2(fast) > relay1(slow) > config_saved(solid 30s) > off
void led_update(bool relay1, bool relay2);
// Call after saving config/zero — triggers 30s solid-on indicator
void led_signal_config_saved();
