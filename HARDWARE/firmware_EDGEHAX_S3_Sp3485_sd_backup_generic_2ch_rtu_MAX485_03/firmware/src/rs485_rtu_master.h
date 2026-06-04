#pragma once

#include <Arduino.h>

enum class RtuBus : uint8_t { LEFT = 0, RIGHT = 1 };

struct RtuResult {
    bool    ok;
    uint8_t exceptionCode;  // non-zero on Modbus exception
};

// Non-blocking Modbus RTU master on UART2.
// UART2 is remapped per transaction: LEFT=(GPIO35/36) RIGHT=(GPIO38/39).
// RTS pins (37/47) are controlled separately.
class Rs485RtuMaster {
public:
    static Rs485RtuMaster& getInstance();

    void begin();

    // Blocking call - do NOT use inside safety loop.
    // Called from RemoteBoxManager which runs on its own slow cadence.
    RtuResult readHolding(RtuBus bus, uint8_t slaveId,
                          uint16_t startReg, uint8_t count,
                          uint16_t* outValues);

    RtuResult writeSingle(RtuBus bus, uint8_t slaveId,
                          uint16_t reg, uint16_t value);

    RtuResult writeMultipleRegisters(RtuBus bus, uint8_t slaveId,
                                     uint16_t startReg,
                                     const uint16_t* values, uint8_t count);

    RtuResult writeCoilValue(RtuBus bus, uint8_t slaveId,
                             uint16_t coilAddr, uint16_t rawValue);

    RtuResult writeCoil(RtuBus bus, uint8_t slaveId,
                        uint16_t coilAddr, bool on);

    RtuResult readCoils(RtuBus bus, uint8_t slaveId,
                        uint16_t startCoil, uint8_t count,
                        uint8_t* outBytes, uint8_t outByteCapacity);

private:
    Rs485RtuMaster() = default;
    bool    _begun     = false;
    RtuBus  _activeBus = RtuBus::RIGHT;

    void selectBus(RtuBus bus);
    void setTx(RtuBus bus);
    void setRx(RtuBus bus);

    uint8_t sendAndReceive(const uint8_t* req, size_t reqLen,
                           uint8_t* resp, size_t respMaxLen, size_t expectedLen);

    static uint16_t crc16(const uint8_t* data, size_t len);
};
