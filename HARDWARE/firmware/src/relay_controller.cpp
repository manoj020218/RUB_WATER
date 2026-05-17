#include "relay_controller.h"

#include <cstring>

#include "device_profile.h"

RelayController& RelayController::getInstance() {
    static RelayController instance;
    return instance;
}

void RelayController::begin(const GpioConfig& gpio) {
    _gpio = gpio;
    std::memset(&_snapshot, 0, sizeof(_snapshot));

    pinMode(_gpio.relaySirenPin, OUTPUT);
    pinMode(_gpio.relayBeaconPin, OUTPUT);
    pinMode(_gpio.relayVoicePin, OUTPUT);
    pinMode(_gpio.relayBarrierPin, OUTPUT);
    pinMode(_gpio.relaySparePin, OUTPUT);
    pinMode(_gpio.rfTriggerEntryPin, OUTPUT);
    pinMode(_gpio.rfTriggerExitPin, OUTPUT);

    forceAllOff();
}

void RelayController::setMuted(bool muted) {
    _muted = muted;
}

void RelayController::loop(AlarmState state) {
    const unsigned long now = millis();
    const bool dangerActive = (state == AlarmState::DANGER || state == AlarmState::MUTED_DANGER);

    if (!dangerActive) {
        _sirenCycleStartMs = now;
        _voiceCycleStartMs = now;
        forceAllOff();
        return;
    }

    _snapshot.beacon = true;
    setRelayPin(_gpio.relayBeaconPin, true);

    _snapshot.rfEntryActive = true;
    _snapshot.rfExitActive = true;
    digitalWrite(_gpio.rfTriggerEntryPin, DeviceProfile::RF_ACTIVE_LEVEL);
    digitalWrite(_gpio.rfTriggerExitPin, DeviceProfile::RF_ACTIVE_LEVEL);

    if (_muted || state == AlarmState::MUTED_DANGER) {
        _snapshot.siren = false;
        _snapshot.voice = false;
        setRelayPin(_gpio.relaySirenPin, false);
        setRelayPin(_gpio.relayVoicePin, false);
        return;
    }

    const uint32_t sirenPhaseMs = static_cast<uint32_t>((now - _sirenCycleStartMs) % 30000UL);
    _snapshot.siren = (sirenPhaseMs < 10000UL);
    setRelayPin(_gpio.relaySirenPin, _snapshot.siren);

    const uint32_t voicePhaseMs = static_cast<uint32_t>((now - _voiceCycleStartMs) % 30000UL);
    _snapshot.voice = (voicePhaseMs < 1200UL);
    setRelayPin(_gpio.relayVoicePin, _snapshot.voice);
}

void RelayController::forceAllOff() {
    _snapshot.siren = false;
    _snapshot.beacon = false;
    _snapshot.voice = false;
    _snapshot.barrier = false;
    _snapshot.spare = false;
    _snapshot.rfEntryActive = false;
    _snapshot.rfExitActive = false;

    setRelayPin(_gpio.relaySirenPin, false);
    setRelayPin(_gpio.relayBeaconPin, false);
    setRelayPin(_gpio.relayVoicePin, false);
    setRelayPin(_gpio.relayBarrierPin, false);
    setRelayPin(_gpio.relaySparePin, false);
    digitalWrite(_gpio.rfTriggerEntryPin, DeviceProfile::RF_IDLE_LEVEL);
    digitalWrite(_gpio.rfTriggerExitPin, DeviceProfile::RF_IDLE_LEVEL);
}

const RelaySnapshot& RelayController::getSnapshot() const {
    return _snapshot;
}

void RelayController::setRelayPin(int pin, bool on) {
    digitalWrite(pin, on ? DeviceProfile::RELAY_ON_LEVEL : DeviceProfile::RELAY_OFF_LEVEL);
}
