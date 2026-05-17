#include "switch_inputs.h"

SwitchInputs& SwitchInputs::getInstance() {
    static SwitchInputs instance;
    return instance;
}

void SwitchInputs::begin(int switch300Pin, int switch500Pin) {
    _pin300 = switch300Pin;
    _pin500 = switch500Pin;

    pinMode(_pin300, INPUT_PULLUP);
    pinMode(_pin500, INPUT_PULLUP);

    _snapshot.switch300Closed = false;
    _snapshot.switch500Closed = false;
}

void SwitchInputs::loop() {
    _snapshot.switch300Closed = readStable(_pin300, _snapshot.switch300Closed);
    _snapshot.switch500Closed = readStable(_pin500, _snapshot.switch500Closed);
}

const SwitchSnapshot& SwitchInputs::getSnapshot() const {
    return _snapshot;
}

bool SwitchInputs::readStable(int pin, bool previousValue) {
    // NO/COM switch with pull-up: LOW means closed.
    const bool s1 = digitalRead(pin) == LOW;
    delay(2);
    const bool s2 = digitalRead(pin) == LOW;
    return (s1 == s2) ? s1 : previousValue;
}

