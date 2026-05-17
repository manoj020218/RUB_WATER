#include "command_handler.h"

#include <cstring>

#include "alarm_state_machine.h"
#include "relay_controller.h"

CommandHandler& CommandHandler::getInstance() {
    static CommandHandler instance;
    return instance;
}

void CommandHandler::begin() {
    _muted = false;
    _dryRunActive = false;
    _dryRunUntilMs = 0;
}

void CommandHandler::loop() {
    if (_dryRunActive && millis() > _dryRunUntilMs) {
        _dryRunActive = false;
    }
}

bool CommandHandler::onCommand(const char* command, const char* payload) {
    (void)payload;

    if (!command) {
        return false;
    }

    if (std::strcmp(command, "MUTE_ALARM") == 0 || std::strcmp(command, "mute_alarm") == 0) {
        _muted = true;
        AlarmStateMachine::getInstance().setMuted(true);
        RelayController::getInstance().setMuted(true);
        return true;
    }

    if (std::strcmp(command, "UNMUTE_ALARM") == 0 || std::strcmp(command, "unmute_alarm") == 0) {
        _muted = false;
        AlarmStateMachine::getInstance().clearMute();
        RelayController::getInstance().setMuted(false);
        return true;
    }

    if (std::strcmp(command, "DRY_RUN") == 0 || std::strcmp(command, "dry_run") == 0) {
        _dryRunActive = true;
        _dryRunUntilMs = millis() + 10000UL;
        return true;
    }

    if (std::strcmp(command, "FORCE_CLEAR") == 0 || std::strcmp(command, "force_clear") == 0) {
        _muted = false;
        _dryRunActive = false;
        AlarmStateMachine::getInstance().clearMute();
        RelayController::getInstance().setMuted(false);
        RelayController::getInstance().forceAllOff();
        return true;
    }
    return false;
}

bool CommandHandler::isMuted() const {
    return _muted;
}

bool CommandHandler::isDryRunActive() const {
    return _dryRunActive;
}
