#include "rs485_rtu_master.h"

#include <HardwareSerial.h>

#include "device_profile.h"

namespace {
static HardwareSerial rtuSerial(2);   // UART2 shared between left/right buses
constexpr uint32_t kBaud           = 9600;
constexpr uint32_t kResponseStartTimeoutMs = 350UL; // wait for first response byte
constexpr uint32_t kInterByteTimeoutMs = 25UL;      // once bytes start, wait this long for the next byte
constexpr uint32_t kInterFrameMs   = 5UL;     // silence between frames at 9600
constexpr uint32_t kPostFlushTxHoldMs = 10UL; // 8-byte Modbus RTU request wire time at 9600 + margin
constexpr uint32_t kRetryRecoveryMs = 12UL;   // extra settle time before retrying a short/no-response exchange
constexpr uint8_t kMaxExchangeAttempts = 2;

bool txActiveLevel(RtuBus bus) {
    return bus == RtuBus::LEFT ? LEFT_RS485_RTS_TX_ACTIVE_HIGH
                               : RIGHT_RS485_RTS_TX_ACTIVE_HIGH;
}

bool rxIdleLevel(RtuBus bus) {
    return !txActiveLevel(bus);
}

int rtsPinForBus(RtuBus bus) {
    return bus == RtuBus::LEFT ? PIN_LEFT_RS485_RTS : PIN_RIGHT_RS485_RTS;
}
}

Rs485RtuMaster& Rs485RtuMaster::getInstance() {
    static Rs485RtuMaster inst;
    return inst;
}

// Returns true if the given RX/TX pair is safe to use as UART (not OPI PSRAM lines).
// GPIO33-37 are occupied by Octal PSRAM on N16R8 - reject them.
static bool rtuPinsOk(int rx, int tx) {
    auto bad = [](int p){ return p >= 33 && p <= 37; };
    return !bad(rx) && !bad(tx);
}

void Rs485RtuMaster::begin() {
    if (rtuPinsOk(PIN_LEFT_RS485_RX, PIN_LEFT_RS485_TX)) {
        if (PIN_LEFT_RS485_RTS >= 0) {
            pinMode(PIN_LEFT_RS485_RTS, OUTPUT);
            digitalWrite(PIN_LEFT_RS485_RTS, rxIdleLevel(RtuBus::LEFT));
        }
    } else {
        Serial.println("[RTU] WARNING: left bus pins conflict with OPI PSRAM - left bus disabled");
    }
    if (PIN_RIGHT_RS485_RTS >= 0) {
        pinMode(PIN_RIGHT_RS485_RTS, OUTPUT);
        digitalWrite(PIN_RIGHT_RS485_RTS, rxIdleLevel(RtuBus::RIGHT));
    }
    // Init UART2 on whichever bus has usable pins (prefer right).
    if (rtuPinsOk(PIN_RIGHT_RS485_RX, PIN_RIGHT_RS485_TX)) {
        rtuSerial.begin(kBaud, SERIAL_8N1, PIN_RIGHT_RS485_RX, PIN_RIGHT_RS485_TX);
    } else if (rtuPinsOk(PIN_LEFT_RS485_RX, PIN_LEFT_RS485_TX)) {
        rtuSerial.begin(kBaud, SERIAL_8N1, PIN_LEFT_RS485_RX, PIN_LEFT_RS485_TX);
    }
    _begun = true;
    Serial.println("[RTU] Master started on UART2");
}

// Public API

RtuResult Rs485RtuMaster::readHolding(RtuBus bus, uint8_t slaveId,
                                      uint16_t startReg, uint8_t count,
                                      uint16_t* outValues)
{
    // FC3 request: slaveId, 0x03, startRegH, startRegL, countH, countL, crcL, crcH
    uint8_t req[8];
    req[0] = slaveId;
    req[1] = 0x03;
    req[2] = (uint8_t)(startReg >> 8);
    req[3] = (uint8_t)(startReg & 0xFF);
    req[4] = 0x00;
    req[5] = count;
    const uint16_t crc = crc16(req, 6);
    req[6] = (uint8_t)(crc & 0xFF);
    req[7] = (uint8_t)(crc >> 8);

    // Expected response: slaveId, 0x03, byteCount, data[count*2], crcL, crcH
    const size_t expectedLen = 5 + (size_t)count * 2;
    uint8_t resp[128];
    if (expectedLen > sizeof(resp)) return {false, 0};

    selectBus(bus);
    const uint8_t err = sendAndReceive(req, 8, resp, sizeof(resp), expectedLen);
    if (err) return {false, err};

    // Validate response
    if (resp[0] != slaveId || resp[1] != 0x03) {
        if (resp[1] & 0x80) return {false, resp[2]};  // Modbus exception
        return {false, 0xFF};
    }
    if (resp[2] != count * 2) return {false, 0xFE};

    const uint16_t respCrc = crc16(resp, expectedLen - 2);
    const uint16_t gotCrc  = resp[expectedLen - 2] | ((uint16_t)resp[expectedLen - 1] << 8);
    if (respCrc != gotCrc) return {false, 0xFD};

    for (uint8_t i = 0; i < count; i++) {
        outValues[i] = ((uint16_t)resp[3 + i * 2] << 8) | resp[4 + i * 2];
    }
    return {true, 0};
}

RtuResult Rs485RtuMaster::writeSingle(RtuBus bus, uint8_t slaveId,
                                      uint16_t reg, uint16_t value)
{
    // FC6 request: slaveId, 0x06, regH, regL, valH, valL, crcL, crcH
    uint8_t req[8];
    req[0] = slaveId;
    req[1] = 0x06;
    req[2] = (uint8_t)(reg >> 8);
    req[3] = (uint8_t)(reg & 0xFF);
    req[4] = (uint8_t)(value >> 8);
    req[5] = (uint8_t)(value & 0xFF);
    const uint16_t crc = crc16(req, 6);
    req[6] = (uint8_t)(crc & 0xFF);
    req[7] = (uint8_t)(crc >> 8);

    selectBus(bus);
    uint8_t resp[8];
    const uint8_t err = sendAndReceive(req, 8, resp, 8, 8);
    if (err) return {false, err};

    if (resp[0] != slaveId || resp[1] != 0x06) {
        if (resp[1] & 0x80) return {false, resp[2]};
        return {false, 0xFF};
    }
    const uint16_t respCrc = crc16(resp, 6);
    const uint16_t gotCrc  = resp[6] | ((uint16_t)resp[7] << 8);
    return {respCrc == gotCrc, (uint8_t)(respCrc == gotCrc ? 0 : 0xFD)};
}

RtuResult Rs485RtuMaster::writeMultipleRegisters(RtuBus bus, uint8_t slaveId,
                                                 uint16_t startReg,
                                                 const uint16_t* values, uint8_t count)
{
    if (!values || count == 0) return {false, 0xFF};
    if (count > 8) return {false, 0xFE};

    const uint8_t byteCount = (uint8_t)(count * 2U);
    uint8_t req[32];
    req[0] = slaveId;
    req[1] = 0x10;
    req[2] = (uint8_t)(startReg >> 8);
    req[3] = (uint8_t)(startReg & 0xFF);
    req[4] = 0x00;
    req[5] = count;
    req[6] = byteCount;
    for (uint8_t i = 0; i < count; ++i) {
        req[7 + i * 2] = (uint8_t)(values[i] >> 8);
        req[8 + i * 2] = (uint8_t)(values[i] & 0xFF);
    }
    const uint16_t crc = crc16(req, 7 + byteCount);
    req[7 + byteCount] = (uint8_t)(crc & 0xFF);
    req[8 + byteCount] = (uint8_t)(crc >> 8);

    selectBus(bus);
    uint8_t resp[16];
    const uint8_t err = sendAndReceive(req, 9 + byteCount, resp, sizeof(resp), 8);
    if (err) return {false, err};

    if (resp[0] != slaveId || resp[1] != 0x10) {
        if (resp[1] & 0x80) return {false, resp[2]};
        return {false, 0xFF};
    }
    // Some low-cost relay modules echo the first bytes of the request for FC16 address writes
    // instead of returning the standard 8-byte Modbus acknowledgement. Accept that pattern too.
    if (resp[2] == req[2] && resp[3] == req[3] && resp[4] == req[4] && resp[5] == req[5] &&
        resp[6] == req[6] && resp[7] == req[7]) {
        return {true, 0};
    }
    if (resp[2] != req[2] || resp[3] != req[3] || resp[4] != req[4] || resp[5] != req[5]) {
        return {false, 0xFE};
    }
    const uint16_t respCrc = crc16(resp, 6);
    const uint16_t gotCrc  = resp[6] | ((uint16_t)resp[7] << 8);
    return {respCrc == gotCrc, (uint8_t)(respCrc == gotCrc ? 0 : 0xFD)};
}

RtuResult Rs485RtuMaster::readCoils(RtuBus bus, uint8_t slaveId,
                                    uint16_t startCoil, uint8_t count,
                                    uint8_t* outBytes, uint8_t outByteCapacity)
{
    if (!outBytes || count == 0) return {false, 0xFF};

    const uint8_t byteCount = (uint8_t)((count + 7U) / 8U);
    if (outByteCapacity < byteCount) return {false, 0xFE};

    uint8_t req[8];
    req[0] = slaveId;
    req[1] = 0x01;
    req[2] = (uint8_t)(startCoil >> 8);
    req[3] = (uint8_t)(startCoil & 0xFF);
    req[4] = 0x00;
    req[5] = count;
    const uint16_t crc = crc16(req, 6);
    req[6] = (uint8_t)(crc & 0xFF);
    req[7] = (uint8_t)(crc >> 8);

    const size_t expectedLen = 5 + byteCount;
    uint8_t resp[32];
    if (expectedLen > sizeof(resp)) return {false, 0xFD};

    selectBus(bus);
    const uint8_t err = sendAndReceive(req, 8, resp, sizeof(resp), expectedLen);
    if (err) return {false, err};

    if (resp[0] != slaveId || resp[1] != 0x01) {
        if (resp[1] & 0x80) return {false, resp[2]};
        return {false, 0xFF};
    }
    if (resp[2] != byteCount) return {false, 0xFE};

    const uint16_t respCrc = crc16(resp, expectedLen - 2);
    const uint16_t gotCrc  = resp[expectedLen - 2] | ((uint16_t)resp[expectedLen - 1] << 8);
    if (respCrc != gotCrc) return {false, 0xFD};

    for (uint8_t i = 0; i < byteCount; ++i) {
        outBytes[i] = resp[3 + i];
    }
    return {true, 0};
}

RtuResult Rs485RtuMaster::readDiscreteInputs(RtuBus bus, uint8_t slaveId,
                                              uint16_t startInput, uint8_t count,
                                              uint8_t* outBytes, uint8_t outByteCapacity)
{
    if (!outBytes || count == 0) return {false, 0xFF};

    const uint8_t byteCount = (uint8_t)((count + 7U) / 8U);
    if (outByteCapacity < byteCount) return {false, 0xFE};

    uint8_t req[8];
    req[0] = slaveId;
    req[1] = 0x02;   // FC2 Read Discrete Inputs
    req[2] = (uint8_t)(startInput >> 8);
    req[3] = (uint8_t)(startInput & 0xFF);
    req[4] = 0x00;
    req[5] = count;
    const uint16_t crc = crc16(req, 6);
    req[6] = (uint8_t)(crc & 0xFF);
    req[7] = (uint8_t)(crc >> 8);

    const size_t expectedLen = 5 + byteCount;
    uint8_t resp[32];
    if (expectedLen > sizeof(resp)) return {false, 0xFD};

    selectBus(bus);
    const uint8_t err = sendAndReceive(req, 8, resp, sizeof(resp), expectedLen);
    if (err) return {false, err};

    if (resp[0] != slaveId || resp[1] != 0x02) {
        if (resp[1] & 0x80) return {false, resp[2]};
        return {false, 0xFF};
    }
    if (resp[2] != byteCount) return {false, 0xFE};

    const uint16_t respCrc = crc16(resp, expectedLen - 2);
    const uint16_t gotCrc  = resp[expectedLen - 2] | ((uint16_t)resp[expectedLen - 1] << 8);
    if (respCrc != gotCrc) return {false, 0xFD};

    for (uint8_t i = 0; i < byteCount; ++i) {
        outBytes[i] = resp[3 + i];
    }
    return {true, 0};
}

RtuResult Rs485RtuMaster::writeCoilValue(RtuBus bus, uint8_t slaveId,
                                         uint16_t coilAddr, uint16_t rawValue)
{
    // FC5 request: slaveId, 0x05, coilAddrH, coilAddrL, valH, valL, crcL, crcH
    uint8_t req[8];
    req[0] = slaveId;
    req[1] = 0x05;
    req[2] = (uint8_t)(coilAddr >> 8);
    req[3] = (uint8_t)(coilAddr & 0xFF);
    req[4] = (uint8_t)(rawValue >> 8);
    req[5] = (uint8_t)(rawValue & 0xFF);
    const uint16_t crc = crc16(req, 6);
    req[6] = (uint8_t)(crc & 0xFF);
    req[7] = (uint8_t)(crc >> 8);

    selectBus(bus);
    uint8_t resp[8];
    const uint8_t err = sendAndReceive(req, 8, resp, 8, 8);
    if (err) return {false, err};

    if (resp[0] != slaveId || resp[1] != 0x05) {
        if (resp[1] & 0x80) return {false, resp[2]};
        return {false, 0xFF};
    }
    const uint16_t respCrc = crc16(resp, 6);
    const uint16_t gotCrc  = resp[6] | ((uint16_t)resp[7] << 8);
    return {respCrc == gotCrc, (uint8_t)(respCrc == gotCrc ? 0 : 0xFD)};
}

RtuResult Rs485RtuMaster::writeCoil(RtuBus bus, uint8_t slaveId,
                                    uint16_t coilAddr, bool on)
{
    return writeCoilValue(bus, slaveId, coilAddr, on ? 0xFF00 : 0x0000);
}

// Private helpers

void Rs485RtuMaster::selectBus(RtuBus bus) {
    const int rxPin = (bus == RtuBus::LEFT) ? PIN_LEFT_RS485_RX  : PIN_RIGHT_RS485_RX;
    const int txPin = (bus == RtuBus::LEFT) ? PIN_LEFT_RS485_TX  : PIN_RIGHT_RS485_TX;
    if (!rtuPinsOk(rxPin, txPin)) return;
    _activeBus = bus;
    rtuSerial.end();
    rtuSerial.begin(kBaud, SERIAL_8N1, rxPin, txPin);
    setRx(bus);
    delay(kInterFrameMs);
}

void Rs485RtuMaster::setTx(RtuBus bus) {
    const int rtsPin = rtsPinForBus(bus);
    if (rtsPin >= 0) {
        digitalWrite(rtsPin, txActiveLevel(bus));
        Serial.printf("[RTU] DE GPIO%d -> %s (TX)\n", rtsPin, txActiveLevel(bus) ? "HIGH" : "LOW");
        delayMicroseconds(100);
    } else {
        Serial.printf("[RTU] Auto-direction bus %s (TX)\n", bus == RtuBus::LEFT ? "left" : "right");
    }
}

void Rs485RtuMaster::setRx(RtuBus bus) {
    const int rtsPin = rtsPinForBus(bus);
    if (rtsPin >= 0) {
        digitalWrite(rtsPin, rxIdleLevel(bus));
        delayMicroseconds(100);
    }
}

uint8_t Rs485RtuMaster::sendAndReceive(const uint8_t* req, size_t reqLen,
                                       uint8_t* resp, size_t respMaxLen,
                                       size_t expectedLen)
{
    uint8_t lastErr = 0xFC;

    for (uint8_t attempt = 0; attempt < kMaxExchangeAttempts; ++attempt) {
        // Flush any stale bytes
        while (rtuSerial.available()) rtuSerial.read();

        // Transmit - bus was stored in _activeBus by selectBus()
        setTx(_activeBus);
        rtuSerial.write(req, reqLen);
        rtuSerial.flush();
        // On manually directed RS485 boards the line can still be settling after flush().
        if (rtsPinForBus(_activeBus) >= 0) {
            delay(kPostFlushTxHoldMs);
        }
        setRx(_activeBus);

        size_t received = 0;
        const uint32_t startDeadline = millis() + kResponseStartTimeoutMs;
        uint32_t lastByteMs = 0;

        while (received < expectedLen && received < respMaxLen) {
            if (rtuSerial.available()) {
                resp[received++] = (uint8_t)rtuSerial.read();
                lastByteMs = millis();
                continue;
            }

            const uint32_t now = millis();
            if (received == 0) {
                if (now >= startDeadline) break;
            } else if ((now - lastByteMs) >= kInterByteTimeoutMs) {
                break;
            }
            delayMicroseconds(200);
        }

        if (received >= expectedLen) {
            return 0x00;
        }

        if (received == 0) {
            lastErr = 0xFC;
        } else {
            lastErr = 0xFB;
        }

        if (attempt + 1 < kMaxExchangeAttempts) {
            delay(kRetryRecoveryMs);
        } else if (received == 0) {
            Serial.println("[RTU] RX: 0 bytes (timeout)");
        } else {
            Serial.printf("[RTU] RX: %u bytes (partial, need %u)\n", (unsigned)received, (unsigned)expectedLen);
        }
    }
    return lastErr;
}

uint16_t Rs485RtuMaster::crc16(const uint8_t* data, size_t len) {
    uint16_t crc = 0xFFFF;
    for (size_t i = 0; i < len; i++) {
        crc ^= data[i];
        for (uint8_t b = 0; b < 8; b++) {
            if (crc & 0x0001) crc = (crc >> 1) ^ 0xA001;
            else               crc >>= 1;
        }
    }
    return crc;
}
