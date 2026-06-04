#pragma once

#include <Arduino.h>

// Boot-time self-test and runtime diagnostics tracker.
void diagnosticsRunBootTests();
void diagnosticsLoop();          // track heap watermark, call periodically
uint32_t diagnosticsMinFreeHeap();
