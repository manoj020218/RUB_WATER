#include "remote_box_manager.h"

#include "config_manager.h"
#include "device_profile.h"
#include "flood_state_machine.h"

#ifdef ST485_RTU4CH_WAVE485_MODE
namespace ST485 {
    // FC5 coil addresses (0-based): R1=siren, R2=flash, R3=voice, R4=boom
    constexpr uint16_t COIL_R1 = 0;
    constexpr uint16_t COIL_R2 = 1;
    constexpr uint16_t COIL_R3 = 2;
    constexpr uint16_t COIL_R4 = 3;

    // FC2 discrete input addresses (0-based): IN1-IN4
    // NC wiring: relay OFF → NC closed → 12V → IN=HIGH=1
    //            relay ON  → NC open  → 0V  → IN=LOW=0
    constexpr uint16_t DI_IN1 = 0;  // NC feedback R1
    constexpr uint16_t DI_IN2 = 1;  // NC feedback R2
    constexpr uint16_t DI_IN3 = 2;  // NC feedback R3
    constexpr uint16_t DI_IN4 = 3;  // LM393 battery low (LOW = battery critical)

    // Returns true if relay is physically ON (NC open → DI bit = 0)
    inline bool diConfirmsOn(uint8_t b, uint8_t bit)  { return (b & (1U << bit)) == 0; }
    inline bool diConfirmsOff(uint8_t b, uint8_t bit) { return (b & (1U << bit)) != 0; }
    inline bool batteryLow(uint8_t b)                 { return (b & (1U << DI_IN4)) == 0; }
}

static bool readST485DI(RtuBus bus, uint8_t slaveId, uint8_t& outBits) {
    outBits = 0;
    uint8_t buf[1] = {0};
    if (!Rs485RtuMaster::getInstance().readDiscreteInputs(bus, slaveId, ST485::DI_IN1, 4, buf, 1).ok)
        return false;
    outBits = buf[0];
    return true;
}

static bool writeST485Outputs(RtuBus bus, uint8_t slaveId,
                               bool sirenOn, bool flashOn, bool voiceOn, bool boomOn)
{
    auto& rtu = Rs485RtuMaster::getInstance();
    const char* bn = bus == RtuBus::LEFT ? "left" : "right";
    if (!rtu.writeCoil(bus, slaveId, ST485::COIL_R1, sirenOn).ok) {
        Serial.printf("[RTU] %s ST485 R1(siren) FC5 failed\n", bn); return false;
    }
    if (!rtu.writeCoil(bus, slaveId, ST485::COIL_R2, flashOn).ok) {
        Serial.printf("[RTU] %s ST485 R2(flash) FC5 failed\n", bn); return false;
    }
    if (!rtu.writeCoil(bus, slaveId, ST485::COIL_R3, voiceOn).ok) {
        Serial.printf("[RTU] %s ST485 R3(voice) FC5 failed\n", bn); return false;
    }
    if (!rtu.writeCoil(bus, slaveId, ST485::COIL_R4, boomOn).ok) {
        Serial.printf("[RTU] %s ST485 R4(boom) FC5 failed\n", bn); return false;
    }
    return true;
}

static void pollST485Box(RtuBus bus, RemoteBoxStatus& status, uint8_t slaveId) {
    auto& rtu = Rs485RtuMaster::getInstance();
    const char* bn = bus == RtuBus::LEFT ? "Left" : "Right";
    const uint32_t t0 = millis();

    // FC1: read 4 coil states for dashboard display
    uint8_t coilBuf[1] = {0};
    if (!rtu.readCoils(bus, slaveId, ST485::COIL_R1, 4, coilBuf, 1).ok) {
        if (status.online) Serial.printf("[RTU] %s ST485 no response\n", bn);
        // State transition on comm loss
        if (status.rtuState == RtuState::LOW_BATTERY) {
            status.rtuState  = RtuState::LVD_TRIPPED;
            status.commLostMs = millis();
            Serial.printf("[RTU] %s ST485 LVD_TRIPPED (comm lost after LOW_BATTERY)\n", bn);
        } else if (status.rtuState != RtuState::LVD_TRIPPED) {
            status.rtuState  = RtuState::COMM_LOST;
            status.commLostMs = millis();
            Serial.printf("[RTU] %s ST485 COMM_LOST\n", bn);
        }
        status.online = false;
        return;
    }

    status.sirenOn   = (coilBuf[0] & 0x01U) != 0;
    status.flashOn   = (coilBuf[0] & 0x02U) != 0;
    status.voiceOn   = (coilBuf[0] & 0x04U) != 0;
    status.boomOn    = (coilBuf[0] & 0x08U) != 0;
    status.online    = true;
    status.lastAckMs = millis();

    // FC2: read 4 discrete inputs for physical confirmation + battery monitor
    uint8_t diBuf[1] = {0};
    if (rtu.readDiscreteInputs(bus, slaveId, ST485::DI_IN1, 4, diBuf, 1).ok) {
        status.di_sirenConf  = ST485::diConfirmsOn(diBuf[0], 0);
        status.di_flashConf  = ST485::diConfirmsOn(diBuf[0], 1);
        status.di_voiceConf  = ST485::diConfirmsOn(diBuf[0], 2);
        status.di_batteryLow = ST485::batteryLow(diBuf[0]);
    }

    // RTU state machine
    if (status.di_batteryLow) {
        if (status.rtuState != RtuState::LOW_BATTERY)
            Serial.printf("[RTU] %s ST485 LOW_BATTERY (IN4 triggered)\n", bn);
        status.rtuState = RtuState::LOW_BATTERY;
    } else {
        if (status.rtuState != RtuState::ONLINE)
            Serial.printf("[RTU] %s ST485 ONLINE%s\n", bn,
                          status.rtuState == RtuState::COMM_LOST ? " (recovered)" :
                          status.rtuState == RtuState::LVD_TRIPPED ? " (LVD recovered)" : "");
        status.rtuState = RtuState::ONLINE;
    }

    status.pollTimeMs = millis() - t0;
    Serial.printf("[RTU] %s ST485: state=%d siren=%d flash=%d voice=%d batt_low=%d poll=%ums\n",
                  bn, (int)status.rtuState,
                  status.sirenOn, status.flashOn, status.voiceOn,
                  status.di_batteryLow, (unsigned)status.pollTimeMs);
}
#endif  // ST485_RTU4CH_WAVE485_MODE

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

#ifdef ST485_RTU4CH_WAVE485_MODE
    if (cfg.leftRemoteEnabled)
        processConfirmation(RtuBus::LEFT,  _left,  RTU_SLAVE_ID_LEFT_BOX,  _leftConfirm);
    if (cfg.rightRemoteEnabled)
        processConfirmation(RtuBus::RIGHT, _right, RTU_SLAVE_ID_RIGHT_BOX, _rightConfirm);
#endif

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
#ifdef ST485_RTU4CH_WAVE485_MODE
    const uint8_t slaveId = (bus == RtuBus::LEFT) ? RTU_SLAVE_ID_LEFT_BOX : RTU_SLAVE_ID_RIGHT_BOX;
    auto& status = (bus == RtuBus::LEFT) ? _left : _right;
    const bool voiceOn = sirenOn;
    if (!writeST485Outputs(bus, slaveId, sirenOn, flashOn, voiceOn, false)) {
        status.online = false;
        return false;
    }
    // Read back via FC1 for immediate status update
    uint8_t coilBuf[1] = {0};
    Rs485RtuMaster::getInstance().readCoils(bus, slaveId, ST485::COIL_R1, 4, coilBuf, 1);
    status.sirenOn   = (coilBuf[0] & 0x01U) != 0;
    status.flashOn   = (coilBuf[0] & 0x02U) != 0;
    status.voiceOn   = (coilBuf[0] & 0x04U) != 0;
    status.online    = true;
    status.lastAckMs = millis();
    return true;
#elif defined(GENERIC_REMOTE_RELAY_MODE)
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

bool RemoteBoxManager::manualSetSingleRelay(RtuBus bus, uint8_t coilIdx, bool on) {
    suspendAutoControl();
#ifdef ST485_RTU4CH_WAVE485_MODE
    const uint8_t slaveId = (bus == RtuBus::LEFT) ? RTU_SLAVE_ID_LEFT_BOX : RTU_SLAVE_ID_RIGHT_BOX;
    auto& status = (bus == RtuBus::LEFT) ? _left : _right;
    auto& rtu = Rs485RtuMaster::getInstance();
    const char* bn = bus == RtuBus::LEFT ? "Left" : "Right";
    Serial.printf("[RTU] %s ST485 manual coil=%u on=%d\n", bn, (unsigned)coilIdx, on ? 1 : 0);
    if (!rtu.writeCoil(bus, slaveId, coilIdx, on).ok) {
        status.online = false;
        return false;
    }
    uint8_t coilBuf[1] = {0};
    rtu.readCoils(bus, slaveId, 0, 4, coilBuf, 1);
    status.sirenOn   = (coilBuf[0] & 0x01U) != 0;
    status.flashOn   = (coilBuf[0] & 0x02U) != 0;
    status.voiceOn   = (coilBuf[0] & 0x04U) != 0;
    status.boomOn    = (coilBuf[0] & 0x08U) != 0;
    status.online    = true;
    status.lastAckMs = millis();
    return true;
#else
    (void)bus; (void)coilIdx; (void)on;
    return false;
#endif
}

void RemoteBoxManager::processConfirmation(RtuBus bus, RemoteBoxStatus& status,
                                            uint8_t slaveId, ConfirmState& cs)
{
#ifdef ST485_RTU4CH_WAVE485_MODE
    if (!cs.pending) return;
    if ((int32_t)(millis() - cs.checkAtMs) < 0) return;  // timer not expired yet

    const char* bn = bus == RtuBus::LEFT ? "Left" : "Right";
    uint8_t diBits = 0;
    if (!readST485DI(bus, slaveId, diBits)) {
        cs.pending = false;  // comm lost — let pollST485Box handle state
        return;
    }

    // Confirm each relay: wantOn → expect bit=0 (NC open); wantOff → expect bit=1 (NC closed)
    bool sirenOk = cs.wantSiren ? ((diBits & 0x01U) == 0) : ((diBits & 0x01U) != 0);
    bool flashOk = cs.wantFlash ? ((diBits & 0x02U) == 0) : ((diBits & 0x02U) != 0);
    bool voiceOk = cs.wantVoice ? ((diBits & 0x04U) == 0) : ((diBits & 0x04U) != 0);

    if (sirenOk && flashOk && voiceOk) {
        status.sirenFaulty = false;
        status.flashFaulty = false;
        status.voiceFaulty = false;
        cs.pending = false;
        Serial.printf("[RTU] %s relay confirmation OK (DI=0x%02X)\n", bn, diBits);
        return;
    }

    if (!cs.retried) {
        Serial.printf("[RTU] %s confirmation failed (DI=0x%02X) — retrying\n", bn, diBits);
        writeST485Outputs(bus, slaveId, cs.wantSiren, cs.wantFlash, cs.wantVoice, false);
        cs.retried  = true;
        cs.checkAtMs = millis() + 5000UL;
        return;
    }

    // Second check failed — mark faulty
    if (!sirenOk) { status.sirenFaulty = true; Serial.printf("[RTU] %s RELAY_FAULTY: R1 siren\n", bn); }
    if (!flashOk) { status.flashFaulty = true; Serial.printf("[RTU] %s RELAY_FAULTY: R2 flash\n", bn); }
    if (!voiceOk) { status.voiceFaulty = true; Serial.printf("[RTU] %s RELAY_FAULTY: R3 voice\n", bn); }
    cs.pending = false;
#else
    (void)bus; (void)status; (void)slaveId; (void)cs;
#endif
}

void RemoteBoxManager::pollBox(RtuBus bus, RemoteBoxStatus& status, uint8_t slaveId) {
#ifdef ST485_RTU4CH_WAVE485_MODE
    pollST485Box(bus, status, slaveId);
    return;
#elif defined(GENERIC_REMOTE_RELAY_MODE)
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
#ifdef ST485_RTU4CH_WAVE485_MODE
    (void)pumpOn;
    auto& status = (bus == RtuBus::LEFT) ? _left : _right;
    auto& cs     = (bus == RtuBus::LEFT) ? _leftConfirm : _rightConfirm;
    const bool voiceOn = sirenOn;  // R3 (voice) follows siren/danger state
    if (!writeST485Outputs(bus, slaveId, sirenOn, flashOn, voiceOn, false)) {
        status.online = false;
        return;
    }
    // Arm 3-second physical relay confirmation via DI (NC feedback)
    cs.pending   = true;
    cs.retried   = false;
    cs.checkAtMs = millis() + 3000UL;
    cs.wantSiren = sirenOn;
    cs.wantFlash = flashOn;
    cs.wantVoice = voiceOn;
    return;
#elif defined(GENERIC_REMOTE_RELAY_MODE)
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
