#pragma once

#include <Arduino.h>

struct SwitchSnapshot {
    bool switch300Closed;
    bool switch500Closed;
    bool enabled;
};

class SwitchInputs {
public:
    static SwitchInputs& getInstance();
    void begin(int switch300Pin, int switch500Pin, bool enabled);
    void loop();
    void setEnabled(bool enabled);
    const SwitchSnapshot& getSnapshot() const;

private:
    SwitchInputs() = default;
    int _pin300 = -1;
    int _pin500 = -1;
    bool _enabled = true;
    SwitchSnapshot _snapshot{};
    bool readStable(int pin, bool previousValue);
};
