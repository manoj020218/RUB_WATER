#include "output_controller.h"

#include "device_profile.h"

namespace {
bool relayPinAvailable(int pin) {
    return pin >= 0;
}
}

OutputController& OutputController::getInstance() {
    static OutputController inst;
    return inst;
}

void OutputController::begin() {
    const int relays[] = { PIN_RELAY_SIREN, PIN_RELAY_FLASH, PIN_RELAY_VOICE_FUTURE };
    bool anyRelayPresent = false;
    for (int p : relays) {
        if (!relayPinAvailable(p)) {
            continue;
        }
        anyRelayPresent = true;
        pinMode(p, OUTPUT);
        digitalWrite(p, RELAY_OFF_LEVEL);
    }
    _snap = {};
    if (anyRelayPresent) {
        Serial.println("[OUT] Local relay outputs initialised OFF");
    } else {
        Serial.println("[OUT] No local relay outputs fitted on this hardware profile");
    }
}

void OutputController::safeOff() {
    setSiren(false);
    setFlash(false);
    setVoiceFuture(false);
}

void OutputController::setAutoOutputs(bool sirenOn, bool flashOn, bool voiceOn) {
    if (autoControlSuspended()) {
        return;
    }
    setSiren(sirenOn);
    setFlash(flashOn);
    setVoiceFuture(voiceOn);
}

void OutputController::suspendAutoControl(uint32_t durationMs) {
    _manualHoldoffUntilMs = millis() + durationMs;
}

bool OutputController::autoControlSuspended() const {
    return _manualHoldoffUntilMs != 0 && (int32_t)(millis() - _manualHoldoffUntilMs) < 0;
}

void OutputController::setSiren(bool on) {
    writeRelay(PIN_RELAY_SIREN, on);
    _snap.sirenOn = relayPinAvailable(PIN_RELAY_SIREN) && on;
}

void OutputController::setFlash(bool on) {
    writeRelay(PIN_RELAY_FLASH, on);
    _snap.flashOn = relayPinAvailable(PIN_RELAY_FLASH) && on;
}

void OutputController::setVoiceFuture(bool on) {
    writeRelay(PIN_RELAY_VOICE_FUTURE, on);
    _snap.voiceFutureOn = relayPinAvailable(PIN_RELAY_VOICE_FUTURE) && on;
}

void OutputController::writeRelay(int pin, bool on) {
    if (!relayPinAvailable(pin)) {
        return;
    }
    digitalWrite(pin, on ? RELAY_ON_LEVEL : RELAY_OFF_LEVEL);
}
