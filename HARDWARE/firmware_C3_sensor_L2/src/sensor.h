#pragma once
#include <Arduino.h>

enum SensorStatus { SENSOR_OK, SENSOR_FAULT };

void         sensor_init();
void         sensor_update();           // call every loop iteration, non-blocking
uint32_t     sensor_get_distance_mm();  // latest filtered reading (0 if fault)
SensorStatus sensor_get_status();
