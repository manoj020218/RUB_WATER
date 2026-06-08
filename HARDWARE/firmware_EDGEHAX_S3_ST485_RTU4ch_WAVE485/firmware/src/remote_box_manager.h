#pragma once

#include <Arduino.h>

#include "rs485_rtu_master.h"

// RTU health state (used by ST485_RTU4CH_WAVE485_MODE; ignored otherwise)
enum class RtuState : uint8_t {
    ONLINE      = 0,  // comms OK, battery OK
    LOW_BATTERY = 1,  // comms OK, IN4 triggered (LM393 battery low)
    LVD_TRIPPED = 2,  // comms lost after LOW_BATTERY — LVD likely cut power
    COMM_LOST   = 3   // comms lost from healthy state
};

// Modbus register base addresses (40001 = offset 0)
namespace RemoteReg {
constexpr uint16_t DEVICE_TYPE          = 0x0000;  // 40001
constexpr uint16_t FIRMWARE_MAJOR       = 0x0001;
constexpr uint16_t DEVICE_STATUS        = 0x0064;  // 40101
constexpr uint16_t UPTIME_LOW           = 0x0067;  // 40104
constexpr uint16_t UPTIME_HIGH          = 0x0068;  // 40105
constexpr uint16_t RELAY_SIREN_STATUS   = 0x00C8;  // 40201
constexpr uint16_t RELAY_FLASH_STATUS   = 0x00C9;
constexpr uint16_t RELAY_BARRIER_STATUS = 0x00CA;
constexpr uint16_t RELAY_PUMP_STATUS    = 0x00CB;
constexpr uint16_t CMD_SIREN            = 0x012C;  // 40301
constexpr uint16_t CMD_FLASH            = 0x012D;
constexpr uint16_t CMD_BARRIER          = 0x012E;
constexpr uint16_t CMD_PUMP             = 0x012F;
constexpr uint16_t BATTERY_VOLTAGE_X100 = 0x0190; // 40401
constexpr uint16_t ADC_STATUS           = 0x0192;
}

struct RemoteBoxStatus {
    bool     online        = false;
    uint16_t deviceType    = 0;
    uint16_t firmwareMajor = 0;
    uint16_t deviceStatus  = 0;
    float    batteryVoltage = 0.0f;
    bool     sirenOn       = false;
    bool     flashOn       = false;
    bool     barrierOn     = false;
    bool     pumpOn        = false;
    uint32_t pollTimeMs    = 0;
    uint32_t lastAckMs     = 0;
    // ST485 4CH extension
    RtuState rtuState      = RtuState::COMM_LOST;
    bool     voiceOn       = false;
    bool     boomOn        = false;
    bool     di_sirenConf  = false;  // IN1: NC feedback — true when relay physically ON
    bool     di_flashConf  = false;  // IN2: NC feedback
    bool     di_voiceConf  = false;  // IN3: NC feedback
    bool     di_batteryLow = false;  // IN4: LM393 output LOW = battery critically low
    bool     sirenFaulty   = false;  // relay failed physical confirmation after retry
    bool     flashFaulty   = false;
    bool     voiceFaulty   = false;
    uint32_t commLostMs    = 0;
};

class RemoteBoxManager {
public:
    static RemoteBoxManager& getInstance();

    void begin();
    void loop();  // call from main loop; throttles internally

    // Command interface (safe to call from safety loop)
    void setSirenFlash(bool sirenOn, bool flashOn);
    void setPump(bool on);
    bool manualSetSirenFlash(RtuBus bus, bool sirenOn, bool flashOn);
    bool manualSetSingleRelay(RtuBus bus, uint8_t coilIdx, bool on);
    void suspendAutoControl(uint32_t durationMs = 900000UL);

    const RemoteBoxStatus& leftStatus()  const { return _left; }
    const RemoteBoxStatus& rightStatus() const { return _right; }

private:
    RemoteBoxManager() = default;
    RemoteBoxStatus _left{};
    RemoteBoxStatus _right{};

    uint32_t _lastPollMs       = 0;
    uint32_t _pollIntervalMs   = 30000UL;  // 30s normal, 5s alert/danger

    bool _pendingSirenFlash    = false;
    bool _pendingSiren         = false;
    bool _pendingFlash         = false;
    bool _pendingPump          = false;
    bool _pendingPumpState     = false;
    uint32_t _manualHoldoffUntilMs = 0;

    // ST485 relay confirmation state
    struct ConfirmState {
        bool     pending   = false;
        bool     retried   = false;
        uint32_t checkAtMs = 0;
        bool     wantSiren = false;
        bool     wantFlash = false;
        bool     wantVoice = false;
    };
    ConfirmState _leftConfirm{};
    ConfirmState _rightConfirm{};

    void pollBox(RtuBus bus, RemoteBoxStatus& status, uint8_t slaveId);
    void sendCommands(RtuBus bus, uint8_t slaveId,
                      bool sirenOn, bool flashOn, bool pumpOn);
    void processConfirmation(RtuBus bus, RemoteBoxStatus& status,
                             uint8_t slaveId, ConfirmState& cs);
    bool autoControlSuspended(uint32_t now) const;
};
