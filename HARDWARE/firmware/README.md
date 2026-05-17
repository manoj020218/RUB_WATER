# FloodGuard Hardware Firmware (ESP32-S3)

This firmware workspace follows the module style used in `relay-app`, adapted for FloodGuard.

## Module Map
- `device_profile.h` (relay-app style product/pin profile)
- `config_manager.*`
- `wifi_manager.*`
- `mqtt_client.*`
- `http_fallback.*`
- `sensor_rs485.*`
- `switch_inputs.*`
- `relay_controller.*`
- `alarm_state_machine.*`
- `telemetry_manager.*`
- `command_handler.*`
- `ota_manager.*`
- `local_event_queue.*`
- `time_sync.*`
- `watchdog.*`
- `network_diagnostics.*`

## Build
```powershell
pio run -d HARDWARE/firmware
```

## Flash (when USB connected)
```powershell
pio run -d HARDWARE/firmware -t upload
```

## Serial Monitor
```powershell
pio device monitor -b 115200
```

## Notes
- Board target in this scaffold: `esp32-s3-devkitc-1`.
- If your hardware variant differs, we will update `platformio.ini` before first flash.
