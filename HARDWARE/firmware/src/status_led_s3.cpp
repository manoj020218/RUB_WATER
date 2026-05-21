#include "status_led_s3.h"

#include <algorithm>

#include "device_profile.h"

#if defined(CONFIG_IDF_TARGET_ESP32S3)
#define FG_STATUS_LED_S3_TARGET 1
#else
#define FG_STATUS_LED_S3_TARGET 0
#endif

#if defined(RGB_BUILTIN) || defined(PIN_NEOPIXEL)
#define FG_STATUS_LED_HAS_RGB 1
#else
#define FG_STATUS_LED_HAS_RGB 0
#endif

namespace {
constexpr unsigned long kBootModeMs = 6000UL;
constexpr unsigned long kBlinkSlowMs = 1000UL;
constexpr unsigned long kBlinkFastMs = 300UL;
constexpr unsigned long kStrobeMs = 140UL;
constexpr unsigned long kPulseMs = 1200UL;

#if defined(RGB_BRIGHTNESS)
constexpr uint8_t kMaxBrightness = RGB_BRIGHTNESS;
#else
constexpr uint8_t kMaxBrightness = 64;
#endif

constexpr uint8_t kStrong = 255;
constexpr uint8_t kMid = 180;
constexpr uint8_t kLow = 70;

uint8_t scaleByBrightness(uint8_t raw) {
    const uint16_t scaled = static_cast<uint16_t>(raw) * static_cast<uint16_t>(kMaxBrightness) / 255U;
    return static_cast<uint8_t>(std::min<uint16_t>(scaled, 255U));
}
}  // namespace

StatusLedS3& StatusLedS3::getInstance() {
    static StatusLedS3 instance;
    return instance;
}

void StatusLedS3::begin() {
    _bootStartMs = millis();
    _lastR = 255;
    _lastG = 255;
    _lastB = 255;
    _initialized = true;
    writeRgb(0, 0, 0);
}

void StatusLedS3::loop(AlarmState state, bool wifiConnected, bool internetAvailable, bool cloudConnected) {
    if (!_initialized) {
        begin();
    }

    const unsigned long now = millis();
    const Mode mode = decideMode(state, wifiConnected, internetAvailable, cloudConnected, now);
    renderMode(mode, now);
}

StatusLedS3::Mode StatusLedS3::decideMode(
    AlarmState state,
    bool wifiConnected,
    bool internetAvailable,
    bool cloudConnected,
    unsigned long now
) const {
    if (now - _bootStartMs < kBootModeMs) {
        return Mode::BOOT_WHITE_BREATHE;
    }

    switch (state) {
        case AlarmState::DANGER_PENDING:
        case AlarmState::DANGER_CONFIRMED:
        case AlarmState::DANGER_WITH_SENSOR_MISMATCH:
        case AlarmState::DANGER_WITH_RS485_FAULT:
        case AlarmState::CLEAR_PENDING:
            return Mode::DANGER_MAGENTA_BLINK_FAST;

        case AlarmState::ALERT_PENDING_VERIFICATION:
        case AlarmState::ALERT_ORANGE:
        case AlarmState::ALERT_ORANGE_CONFIRMED:
        case AlarmState::ALERT_SENSOR_MISMATCH:
        case AlarmState::ALERT_WITH_RS485_FAULT:
            return Mode::ALERT_ORANGE_BLINK;

        case AlarmState::SENSOR_FAULT:
            return Mode::FAULT_RED_STROBE;

        case AlarmState::OFFLINE_LOCAL_MODE:
            return Mode::OFFLINE_LOCAL_CYAN_SOLID;

        case AlarmState::NORMAL:
        default:
            break;
    }

    if (!wifiConnected) {
        return Mode::NET_NO_WIFI_RED_BLINK;
    }
    if (!internetAvailable) {
        return Mode::NET_NO_INTERNET_YELLOW_BLINK;
    }
    if (!cloudConnected) {
        return Mode::NET_LOCAL_ONLY_BLUE_PULSE;
    }
    return Mode::NET_CLOUD_OK_GREEN_SOLID;
}

void StatusLedS3::renderMode(Mode mode, unsigned long now) {
    switch (mode) {
        case Mode::BOOT_WHITE_BREATHE: {
            const uint8_t level = pulseLevel(now, kPulseMs, 8, 120);
            writeRgb(level, level, level);
            return;
        }

        case Mode::NET_NO_WIFI_RED_BLINK: {
            const bool on = ((now / kBlinkSlowMs) % 2U) == 0U;
            writeRgb(on ? kStrong : 0, 0, 0);
            return;
        }

        case Mode::NET_NO_INTERNET_YELLOW_BLINK: {
            const bool on = ((now / kBlinkSlowMs) % 2U) == 0U;
            writeRgb(on ? kStrong : 0, on ? kStrong : 0, 0);
            return;
        }

        case Mode::NET_LOCAL_ONLY_BLUE_PULSE: {
            const uint8_t level = pulseLevel(now, kPulseMs, 6, 120);
            writeRgb(0, 0, level);
            return;
        }

        case Mode::NET_CLOUD_OK_GREEN_SOLID:
            writeRgb(0, kStrong, 0);
            return;

        case Mode::ALERT_ORANGE_BLINK: {
            const bool on = ((now / kBlinkSlowMs) % 2U) == 0U;
            writeRgb(on ? kStrong : 0, on ? kMid : 0, 0);
            return;
        }

        case Mode::DANGER_MAGENTA_BLINK_FAST: {
            const bool on = ((now / kBlinkFastMs) % 2U) == 0U;
            writeRgb(on ? kStrong : 0, 0, on ? kStrong : 0);
            return;
        }

        case Mode::FAULT_RED_STROBE: {
            const bool on = ((now / kStrobeMs) % 2U) == 0U;
            writeRgb(on ? kStrong : 0, on ? kLow : 0, on ? kLow : 0);
            return;
        }

        case Mode::OFFLINE_LOCAL_CYAN_SOLID:
            writeRgb(0, kStrong, kStrong);
            return;

        case Mode::OFF:
        default:
            writeRgb(0, 0, 0);
            return;
    }
}

void StatusLedS3::writeRgb(uint8_t red, uint8_t green, uint8_t blue) {
    if (red == _lastR && green == _lastG && blue == _lastB) {
        return;
    }
    _lastR = red;
    _lastG = green;
    _lastB = blue;

#if FG_STATUS_LED_S3_TARGET && FG_STATUS_LED_HAS_RGB
    neopixelWrite(
        RGB_BUILTIN,
        scaleByBrightness(red),
        scaleByBrightness(green),
        scaleByBrightness(blue)
    );
#elif FG_STATUS_LED_S3_TARGET && defined(LED_BUILTIN)
    const bool on = (red > 0) || (green > 0) || (blue > 0);
    digitalWrite(LED_BUILTIN, on ? HIGH : LOW);
#else
    (void)red;
    (void)green;
    (void)blue;
#endif
}

uint8_t StatusLedS3::pulseLevel(unsigned long now, unsigned long periodMs, uint8_t minLevel, uint8_t maxLevel) const {
    if (periodMs == 0 || maxLevel <= minLevel) {
        return minLevel;
    }

    const unsigned long phase = now % periodMs;
    const unsigned long half = periodMs / 2UL;
    if (half == 0) {
        return minLevel;
    }

    if (phase <= half) {
        const uint32_t delta = static_cast<uint32_t>(maxLevel - minLevel);
        return static_cast<uint8_t>(minLevel + ((delta * phase) / half));
    }

    const uint32_t delta = static_cast<uint32_t>(maxLevel - minLevel);
    const unsigned long falling = phase - half;
    return static_cast<uint8_t>(maxLevel - ((delta * falling) / half));
}

