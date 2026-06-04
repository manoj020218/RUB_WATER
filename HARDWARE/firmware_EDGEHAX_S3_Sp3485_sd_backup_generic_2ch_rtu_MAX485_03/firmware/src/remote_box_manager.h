#pragma once

#include <Arduino.h>

#include "rs485_rtu_master.h"

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
    bool     online;
    uint16_t deviceType;
    uint16_t firmwareMajor;
    uint16_t deviceStatus;
    float    batteryVoltage;
    bool     sirenOn;
    bool     flashOn;
    bool     barrierOn;
    bool     pumpOn;
    uint32_t pollTimeMs;
    uint32_t lastAckMs;
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

    void pollBox(RtuBus bus, RemoteBoxStatus& status, uint8_t slaveId);
    void sendCommands(RtuBus bus, uint8_t slaveId,
                      bool sirenOn, bool flashOn, bool pumpOn);
};
