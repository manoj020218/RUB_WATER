#include "sensor.h"
#include "config.h"

// DYP-A01CNYUB-2.1 auto mode: 0xFF [H] [L] [SUM]
// distance mm = H*256 + L
// SUM = (0xFF + H + L) & 0xFF
// Range: 280–2500 mm at 9600 baud, ~1 frame/sec in auto mode

static HardwareSerial sensorSerial(1);

static uint32_t     samples[SENSOR_FILTER_SAMPLES];
static uint32_t     sampleCount   = 0;
static uint32_t     filteredDist  = 0;
static SensorStatus sensorStatus  = SENSOR_FAULT;
static uint32_t     lastValidMs   = 0;

// Discard leading garbage, return true if a valid 4-byte frame is parsed
static bool readFrame(uint32_t &dist_mm) {
    while (sensorSerial.available() > 0 && sensorSerial.peek() != 0xFF) {
        uint8_t junk = sensorSerial.read();
        Serial.printf("[sensor] skip byte 0x%02X\n", junk);
    }
    if (sensorSerial.available() < 4) return false;

    uint8_t buf[4];
    sensorSerial.readBytes(buf, 4);

    if (buf[0] != 0xFF) return false;

    uint8_t csum = (uint8_t)((buf[0] + buf[1] + buf[2]) & 0xFF);
    if (csum != buf[3]) {
        Serial.printf("[sensor] BAD CSUM  bytes: %02X %02X %02X %02X  expected %02X\n",
                      buf[0], buf[1], buf[2], buf[3], csum);
        return false;
    }

    uint32_t d = (uint32_t)buf[1] * 256u + buf[2];
    if (d < SENSOR_MIN_MM || d > SENSOR_MAX_MM) {
        Serial.printf("[sensor] OUT OF RANGE  %u mm (valid 280-2500)\n", d);
        return false;
    }

    Serial.printf("[sensor] OK  %u mm\n", d);
    dist_mm = d;
    return true;
}

static uint32_t lastNoDataWarnMs = 0;

// Drop the min and max from the ring buffer, average the remaining 3
static uint32_t filteredAverage() {
    uint32_t mn = samples[0], mx = samples[0], sum = 0;
    for (int i = 0; i < SENSOR_FILTER_SAMPLES; i++) {
        sum += samples[i];
        if (samples[i] < mn) mn = samples[i];
        if (samples[i] > mx) mx = samples[i];
    }
    return (sum - mn - mx) / (SENSOR_FILTER_SAMPLES - 2);
}

void sensor_init() {
    sensorSerial.begin(SENSOR_BAUD_RATE, SERIAL_8N1,
                       SENSOR_UART_RX_PIN, SENSOR_UART_TX_PIN);
    lastValidMs = millis();
}

void sensor_update() {
    if (sensorSerial.available() == 0) {
        uint32_t now = millis();
        if (now - lastNoDataWarnMs > 5000) {
            Serial.println("[sensor] no bytes on UART1 (GPIO20) — check wiring/power");
            lastNoDataWarnMs = now;
        }
    }

    uint32_t dist;
    while (readFrame(dist)) {
        samples[sampleCount % SENSOR_FILTER_SAMPLES] = dist;
        sampleCount++;
        lastValidMs = millis();
    }

    uint32_t elapsed = millis() - lastValidMs;
    if (elapsed > (uint32_t)SENSOR_FAULT_TIMEOUT_S * 1000UL) {
        sensorStatus = SENSOR_FAULT;
        filteredDist = 0;
    } else if (sampleCount >= SENSOR_FILTER_SAMPLES) {
        sensorStatus = SENSOR_OK;
        filteredDist = filteredAverage();
    }
}

uint32_t     sensor_get_distance_mm() { return filteredDist; }
SensorStatus sensor_get_status()      { return sensorStatus; }
