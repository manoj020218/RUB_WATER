#include "command_handler.h"

#include <ArduinoJson.h>
#include <cstring>

#include "alarm_state_machine.h"
#include "ota_manager.h"
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

    if (std::strcmp(command, "OTA_CHECK") == 0 || std::strcmp(command, "ota_check") == 0) {
        return OtaManager::getInstance().requestCheck(false);
    }

    if (std::strcmp(command, "OTA_UPDATE") == 0 || std::strcmp(command, "ota_update") == 0) {
        return OtaManager::getInstance().requestCheck(true);
    }

    StaticJsonDocument<512> doc;
    const bool hasPayloadJson = payload && payload[0] != '\0' &&
        deserializeJson(doc, payload) == DeserializationError::Ok;

    if (std::strcmp(command, "OTA_SET_HOST") == 0 || std::strcmp(command, "ota_set_host") == 0) {
        if (!hasPayloadJson) {
            return false;
        }

        const char* host = doc["ota_host"] | "";
        if (host[0] == '\0') {
            host = doc["ota_base_url"] | "";
        }
        if (host[0] == '\0') {
            host = doc["host"] | "";
        }
        if (host[0] == '\0') {
            host = doc["vps"] | "";
        }
        if (host[0] == '\0') {
            host = doc["server"] | "";
        }
        return OtaManager::getInstance().setOtaHost(host);
    }

    if (std::strcmp(command, "OTA_UPDATE_URL") == 0 || std::strcmp(command, "ota_update_url") == 0) {
        if (!hasPayloadJson) {
            return false;
        }

        const char* url = doc["firmware_url"] | "";
        if (url[0] == '\0') {
            url = doc["url"] | "";
        }
        if (url[0] == '\0') {
            url = doc["bin_url"] | "";
        }

        const char* targetVersion = doc["version"] | "";
        if (targetVersion[0] == '\0') {
            targetVersion = doc["target_version"] | "";
        }
        return OtaManager::getInstance().requestDirectUpdate(url, targetVersion);
    }

    return false;
}

bool CommandHandler::isMuted() const {
    return _muted;
}

bool CommandHandler::isDryRunActive() const {
    return _dryRunActive;
}
