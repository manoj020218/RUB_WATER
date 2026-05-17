#pragma once

#include <Arduino.h>

struct SwitchSnapshot {
    bool switch300Closed;
    bool switch500Closed;
};

class SwitchInputs {
public:
    static SwitchInputs& getInstance();
    void begin(int switch300Pin, int switch500Pin);
    void loop();
    const SwitchSnapshot& getSnapshot() const;

private:
    SwitchInputs() = default;
    int _pin300 = -1;
    int _pin500 = -1;
    SwitchSnapshot _snapshot{};
    bool readStable(int pin, bool previousValue);
};

