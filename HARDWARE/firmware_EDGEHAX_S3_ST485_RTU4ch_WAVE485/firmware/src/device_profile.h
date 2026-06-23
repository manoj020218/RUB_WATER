#pragma once

// ── Product identity ─────────────────────────────────────────────────────────
// CANDIDATE mapping — becomes FLOODGUARD-S3-EDGEHAX-N16R8-02 after full bench pass
#define PRODUCT_PID              "FLOODGUARD_MAIN_S3_EDGEHAX"
#define PRODUCT_PROFILE          "FLOODGUARD-S3-EH-01"

#ifndef FIRMWARE_VERSION
#define FIRMWARE_VERSION         "0.1.0"
#endif
#ifndef HARDWARE_VERSION
#define HARDWARE_VERSION         "EH-S3-01"
#endif
#ifndef DEVICE_ID_SEED
#define DEVICE_ID_SEED           "FG-MAIN-EH-01"
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
#define PIN_PRIMARY_DYP_TX       (-1)   // TX not wired — auto-direction MAX485 handles DE/RE

// ── Two-level confirmation inputs ─────────────────────────────────────────────
#define PIN_CONFIRM_LEVEL1       6      // INPUT, ext 1K pull-up; GPIO4 shorted on PCB
#define PIN_CONFIRM_LEVEL2       5      // INPUT_PULLUP, LOW = active

// ── Local relay outputs (active-LOW relay board) ──────────────────────────────
#define PIN_RELAY_SIREN          6      // LOW = ON
#define PIN_RELAY_FLASH          7
#define PIN_RELAY_VOICE_FUTURE   8

#define RELAY_ON_LEVEL           LOW
#define RELAY_OFF_LEVEL          HIGH


// ── INA219 current/voltage monitor — I2C ─────────────────────────────────────
// SDA=GPIO47, SCL=GPIO3 (JTAG_SEL strapping pin — HIGH at boot disables JTAG,
// harmless in production; allows in-circuit flashing unlike GPIO46 which is
// input-only and would block esptool via ROM log flooding).
// GY-219 module has an on-board voltage divider on VIN+; apply kVBusScale in
// voltage_monitor.cpp to correct bus voltage readings.
#define PIN_INA219_SDA           47
#define PIN_INA219_SCL           3
#define INA219_I2C_ADDR          0x40  // A0=GND, A1=GND (default breakout)

// ── External CONFIG button ───────────────────────────────────────────────────
#define PIN_CONFIG_BUTTON        48     // INPUT_PULLUP, LOW = pressed

// ── Left remote RTU bus — UART1 (remapped) ───────────────────────────────────
// GPIO17(TX) and GPIO18(RX) — both on LEFT header, adjacent pins.
// Root cause of original COMM_LOST: GPIO15=U0RTS (held LOW by ROM bootloader),
// GPIO1 had silicon-level coupling from adjacent GPIO2 pad, GPIO19=USB D- noise.
// Cross-board wiring (TX right-header, RX left-header) caused cable coupling echo.
// Fix confirmed 2026-06-19: both pins on same header → Waveshare suppresses echo.
// GPIO17/18 freed from RF trigger use (RF not physically wired on this board).
#define PIN_LEFT_RS485_RX        18    // left header
#define PIN_LEFT_RS485_TX        17    // left header
#ifdef DUMMY_DYP_MM
#define PIN_LEFT_RS485_RTS       47    // dev override
#else
#define PIN_LEFT_RS485_RTS       (-1)  // auto-direction module, no RTS needed
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
#define NVS_NS_IDENTITY          "fgid"     // device_id override (set via web UI)

// ── Firmware identity fallbacks (overridden per variant below) ───────────────
#ifndef FIRMWARE_NAME
#define FIRMWARE_NAME  "EH-S3-EDGEHAX"
#endif
#ifndef FIRMWARE_DATE
#define FIRMWARE_DATE  "unknown"
#endif

// ── ST485-C10-05-4CH + Waveshare TTL-to-RS485 (B) variant ────────────────────
// Both buses use slave ID 1 — no collision because each bus is a dedicated
// UART2 remap with no electrical connection between left and right.
#ifdef ST485_RTU4CH_WAVE485_MODE
#undef  RTU_SLAVE_ID_LEFT_BOX
#undef  RTU_SLAVE_ID_RIGHT_BOX
#define RTU_SLAVE_ID_LEFT_BOX    1
#define RTU_SLAVE_ID_RIGHT_BOX   1
#undef  PRODUCT_PROFILE
#define PRODUCT_PROFILE          "FLOODGUARD-S3-EH-ST485-01"

// Firmware display name visible in web UI and serial log.
// Decode: EH-S3=Edgehax ESP32-S3  WSTTL=Waveshare TTL-to-RS485(B)
//         ST485-RL=ST485 4CH RTU relay  MAX485=MAX485 for DYP RS485 extension
//         DYP=DYP-A01 ultrasonic sensor  L1L2=Alert+Danger levels
//         LVT=Low-Voltage-Threshold battery monitoring
#define FIRMWARE_NAME  "EH-S3-WSTTL-ST485-RL-MAX485-DYP-L1L2-LVT"

#ifndef FIRMWARE_DATE
#define FIRMWARE_DATE  "unknown"
#endif
#endif
