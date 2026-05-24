#include "relay.h"
#include "config.h"

static void setPin(uint8_t pin, bool active) {
    // RELAY_ACTIVE_LOW = 1: relay energises on LOW
    digitalWrite(pin, (RELAY_ACTIVE_LOW ? !active : active) ? HIGH : LOW);
}

struct RelayFSM {
    enum State : uint8_t { OFF, ARMING, ON, CLEARING } state;
    uint32_t timer_ms;
    bool     output;
};

static RelayFSM r1 = {RelayFSM::OFF, 0, false};
static RelayFSM r2 = {RelayFSM::OFF, 0, false};

static void tick(RelayFSM &r, uint8_t pin,
                 uint32_t water_mm, uint32_t thresh_mm, uint32_t hyst_mm,
                 uint32_t trig_s, uint32_t clr_s)
{
    uint32_t now = millis();
    uint32_t clear_thresh = (thresh_mm > hyst_mm) ? (thresh_mm - hyst_mm) : 0;

    switch (r.state) {
        case RelayFSM::OFF:
            if (water_mm >= thresh_mm) {
                r.state    = RelayFSM::ARMING;
                r.timer_ms = now;
            }
            break;

        case RelayFSM::ARMING:
            if (water_mm < thresh_mm) {
                r.state = RelayFSM::OFF;
            } else if ((now - r.timer_ms) >= trig_s * 1000UL) {
                r.state  = RelayFSM::ON;
                r.output = true;
                setPin(pin, true);
            }
            break;

        case RelayFSM::ON:
            if (water_mm < clear_thresh) {
                r.state    = RelayFSM::CLEARING;
                r.timer_ms = now;
            }
            break;

        case RelayFSM::CLEARING:
            if (water_mm >= clear_thresh) {
                r.state = RelayFSM::ON;   // level rose again — cancel clear
            } else if ((now - r.timer_ms) >= clr_s * 1000UL) {
                r.state  = RelayFSM::OFF;
                r.output = false;
                setPin(pin, false);
            }
            break;
    }
}

void relay_init() {
    pinMode(RELAY_LEVEL1_PIN, OUTPUT);
    pinMode(RELAY_LEVEL2_PIN, OUTPUT);
    setPin(RELAY_LEVEL1_PIN, false);
    setPin(RELAY_LEVEL2_PIN, false);
}

void relay_update(uint32_t water_level_mm,
                  uint32_t level1_mm, uint32_t level2_mm,
                  uint32_t trigger_delay_s, uint32_t clear_delay_s,
                  bool sensor_ok)
{
    if (!sensor_ok) return;  // freeze relay state on sensor fault

    tick(r1, RELAY_LEVEL1_PIN,
         water_level_mm, level1_mm, RELAY1_HYSTERESIS_MM,
         trigger_delay_s, clear_delay_s);

    tick(r2, RELAY_LEVEL2_PIN,
         water_level_mm, level2_mm, RELAY2_HYSTERESIS_MM,
         trigger_delay_s, clear_delay_s);
}

bool relay_get_state(int relay) {
    return (relay == 1) ? r1.output : r2.output;
}
