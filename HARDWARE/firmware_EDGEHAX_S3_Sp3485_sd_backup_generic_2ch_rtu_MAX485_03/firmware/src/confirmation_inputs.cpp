#include "confirmation_inputs.h"

#include "device_profile.h"

namespace {
constexpr uint32_t kDebounceMs = 50UL;
}

ConfirmationInputs& ConfirmationInputs::getInstance() {
    static ConfirmationInputs inst;
    return inst;
}

void ConfirmationInputs::begin() {
    pinMode(PIN_CONFIRM_LEVEL1, INPUT_PULLUP);
    pinMode(PIN_CONFIRM_LEVEL2, INPUT_PULLUP);
    _l1StableMs = millis();
    _l2StableMs = millis();
    Serial.printf("[CONF] L1=GPIO%d L2=GPIO%d debounce=%ums\n",
                  PIN_CONFIRM_LEVEL1, PIN_CONFIRM_LEVEL2, (unsigned)kDebounceMs);
}

void ConfirmationInputs::loop() {
    const uint32_t now = millis();
    const bool l1 = (digitalRead(PIN_CONFIRM_LEVEL1) == LOW);
    const bool l2 = (digitalRead(PIN_CONFIRM_LEVEL2) == LOW);

    if (l1 != _l1Raw) { _l1Raw = l1; _l1StableMs = now; }
    if (l2 != _l2Raw) { _l2Raw = l2; _l2StableMs = now; }

    if ((now - _l1StableMs) >= kDebounceMs) _l1Debounced = _l1Raw;
    if ((now - _l2StableMs) >= kDebounceMs) _l2Debounced = _l2Raw;

    _snap.level1Active = _l1Debounced;
    _snap.level2Active = _l2Debounced;
}
