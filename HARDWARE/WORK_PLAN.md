# HARDWARE Work Plan

Scope owner: ESP32-S3 firmware and field I/O behavior.
wifi AP SSID: JNX_FGXXXXXX
wifi AP apssword : JNX654321

BT ID - JNX-FGXXXX ( xxxx last 4 digit of MAC ID)
PID - FLOODGUARD-S3-01 with detail store in system as used
future PID for LilligoT  - FLOODGUARD-LT-01

IS1- for RS485 module US sensor 
IS2- TTL sensor 
IS3 - DRY sensor GND in
IS4 = dry sensor Power in

AA- 4G Router 
AB- SIM Backup chanel

BA- S3
BB- Lilligo T

CA - Custome CAP sensor 2 lavel 
CB - custome 3 level sensor 

DA- 4 ch relay Board 
DB - RF Out Soft signal 

PV- 12V DC power 
PS- SOlar Powered 

PA - Aux out Amplifiler 

GI - Input Dry Type 
GW - web trigger input




## A. Firmware Module Deliverables
- `sensor_rs485`: ultrasonic polling + CRC/timeout/error handling
- `switch_inputs`: 300mm and 500mm NO/COM debounce logic
- `alarm_state_machine`: NORMAL, ALERT, DANGER, MUTED, CLEAR_PENDING, SENSOR_FAULT
- `relay_controller`: siren, beacon, voice, barrier reserve, spare reserve
- `telemetry_manager`: dynamic reporting intervals by risk level
- `mqtt_client`: primary uplink
- `http_fallback`: fallback uplink + command polling
- `local_event_queue`: offline buffering + replay
- `ota_manager`: update flow with danger-state protection
- `watchdog`: reboot recovery and reason logging

## B. Safety Logic Requirements
- Alert trigger after stable threshold for 60 seconds
- Danger trigger after stable threshold for 60 seconds
- Auto clear after stable safe state for 5 minutes
- Mute turns off siren/voice but beacon remains active during danger

## C. Network and SIM Diagnostics
- Wi-Fi connected yes/no
- Gateway reachable yes/no
- Internet available yes/no
- SIM inserted and registered status
- 4G connected status
- Signal indicators: RSSI/RSRP/bars
- Operator and network mode
- WAN IP reporting
- MAC bind/allow-list check

## D. Hardware Reserve Pins
- Reserve 2 GPIO for SIM800L backup SMS channel
- Reserve 2 GPIO for RF remote trigger for boom barrier control

## E. Acceptance Checklist
- Local danger alarm works with internet disconnected
- Offline events replay after connectivity returns
- Diagnostics telemetry visible at VPS
- Relay behavior matches safety matrix

