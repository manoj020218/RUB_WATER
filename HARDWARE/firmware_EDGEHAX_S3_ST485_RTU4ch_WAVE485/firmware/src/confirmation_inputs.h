#pragma once

#include <Arduino.h>

struct ConfirmationSnapshot {
    bool level1Active;
    bool level2Active;
};

class ConfirmationInputs {
public:
    static ConfirmationInputs& getInstance();

    void begin();
    void loop();
    const ConfirmationSnapshot& snapshot() const { return _snap; }

private:
    ConfirmationInputs() = default;
    ConfirmationSnapshot _snap{};

    // Debounce state
    bool     _l1Raw = false, _l2Raw = false;
    uint32_t _l1StableMs = 0, _l2StableMs = 0;
    bool     _l1Debounced = false, _l2Debounced = false;
};
