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

## OTA Update (Completed)
- Partition table includes `otadata`, `ota_0`, `ota_1` for dual-slot OTA.
- Default OTA base URL: `http://flash.iotsoft.in`
- Default manifest path: `/api/ota/check`
- Manifest query sent by device:
  - `pid`, `hw`, `device_id`, `location_id`, `version`, `channel`

### MQTT Commands for OTA
- `OTA_CHECK` / `ota_check`
- `OTA_UPDATE` / `ota_update`
- `OTA_SET_HOST` / `ota_set_host`
- `OTA_UPDATE_URL` / `ota_update_url`

### OTA Topic Support
- Device subscribes:
  - `rub/{device_id}/command`
  - `rub/{device_id}/config`
  - `rub/{device_id}/ota`
- `.../ota` payload without explicit command defaults to `OTA_UPDATE`.
- `.../config` payload with `ota_host`/`ota_base_url` is treated as `OTA_SET_HOST`.

### Example Manifest Response
```json
{
  "update_available": true,
  "version": "0.3.0",
  "firmware_url": "/firmware/FLOODGUARD-S3-01/0.3.0.bin",
  "force": false
}
```

### Example Host Change Command
```json
{
  "command": "OTA_SET_HOST",
  "ota_host": "http://flash.iotsoft.in"
}
```
