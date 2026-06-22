#include "output_controller.h"

#include "device_profile.h"

OutputController& OutputController::getInstance() {
    static OutputController inst;
    return inst;
}

void OutputController::begin() {
    const int relays[] = { PIN_RELAY_SIREN, PIN_RELAY_FLASH, PIN_RELAY_VOICE_FUTURE };
    for (int p : relays) {
        pinMode(p, OUTPUT);
        digitalWrite(p, RELAY_OFF_LEVEL);
    }
    _snap = {};
    Serial.println("[OUT] All relays and RF outputs initialised OFF");
}

void OutputController::safeOff() {
    setSiren(false);
    setFlash(false);
    setVoiceFuture(false);
}

void OutputController::setSiren(bool on) {
    writeRelay(PIN_RELAY_SIREN, on);
    _snap.sirenOn = on;
}

void OutputController::setFlash(bool on) {
    writeRelay(PIN_RELAY_FLASH, on);
    _snap.flashOn = on;
}

void OutputController::setVoiceFuture(bool on) {
    writeRelay(PIN_RELAY_VOICE_FUTURE, on);
    _snap.voiceFutureOn = on;
}

void OutputController::writeRelay(int pin, bool on) {
    digitalWrite(pin, on ? RELAY_ON_LEVEL : RELAY_OFF_LEVEL);
}
