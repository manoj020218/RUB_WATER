#include "status_led.h"

#include "device_profile.h"
#include "dyp_sensor.h"
#include "flood_state_machine.h"
#include "local_webserver.h"
#include "mqtt_manager.h"
#include "ota_manager.h"
#include "sd_fifo.h"
#include "wifi_manager.h"

StatusLed& StatusLed::getInstance() {
    static StatusLed inst;
    return inst;
}

void StatusLed::begin() {
    pinMode(PIN_LED_ORANGE, OUTPUT); setOrange(false);
    pinMode(PIN_LED_WHITE,  OUTPUT); setWhite(false);
    pinMode(PIN_LED_GREEN,  OUTPUT); setGreen(false);
    _phaseMs = millis();
    Serial.printf("[LED] Pins Orange=%d White=%d Green=%d ON_LEVEL=%s\n",
                  PIN_LED_ORANGE, PIN_LED_WHITE, PIN_LED_GREEN,
                  LED_ON_LEVEL == HIGH ? "HIGH" : "LOW");
}

void StatusLed::loop() {
    const uint32_t now = millis();
    if ((now - _lastUpdateMs) < 50UL) return;  // 20 Hz max update
    _lastUpdateMs = now;

    const uint32_t elapsed = now - _phaseMs;
    applyPattern(currentPriority());
    (void)elapsed;
}

LedPriority StatusLed::currentPriority() {
    if (MqttManager::getInstance().isConnected()) _mqttEverConnected = true;

    if (OtaManager::getInstance().isRunning())               return LedPriority::OTA;
    const FloodState fs = FloodStateMachine::getInstance().snapshot().state;
    if (isDanger(fs))                                        return LedPriority::DANGER;
    if (fs == FloodState::SENSOR_FAULT)                      return LedPriority::SENSOR_FAULT;
    if (isAlertOrDanger(fs))                                 return LedPriority::ALERT;
    if (LocalWebserver::getInstance().isApActive())          return LedPriority::AP_MAINTENANCE;
    if (!WifiManager::getInstance().isConnected())           return LedPriority::WIFI_DISCONNECTED;
    if (!SdFifo::getInstance().status().mounted)             return LedPriority::SD_WARNING;
    if (MqttManager::getInstance().isConnected())            return LedPriority::CLOUD_CONNECTED;
    if (!_mqttEverConnected)                                 return LedPriority::VPS_UNREACHABLE;
    return LedPriority::LOCAL_MODE;
}

void StatusLed::applyPattern(LedPriority prio) {
    const uint32_t now  = millis();
    const uint32_t age  = now - _phaseMs;

    // Helper: toggle phase at given period
    auto blinkPhase = [&](uint32_t periodMs) -> bool {
        if (age >= periodMs) { _phase = !_phase; _phaseMs = now; }
        return _phase;
    };

    allOff();
    switch (prio) {
    case LedPriority::OTA:
        // Green + White alternate, 300ms
        if (blinkPhase(300)) { setGreen(true); } else { setWhite(true); }
        break;
    case LedPriority::DANGER:
        // Orange fast blink 200ms
        setOrange(blinkPhase(200));
        break;
    case LedPriority::SENSOR_FAULT:
        // Orange strobe 100ms
        setOrange(blinkPhase(100));
        break;
    case LedPriority::ALERT:
        // Orange slow blink 800ms
        setOrange(blinkPhase(800));
        break;
    case LedPriority::AP_MAINTENANCE:
        // White + Orange alternate 1000ms
        if (blinkPhase(1000)) { setWhite(true); } else { setOrange(true); }
        break;
    case LedPriority::SD_WARNING:
        // White double blink every 5 sec — use age directly
        {
            const uint32_t cycle = age % 5000UL;
            if (cycle < 150 || (cycle >= 300 && cycle < 450)) setWhite(true);
        }
        break;
    case LedPriority::CLOUD_CONNECTED:
        // Green solid
        setGreen(true);
        break;
    case LedPriority::LOCAL_MODE:
        // Green slow pulse 1500ms
        setGreen(blinkPhase(1500));
        break;
    case LedPriority::WIFI_DISCONNECTED:
        // White slow blink 1000ms
        setWhite(blinkPhase(1000));
        break;
    case LedPriority::VPS_UNREACHABLE:
        // White fast blink 250ms — WiFi connected, VPS/MQTT unreachable
        setWhite(blinkPhase(250));
        break;
    default:
        // Boot: White breathing — simple slow blink
        setWhite(blinkPhase(500));
        break;
    }
}

void StatusLed::setOrange(bool on) { digitalWrite(PIN_LED_ORANGE, on ? LED_ON_LEVEL : LED_OFF_LEVEL); }
void StatusLed::setWhite(bool on)  { digitalWrite(PIN_LED_WHITE,  on ? LED_ON_LEVEL : LED_OFF_LEVEL); }
void StatusLed::setGreen(bool on)  { digitalWrite(PIN_LED_GREEN,  on ? LED_ON_LEVEL : LED_OFF_LEVEL); }
void StatusLed::allOff() { setOrange(false); setWhite(false); setGreen(false); }
