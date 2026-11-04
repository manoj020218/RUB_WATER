#pragma once
#include <Arduino.h>

// System watchdogs (added 0.2.2 after RUB46 went silent and stayed hung until
// a manual power-cycle).
//
//  1. Task watchdog (hardware-timer backed): the Arduino loop task must feed it
//     at least every kTaskWdtTimeoutS seconds, otherwise the chip panics and
//     reboots. Covers a frozen loop()/setup() and blocking calls that never
//     return. Long legitimate operations (OTA download) feed it per chunk.
//
//  2. Connectivity watchdog: if the device is provisioned but MQTT has been
//     disconnected continuously for a while, reboot to recover a stuck WiFi /
//     lwIP / TLS stack. Never fires during ALERT/DANGER (local alarm keeps
//     running) or while OTA / the maintenance AP is active. Back-off doubles
//     after each consecutive no-connect reboot (30 min → 1 h → 2 h → 4 h max)
//     so a long router outage does not cause a reboot every 30 minutes.

static constexpr uint32_t kTaskWdtTimeoutS = 120;

void systemWatchdogBegin();          // call first thing in setup()
void systemWatchdogFeed();           // call every loop() and inside long loops
void systemWatchdogLoop();           // call from loop(); connectivity watchdog

// Why the chip last reset ("POWERON", "TASK_WDT", "PANIC", "BROWNOUT", ...)
const char* systemResetReasonStr();
// "" or the firmware-initiated cause of the previous reboot ("conn_watchdog")
const char* systemLastSelfRestartCause();
uint32_t systemConnWatchdogRebootCount();
