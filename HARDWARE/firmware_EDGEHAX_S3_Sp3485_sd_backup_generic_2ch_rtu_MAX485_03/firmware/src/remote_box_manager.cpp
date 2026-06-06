#include "remote_box_manager.h"

#include "config_manager.h"
#include "device_profile.h"
#include "flood_state_machine.h"

#ifdef GENERIC_REMOTE_RELAY_MODE
namespace {
constexpr uint32_t kGenericRelayReadbackDelayMs = 25UL;
constexpr uint32_t kGenericRelayCommandRetryDelayMs = 20UL;

uint8_t genericRelaySlaveIdForBus(RtuBus bus) {
    return bus == RtuBus::LEFT ? GENERIC_REMOTE_RELAY_LEFT_ADDR : GENERIC_REMOTE_RELAY_RIGHT_ADDR;
}

uint8_t genericRelayModelForBus(RtuBus bus) {
    return bus == RtuBus::LEFT ? GENERIC_REMOTE_RELAY_LEFT_MODEL : GENERIC_REMOTE_RELAY_RIGHT_MODEL;
}

uint8_t genericRelayCountForModel(uint8_t model) {
    return model >= 4 ? 4 : 2;
}

uint16_t genericRelayFirstCoilForModel(uint8_t model) {
    return model >= 4 ? 0x0001 : 0x0000;
}

uint16_t genericRelayPrimaryOnValueForModel(uint8_t model) {
    return model >= 4 ? 0x0100 : 0xFF00;
}

uint16_t genericRelayAlternateOnValueForModel(uint8_t model) {
    return model >= 4 ? 0xFF00 : 0x0100;
}

uint8_t genericRelayStatusReadCountForModel(uint8_t model) {
    return model >= 4 ? 4 : 2;
}

bool writeGenericRelayCoil(RtuBus bus, uint8_t slaveId, uint16_t coilAddr,
                           bool on, uint16_t primaryOnValue, uint16_t alternateOnValue) {
    auto& rtu = Rs485RtuMaster::getInstance();
    const uint16_t primaryValue = on ? primaryOnValue : 0x0000;
    RtuResult r = rtu.writeCoilValue(bus, slaveId, coilAddr, primaryValue);
    if (r.ok || !on || alternateOnValue == primaryOnValue) {
        return r.ok;
    }

    delay(kGenericRelayCommandRetryDelayMs);
    r = rtu.writeCoilValue(bus, slaveId, coilAddr, alternateOnValue);
    return r.ok;
}

bool pollGenericRelayBox(RtuBus bus, RemoteBoxStatus& status, uint8_t slaveId) {
    const uint8_t model = genericRelayModelForBus(bus);
    uint8_t coils[1] = {0};
    const RtuResult r = Rs485RtuMaster::getInstance().readCoils(
        bus, slaveId,
        genericRelayFirstCoilForModel(model),
        genericRelayStatusReadCountForModel(model),
        coils, sizeof(coils));
    if (!r.ok) {
        status.online = false;
        return false;
    }

    status.online = true;
    status.deviceType = 0;
    status.firmwareMajor = 0;
    status.deviceStatus = 0;
    status.batteryVoltage = 0.0f;
    status.sirenOn = (coils[0] & 0x01U) != 0;
    status.flashOn = (coils[0] & 0x02U) != 0;
    status.barrierOn = genericRelayCountForModel(model) >= 4 ? ((coils[0] & 0x08U) != 0) : false;
    status.pumpOn = false;
    status.lastAckMs = millis();
    return true;
}

bool writeGenericRelayOutputs(RtuBus bus, uint8_t slaveId, bool sirenOn, bool flashOn) {
    const uint8_t model = genericRelayModelForBus(bus);
    const uint8_t relayCount = genericRelayCountForModel(model);
    const uint16_t firstCoil = genericRelayFirstCoilForModel(model);
    const uint16_t primaryOnValue = genericRelayPrimaryOnValueForModel(model);
    const uint16_t alternateOnValue = genericRelayAlternateOnValueForModel(model);
    const bool voiceOn = sirenOn;  // relay 3 follows danger/siren state
    const bool spareOn = false;    // relay 4 reserved for future barrier use

    if (!writeGenericRelayCoil(bus, slaveId, firstCoil + 0, sirenOn, primaryOnValue, alternateOnValue)) return false;
    if (!writeGenericRelayCoil(bus, slaveId, firstCoil + 1, flashOn, primaryOnValue, alternateOnValue)) return false;
    if (relayCount >= 4) {
        if (!writeGenericRelayCoil(bus, slaveId, firstCoil + 2, voiceOn, primaryOnValue, alternateOnValue)) return false;
        if (!writeGenericRelayCoil(bus, slaveId, firstCoil + 3, spareOn, primaryOnValue, alternateOnValue)) return false;
    }
    delay(kGenericRelayReadbackDelayMs);
    return true;
}
}
#endif

RemoteBoxManager& RemoteBoxManager::getInstance() {
    static RemoteBoxManager inst;
    return inst;
}

void RemoteBoxManager::begin() {
    Rs485RtuMaster::getInstance().begin();
    _left  = {};
    _right = {};
    Serial.println("[RTU] RemoteBoxManager started");
}

void RemoteBoxManager::loop() {
    const auto& cfg = ConfigManager::getInstance().get();
    if (!cfg.leftRemoteEnabled && !cfg.rightRemoteEnabled) return;

    const uint32_t now = millis();
    if (autoControlSuspended(now)) return;

#ifdef GENERIC_REMOTE_RELAY_MODE
    const uint8_t leftSlaveId  = GENERIC_REMOTE_RELAY_LEFT_ADDR;
    const uint8_t rightSlaveId = GENERIC_REMOTE_RELAY_RIGHT_ADDR;
#else
    const uint8_t leftSlaveId  = RTU_SLAVE_ID_LEFT_BOX;
    const uint8_t rightSlaveId = RTU_SLAVE_ID_RIGHT_BOX;
#endif

    // Adjust poll rate based on alarm state
    const FloodState fs = FloodStateMachine::getInstance().snapshot().state;
    _pollIntervalMs = isAlertOrDanger(fs) ? 5000UL : 30000UL;

    if ((now - _lastPollMs) < _pollIntervalMs) return;
    _lastPollMs = now;

    if (cfg.leftRemoteEnabled) {
        pollBox(RtuBus::LEFT, _left, leftSlaveId);
        if (_pendingSirenFlash) {
            sendCommands(RtuBus::LEFT, leftSlaveId,
                         _pendingSiren, _pendingFlash, _left.pumpOn);
        }
        if (_pendingPump) {
            sendCommands(RtuBus::LEFT, leftSlaveId,
                         _left.sirenOn, _left.flashOn, _pendingPumpState);
        }
    }
    if (cfg.rightRemoteEnabled) {
        pollBox(RtuBus::RIGHT, _right, rightSlaveId);
        if (_pendingSirenFlash) {
            sendCommands(RtuBus::RIGHT, rightSlaveId,
                         _pendingSiren, _pendingFlash, _right.pumpOn);
        }
        if (_pendingPump) {
            sendCommands(RtuBus::RIGHT, rightSlaveId,
                         _right.sirenOn, _right.flashOn, _pendingPumpState);
        }
    }
    _pendingSirenFlash = false;
    _pendingPump       = false;
}

void RemoteBoxManager::setSirenFlash(bool sirenOn, bool flashOn) {
    if (autoControlSuspended(millis())) return;
    _pendingSirenFlash = true;
    _pendingSiren      = sirenOn;
    _pendingFlash      = flashOn;
}

void RemoteBoxManager::setPump(bool on) {
    _pendingPump      = true;
    _pendingPumpState = on;
}

void RemoteBoxManager::suspendAutoControl(uint32_t durationMs) {
    _manualHoldoffUntilMs = millis() + durationMs;
}

bool RemoteBoxManager::manualSetSirenFlash(RtuBus bus, bool sirenOn, bool flashOn) {
    suspendAutoControl();
#ifdef GENERIC_REMOTE_RELAY_MODE
    const uint8_t slaveId = genericRelaySlaveIdForBus(bus);
    auto& status = (bus == RtuBus::LEFT) ? _left : _right;
    if (!writeGenericRelayOutputs(bus, slaveId, sirenOn, flashOn)) {
        status.online = false;
        return false;
    }
    pollGenericRelayBox(bus, status, slaveId);
    return status.online;
#else
    const uint8_t slaveId = (bus == RtuBus::LEFT) ? RTU_SLAVE_ID_LEFT_BOX : RTU_SLAVE_ID_RIGHT_BOX;
    auto& status = (bus == RtuBus::LEFT) ? _left : _right;
    const char* busName = bus == RtuBus::LEFT ? "left" : "right";
    auto& rtu = Rs485RtuMaster::getInstance();

    Serial.printf("[RTU] Manual test on %s bus (id=%d) siren=%d flash=%d\n",
                  busName, (int)slaveId, sirenOn ? 1 : 0, flashOn ? 1 : 0);

    RtuResult r = rtu.writeSingle(bus, slaveId, RemoteReg::CMD_SIREN, sirenOn ? 1 : 0);
    if (!r.ok) {
        Serial.printf("[RTU] Manual CMD_SIREN failed on %s bus\n", busName);
        status.online = false;
        return false;
    }

    r = rtu.writeSingle(bus, slaveId, RemoteReg::CMD_FLASH, flashOn ? 1 : 0);
    if (!r.ok) {
        Serial.printf("[RTU] Manual CMD_FLASH failed on %s bus\n", busName);
        status.online = false;
        return false;
    }

    status.online = true;
    status.sirenOn = sirenOn;
    status.flashOn = flashOn;
    status.lastAckMs = millis();
    return true;
#endif
}

void RemoteBoxManager::pollBox(RtuBus bus, RemoteBoxStatus& status, uint8_t slaveId) {
#ifdef GENERIC_REMOTE_RELAY_MODE
    const uint32_t t0 = millis();
    if (!pollGenericRelayBox(bus, status, slaveId)) {
        Serial.printf("[RTU] %s generic relay box: no response\n", bus == RtuBus::LEFT ? "Left" : "Right");
        return;
    }
    status.pollTimeMs = millis() - t0;
    Serial.printf("[RTU] %s generic relay (%uch): siren=%d flash=%d barrier=%d poll=%ums\n",
                  bus == RtuBus::LEFT ? "Left" : "Right",
                  (unsigned)genericRelayCountForModel(genericRelayModelForBus(bus)),
                  status.sirenOn ? 1 : 0, status.flashOn ? 1 : 0,
                  status.barrierOn ? 1 : 0, (unsigned)status.pollTimeMs);
    return;
#else
    const uint32_t t0 = millis();
    const char* busName = bus == RtuBus::LEFT ? "Left" : "Right";
    Serial.printf("[RTU] Polling %s bus (id=%d)...\n", busName, (int)slaveId);
    uint16_t regs[8];

    // Read device info + status block (40001..40005 = 5 regs)
    RtuResult r = Rs485RtuMaster::getInstance().readHolding(bus, slaveId, RemoteReg::DEVICE_TYPE, 5, regs);
    if (!r.ok) {
        Serial.printf("[RTU] %s: no response\n", busName);
        if (status.online) Serial.printf("[RTU] %s box OFFLINE\n", busName);
        status.online = false;
        return;
    }
    status.online      = true;
    status.deviceType  = regs[0];
    status.firmwareMajor = regs[1];
    status.deviceStatus  = regs[4];
    status.lastAckMs   = millis();

    // Read relay status (40201..40204 = 4 regs)
    uint16_t relays[4];
    r = Rs485RtuMaster::getInstance().readHolding(bus, slaveId, RemoteReg::RELAY_SIREN_STATUS, 4, relays);
    if (r.ok) {
        status.sirenOn   = relays[0] == 1;
        status.flashOn   = relays[1] == 1;
        status.barrierOn = relays[2] == 1;
        status.pumpOn    = relays[3] == 1;
    }

    // Read battery (40401 = 1 reg)
    uint16_t batt[1];
    r = Rs485RtuMaster::getInstance().readHolding(bus, slaveId, RemoteReg::BATTERY_VOLTAGE_X100, 1, batt);
    if (r.ok) status.batteryVoltage = batt[0] / 100.0f;

    status.pollTimeMs = millis() - t0;
    Serial.printf("[RTU] %s: online batt=%.2fV siren=%d flash=%d poll=%ums\n",
                  busName, status.batteryVoltage,
                  status.sirenOn, status.flashOn, (unsigned)status.pollTimeMs);
#endif
}

void RemoteBoxManager::sendCommands(RtuBus bus, uint8_t slaveId,
                                    bool sirenOn, bool flashOn, bool pumpOn)
{
#ifdef GENERIC_REMOTE_RELAY_MODE
    (void)pumpOn;
    auto& status = (bus == RtuBus::LEFT) ? _left : _right;
    if (!writeGenericRelayOutputs(bus, slaveId, sirenOn, flashOn)) {
        status.online = false;
        Serial.printf("[RTU] Generic relay write failed on %s bus\n",
                      bus == RtuBus::LEFT ? "left" : "right");
        return;
    }
    pollGenericRelayBox(bus, status, slaveId);
    return;
#else
    auto& rtu = Rs485RtuMaster::getInstance();
    RtuResult r;

    r = rtu.writeSingle(bus, slaveId, RemoteReg::CMD_SIREN, sirenOn ? 1 : 0);
    if (!r.ok) {
        Serial.printf("[RTU] CMD_SIREN write failed on %s bus\n",
                      bus == RtuBus::LEFT ? "left" : "right");
    }
    r = rtu.writeSingle(bus, slaveId, RemoteReg::CMD_FLASH, flashOn ? 1 : 0);
    if (!r.ok) {
        Serial.printf("[RTU] CMD_FLASH write failed on %s bus\n",
                      bus == RtuBus::LEFT ? "left" : "right");
    }
    r = rtu.writeSingle(bus, slaveId, RemoteReg::CMD_PUMP, pumpOn ? 1 : 0);
    if (!r.ok) {
        Serial.printf("[RTU] CMD_PUMP write failed on %s bus\n",
                      bus == RtuBus::LEFT ? "left" : "right");
    }
#endif
}

bool RemoteBoxManager::autoControlSuspended(uint32_t now) const {
    return _manualHoldoffUntilMs != 0 && (int32_t)(now - _manualHoldoffUntilMs) < 0;
}
