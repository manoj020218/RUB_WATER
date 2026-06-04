#pragma once

// ── Product identity ─────────────────────────────────────────────────────────
// CANDIDATE mapping — becomes FLOODGUARD-S3-EDGEHAX-N16R8-02 after full bench pass
#define PRODUCT_PID              "FLOODGUARD_MAIN_S3_EDGEHAX"
#define PRODUCT_PROFILE          "FLOODGUARD-S3-EDGEHAX-01"

#ifndef FIRMWARE_VERSION
#define FIRMWARE_VERSION         "0.1.0"
#endif
#ifndef HARDWARE_VERSION
#define HARDWARE_VERSION         "EH-S3-01"
#endif
#ifndef DEVICE_ID_SEED
#define DEVICE_ID_SEED           "FG-MAIN-EDGEHAX-01"
#endif
#ifndef DEVICE_TOKEN_SEED
#define DEVICE_TOKEN_SEED        "change_me_before_flash"
#endif
#ifndef LOCATION_ID_SEED
#define LOCATION_ID_SEED         "RUB-SITE-01"
#endif

// ── Cloud endpoints (compiled in, unchangeable without re-flash) ─────────────
#define DEFAULT_MQTT_HOST        "api.floodguard.iotsoft.in"
#define DEFAULT_MQTT_PORT        1883
#define DEFAULT_HTTP_BASE_URL    "http://api.floodguard.iotsoft.in"
#define DEFAULT_OTA_BASE_URL     "http://flash.iotsoft.in"
#define DEFAULT_OTA_CHANNEL      "stable"

// ── Primary DYP sensor — UART1, receive-only ─────────────────────────────────
#define PIN_PRIMARY_DYP_RX       21
#define PIN_PRIMARY_DYP_TX       (-1)   // TX not wired

// ── Two-level confirmation inputs ─────────────────────────────────────────────
#define PIN_CONFIRM_LEVEL1       4      // INPUT_PULLUP, LOW = active
#define PIN_CONFIRM_LEVEL2       5      // INPUT_PULLUP, LOW = active

// ── Local relay outputs (active-LOW relay board) ──────────────────────────────
#define PIN_RELAY_SIREN          6      // LOW = ON
#define PIN_RELAY_FLASH          7
#define PIN_RELAY_VOICE_FUTURE   8
#define PIN_RELAY_SUMP_PUMP      16

#define RELAY_ON_LEVEL           LOW
#define RELAY_OFF_LEVEL          HIGH

// ── RF trigger outputs (active-LOW) ──────────────────────────────────────────
#define PIN_RF_DANGER_SIREN      17     // LOW = ACTIVE
#define PIN_RF_SUMP_PUMP         18

#define RF_ACTIVE_LEVEL          LOW
#define RF_IDLE_LEVEL            HIGH

// ── Main battery ADC ─────────────────────────────────────────────────────────
#define PIN_MAIN_BATTERY_ADC     1
#define BATTERY_ADC_DIVIDER_RATIO  5.0f
#define BATTERY_ADC_CALIBRATION    1.0f
#define BATTERY_ADC_SAMPLES        12

// ── External CONFIG button ───────────────────────────────────────────────────
#define PIN_CONFIG_BUTTON        48     // INPUT_PULLUP, LOW = pressed

// ── Left remote RTU bus — UART2 ──────────────────────────────────────────────
// CANDIDATE pins — confirmed safe after full GPIO analysis 2026-05-30:
//   GPIO35/36/37 blocked (OPI PSRAM on N16R8).
//   GPIO0/3/45/46 blocked (boot/strapping per spec §2.1).
//   Only 2 free pads from Edgehax pinout list: GPIO2, GPIO15.
//   GPIO19 (USB D-) used for RTS — native USB intentionally unavailable
//   in field profile; device uses Wi-Fi + OTA only.
// Freeze to FLOODGUARD-S3-EDGEHAX-N16R8-02 after bench test checklist passes.
#define PIN_LEFT_RS485_RX        15    // CANDIDATE
#define PIN_LEFT_RS485_TX        2     // CANDIDATE
#ifdef DUMMY_DYP_MM
#define PIN_LEFT_RS485_RTS       47    // dev: GPIO47 replaces GPIO19 (USB D- unusable)
#else
#define PIN_LEFT_RS485_RTS       19    // CANDIDATE — USB D- repurposed
#endif

// ── Right remote RTU bus — UART2 (remapped) ──────────────────────────────────
#define PIN_RIGHT_RS485_RX       38
#define PIN_RIGHT_RS485_TX       39
#define PIN_RIGHT_RS485_RTS      47

// MAX485 auto-direction variant: no DE/RE control pin on either bus.
#undef PIN_LEFT_RS485_RTS
#define PIN_LEFT_RS485_RTS       (-1)
#undef PIN_RIGHT_RS485_RTS
#define PIN_RIGHT_RS485_RTS      (-1)

#define LEFT_RS485_RTS_TX_ACTIVE_HIGH   true
#define RIGHT_RS485_RTS_TX_ACTIVE_HIGH  true

// ── Onboard LEDs ─────────────────────────────────────────────────────────────
// Polarity confirmed: HIGH = ON (bench tested 2026-05-30)
#define PIN_LED_ORANGE           40
#define PIN_LED_WHITE            41
#define PIN_LED_GREEN            42
#define LED_ON_LEVEL             HIGH
#define LED_OFF_LEVEL            LOW

// ── Onboard microSD — SDMMC 4-bit (confirmed Edgehax pinout) ─────────────────
#define PIN_SD_D2                9
#define PIN_SD_D3                10
#define PIN_SD_CMD               11
#define PIN_SD_CLK               12
#define PIN_SD_D0                13
#define PIN_SD_D1                14
#define PIN_SD_CD                (-1)   // no card-detect on this board

// ── RTU slave addresses ───────────────────────────────────────────────────────
#define RTU_SLAVE_ID_LEFT_BOX    11
#define RTU_SLAVE_ID_RIGHT_BOX   12

#ifdef GENERIC_REMOTE_RELAY_MODE
#ifndef GENERIC_REMOTE_RELAY_LEFT_ADDR
#define GENERIC_REMOTE_RELAY_LEFT_ADDR   255
#endif
#ifndef GENERIC_REMOTE_RELAY_RIGHT_ADDR
#define GENERIC_REMOTE_RELAY_RIGHT_ADDR  255
#endif
#ifndef GENERIC_REMOTE_RELAY_LEFT_MODEL
#define GENERIC_REMOTE_RELAY_LEFT_MODEL  2
#endif
#ifndef GENERIC_REMOTE_RELAY_RIGHT_MODEL
#define GENERIC_REMOTE_RELAY_RIGHT_MODEL 2
#endif
#endif

// ── NVS namespaces ────────────────────────────────────────────────────────────
#define NVS_NS_WIFI              "fgcfg"    // wifi_ssid, wifi_pass
#define NVS_NS_MAIN              "fgmain"   // thresholds, calibration, reboot time
