#include "led.h"
#include "config.h"

static uint32_t config_saved_at = 0;   // 0 = not signalling
static uint32_t blink_timer     = 0;
static bool     blink_state     = false;

static void set_led(bool on) {
    digitalWrite(STATUS_LED_PIN, on ? HIGH : LOW);
}

void led_init() {
    pinMode(STATUS_LED_PIN, OUTPUT);
    set_led(false);
}

void led_signal_config_saved() {
    config_saved_at = millis();
    if (config_saved_at == 0) config_saved_at = 1;  // avoid 0 sentinel
    set_led(true);
}

void led_update(bool relay1, bool relay2) {
    uint32_t now = millis();

    if (relay2) {
        // Fast blink 100 ms — danger level active
        if ((now - blink_timer) >= FAST_BLINK_PERIOD_MS) {
            blink_state = !blink_state;
            blink_timer = now;
            set_led(blink_state);
        }
        config_saved_at = 0;
    } else if (relay1) {
        // Slow blink 1000 ms — alert level active
        if ((now - blink_timer) >= SLOW_BLINK_PERIOD_MS) {
            blink_state = !blink_state;
            blink_timer = now;
            set_led(blink_state);
        }
        config_saved_at = 0;
    } else if (config_saved_at != 0 &&
               (now - config_saved_at) < CONFIG_SAVED_DURATION_MS) {
        // Solid ON for 30 s after config/zero save
        set_led(true);
    } else {
        set_led(false);
        config_saved_at = 0;
    }
}
