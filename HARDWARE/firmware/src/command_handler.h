#pragma once

#include <Arduino.h>

class CommandHandler {
public:
    static CommandHandler& getInstance();

    void begin();
    void loop();
    bool onCommand(const char* command, const char* payload);
    bool isMuted() const;
    bool isDryRunActive() const;

private:
    CommandHandler() = default;
    bool _muted = false;
    bool _dryRunActive = false;
    unsigned long _dryRunUntilMs = 0;
};
