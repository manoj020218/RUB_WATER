Project: Solar Powered RUB Flood Alarm Monitoring System
1. Project Objective
Build a solar-powered flood alarm and monitoring system for Railway Under Bridge / low-lying road locations.

The system must work locally even if internet is down, while also reporting data to a VPS for real-time monitoring, audit logs, mobile app alerts, and administrative control.

The system will use:

ESP32-S3 controller
4G Wi-Fi router
MQTT primary communication
HTTP fallback communication
RS485 ultrasonic water level sensor
Two backup level switch inputs: 300mm and 500mm
Local siren
Red beacon light
Voice announcement speaker
Future boom barrier relay
React PWA
Capacitor Android app
Node.js backend
MongoDB database
FCM push notifications
2. High-Level Architecture
RS485 Ultrasonic Sensor
        ↓
ESP32-S3 Controller
        ↓ Wi-Fi
User's 4G Router
        ↓
VPS MQTT Broker
        ↓
Node.js Backend + MongoDB
        ↓
React PWA / Capacitor Android App
        ↓
FCM Push Notifications
Local control outputs:

Relay 1: Siren
Relay 2: Red beacon
Relay 3: Voice announcement trigger / amplifier power
Relay 4: Future boom barrier close/open integration
Relay 5: Spare
Backup inputs:

Input 1: 300mm water level switch, NO/COM
Input 2: 500mm water level switch, NO/COM
The system must continue working locally even if VPS, MQTT, HTTP, or internet is unavailable.

3. Hardware Assumptions
3.1 Controller
ESP32-S3 development board
External RS485 module for ultrasonic sensor
External relay module
Wi-Fi connection to local 4G router
Later upgrade may use:

LilyGO T-RS485 / industrial ESP32 RS485 controller
Firmware must be written in such a way that RS485 driver pins and relay pins are configurable.

3.2 Network
ESP32 connects to the user’s own 4G router over Wi-Fi.

Primary protocol: MQTT
Fallback protocol: HTTP REST
The 4G router may also support scheduled auto-reboot. Additionally, ESP32 should support scheduled self-reboot.

3.3 Sensor
Primary sensor:

RS485 ultrasonic water level sensor
Secondary sensors:

300mm NO/COM water level switch
500mm NO/COM water level switch
Switch logic:

NO/COM type
When water reaches switch level, contact closes
Input should be read using GPIO with pull-up or pull-down
Debounce required
3.4 Local outputs
Siren relay
Beacon relay
Voice announcement relay
Future boom barrier relay
Voice announcement must work locally without internet.

Recommended implementation:

ESP32 triggers local voice module or amplifier/announcement module
Prerecorded audio stored locally in voice module storage / module SD card
Do not depend on VPS audio playback for emergency announcement, because internet may be down during danger condition.

4. Local Control Logic
4.1 Water level calculation
The ultrasonic sensor reports distance.

System should use configured mounting height:

water_level_mm = sensor_mount_height_mm - measured_distance_mm
Configurable per location:

{
  "sensor_mount_height_mm": 1200,
  "alert_level_mm": 300,
  "danger_level_mm": 500,
  "danger_clear_level_mm": 450
}
4.2 Sensor validation
Implement filtering:

Read sensor every 2 seconds when active
Maintain rolling buffer of last 5 readings
Remove highest and lowest
Average remaining 3
Reject impossible jumps unless repeated
Invalid readings:

0
negative value
out of sensor range
same frozen value for long time
CRC/Modbus failure
If sensor fails, send:

sensor_status = FAULT
4.3 Reporting frequency logic
ESP32 should not report too frequently when no water is present.

Use dynamic reporting:

No water / normal dry condition:
  report every 3 minutes

Water detected but below 300mm:
  report every 10 seconds

Water >= 300mm:
  report every 5 seconds

Water >= 400mm or water level increasing fast:
  report every 2 seconds

Danger condition active:
  report every 2 seconds
4.4 Trigger delay to avoid false positive
Do not trigger siren immediately.

Use stable signal logic:

ALERT:
  water level >= 300mm continuously for 60 seconds
  OR 300mm switch closed continuously for 60 seconds

DANGER:
  water level >= 500mm continuously for 60 seconds
  OR 500mm switch closed continuously for 60 seconds
Recommended stronger logic:

Confirmed Danger:
  ultrasonic >= 500mm for 60 sec
  OR 500mm switch closed for 60 sec
This avoids false alarms caused by:

vehicle splash
temporary obstruction
person standing below sensor
animal movement
corner water wave
stone or debris
4.5 Danger activation
When danger is confirmed:

status = DANGER
siren relay ON pattern
beacon relay ON
voice announcement auto-repeat ON
future barrier relay CLOSE command optional
send MQTT danger event
send FCM notification to all authorized users
create audit log
Siren pattern:

10 sec ON
20 sec OFF
repeat while danger active
Voice pattern:

play prerecorded message every 30 sec
repeat while danger active unless muted
Beacon:

continuous ON while danger active
4.6 Alarm mute logic
Any logged user except Viewer can mute siren/voice from app.

When user mutes:

siren OFF
voice announcement OFF
beacon remains ON while danger active
audit log created
broadcast to all users
push notification to all users
Required audit message:

"Alarm muted by [user_name / login_id] at [timestamp] for [location_name]."
Mute must not change actual danger status.

4.7 Manual dry-run test
From mobile app / PWA, authorized user can run dry test:

Test siren
Test beacon
Test voice announcement
Test all outputs
Test FCM alert
Dry run must be clearly logged:

event_type = DRY_RUN
triggered_by = user_id
timestamp
location_id
outputs_tested
Dry run must not create actual danger incident.

4.8 Danger clear logic
Danger condition auto clears only after stable safe reading.

Danger clear condition:
  water level < 450mm continuously for 5 minutes
  AND 500mm switch open continuously for 5 minutes
When auto-clear happens:

status = NORMAL / ALERT depending level
siren OFF
voice OFF
beacon OFF if below alert threshold
future barrier relay OPEN optional
audit log created
broadcast to all users
push notification sent
4.9 Force clear by user
Authorized users may force clear with reason.

Required:

User must enter reason
Create audit log
Broadcast to all users
Push notification to all users
Keep sensor status visible
Example:

{
  "event_type": "FORCE_CLEAR",
  "location_id": "RUB-043",
  "user_id": "operator_12",
  "reason": "Site inspected physically. Water drained. Sensor stuck due to debris.",
  "timestamp": "2026-05-16T10:20:00+05:30"
}
5. Scheduled Auto-Reboot
Admin must be able to configure scheduled reboot.

Targets:

ESP32 controller daily reboot
4G router reboot support if router API/relay available
Minimum implementation:

ESP32 reboots daily at configured time
Configurable from dashboard:

{
  "daily_reboot_enabled": true,
  "daily_reboot_time": "03:30",
  "timezone": "Asia/Kolkata"
}
Firmware should:

download config from server
store config locally
reboot at scheduled time
skip reboot if danger condition active
delay reboot until danger clears
6. Communication Design
6.1 MQTT primary
MQTT broker already exists on VPS.

ESP32 should use MQTT first.

Topics:

rub/{device_id}/telemetry
rub/{device_id}/event
rub/{device_id}/heartbeat
rub/{device_id}/command
rub/{device_id}/command_ack
rub/{device_id}/config
rub/{device_id}/ota
Telemetry payload:

{
  "device_id": "RUB043-CTRL01",
  "location_id": "RUB043",
  "timestamp": "2026-05-16T10:30:00+05:30",
  "water_level_mm": 268,
  "distance_mm": 932,
  "status": "NORMAL",
  "primary_sensor_status": "OK",
  "switch_300mm": false,
  "switch_500mm": false,
  "battery_voltage": 12.7,
  "solar_voltage": 18.4,
  "wifi_rssi": -61,
  "router_online": true,
  "firmware_version": "1.0.0",
  "relay_status": {
    "siren": false,
    "beacon": false,
    "voice": false,
    "barrier": false
  }
}
Event payload:

{
  "device_id": "RUB043-CTRL01",
  "location_id": "RUB043",
  "event_type": "DANGER_CONFIRMED",
  "timestamp": "2026-05-16T10:30:00+05:30",
  "water_level_mm": 512,
  "reason": "Water level >= 500mm for 60 seconds",
  "source": "device"
}
Command payload from server to device:

{
  "command_id": "cmd_abc123",
  "command": "MUTE_ALARM",
  "issued_by": "user_123",
  "location_id": "RUB043",
  "timestamp": "2026-05-16T10:31:00+05:30"
}
Command ACK from device:

{
  "command_id": "cmd_abc123",
  "device_id": "RUB043-CTRL01",
  "status": "SUCCESS",
  "executed_at": "2026-05-16T10:31:02+05:30"
}
6.2 HTTP fallback
If MQTT fails:

ESP32 should send telemetry using HTTP POST
ESP32 should poll command API every 10–30 seconds
HTTP endpoints:

POST /api/device/telemetry
POST /api/device/event
GET  /api/device/{deviceId}/commands/pending
POST /api/device/commands/{commandId}/ack
GET  /api/device/{deviceId}/config
GET  /api/device/{deviceId}/firmware/latest
6.3 Offline behavior
If internet unavailable:

Local alarm logic must continue
Local siren/beacon/voice must work
Events stored in local memory queue
When internet returns, sync pending events
Store minimum offline queue:

last 500 events or more if storage available
7. Backend Requirements
7.1 Stack
Node.js 18+
Express.js or Fastify
MongoDB
MQTT client/subscriber
WebSocket / Socket.IO for live dashboard
FCM Admin SDK
JWT-based custom authentication
No Gmail login
FCM should work with custom login. Store FCM token per device/session.

7.2 Authentication
No Google/Gmail login.

Use custom login:

username/password
mobile number/password
department code/login id
JWT token after login.

Password storage:

bcrypt hash
Session/device tracking:

user_id
login_id
role
device_id
fcm_token
app_type: PWA / Android
last_seen
7.3 User hierarchy
Seeded first by developer/vendor.

Roles:

Vendor Super Admin
Vendor Monitoring User
Department Super Admin
Department Admin
Location Admin
Operator
Viewer
Auditor
Third Party Monitoring Company User
Hierarchy:

Vendor
  ↓
Department / Government body
  ↓
Region / Division
  ↓
Location / RUB site
  ↓
Users
Vendor can monitor all assigned locations.

Future third-party monitoring company can be assigned selected locations.

7.4 Permissions
Role	View	Mute	Force clear	Dry run	Add users	Add locations	Config device	OTA
Vendor Super Admin	Yes	Yes	Yes	Yes	Yes	Yes	Yes	Yes
Department Super Admin	Yes	Yes	Yes	Yes	Yes	Yes	Yes	Limited
Department Admin	Yes	Yes	Yes	Yes	Yes	Limited	Limited	No
Location Admin	Yes	Yes	Yes	Yes	Limited	No	Limited	No
Operator	Yes	Yes	Yes with reason	Yes	No	No	No	No
Viewer	Yes	No	No	No	No	No	No	No
Auditor	Yes	No	No	No	No	No	No	No
Third Party Monitoring	Yes	Depends	Depends	Depends	No	No	No	No
Viewer cannot mute.

Any mute, force clear, dry run, or manual command must be logged and broadcast.

7.5 Multi-user same login
System must allow multiple people to use same login if required.

But every app install/browser should have:

session_id
device_name
fcm_token
last_seen
When a command is issued, log:

login_id
role
session_id
device_name
IP address if available
timestamp
This way even shared login actions are still traceable to device/session.

8. MongoDB Collections
8.1 users
{
  "_id": "user_123",
  "login_id": "operator_rub043",
  "password_hash": "...",
  "name": "Operator RUB 043",
  "role": "OPERATOR",
  "vendor_id": "vendor_001",
  "department_id": "dept_001",
  "assigned_location_ids": ["RUB043"],
  "is_active": true,
  "created_at": "...",
  "updated_at": "..."
}
8.2 user_sessions
{
  "_id": "session_001",
  "user_id": "user_123",
  "login_id": "operator_rub043",
  "device_name": "Samsung Android",
  "app_type": "ANDROID",
  "fcm_token": "...",
  "last_seen": "...",
  "is_active": true
}
8.3 locations
{
  "_id": "RUB043",
  "name": "RUB 43",
  "description": "Railway Under Bridge 43",
  "department_id": "dept_001",
  "geo": {
    "lat": 0,
    "lng": 0
  },
  "sensor_mount_height_mm": 1200,
  "alert_level_mm": 300,
  "danger_level_mm": 500,
  "danger_clear_level_mm": 450,
  "is_active": true
}
8.4 devices
{
  "_id": "RUB043-CTRL01",
  "location_id": "RUB043",
  "device_type": "ESP32_S3",
  "firmware_version": "1.0.0",
  "hardware_version": "demo-v1",
  "mqtt_topic_base": "rub/RUB043-CTRL01",
  "last_seen": "...",
  "status": "ONLINE",
  "config": {
    "daily_reboot_enabled": true,
    "daily_reboot_time": "03:30",
    "reporting_profile": "dynamic"
  }
}
8.5 telemetry
Use time-series friendly structure.

{
  "device_id": "RUB043-CTRL01",
  "location_id": "RUB043",
  "timestamp": "...",
  "water_level_mm": 268,
  "distance_mm": 932,
  "status": "NORMAL",
  "switch_300mm": false,
  "switch_500mm": false,
  "battery_voltage": 12.7,
  "solar_voltage": 18.4,
  "wifi_rssi": -61,
  "relay_status": {
    "siren": false,
    "beacon": false,
    "voice": false,
    "barrier": false
  }
}
8.6 incidents
{
  "_id": "incident_001",
  "location_id": "RUB043",
  "device_id": "RUB043-CTRL01",
  "status": "ACTIVE",
  "started_at": "...",
  "ended_at": null,
  "max_water_level_mm": 612,
  "trigger_reason": "Ultrasonic >= 500mm for 60 sec",
  "auto_cleared": false,
  "force_cleared_by": null,
  "force_clear_reason": null
}
8.7 audit_logs
{
  "_id": "audit_001",
  "location_id": "RUB043",
  "event_type": "ALARM_MUTED",
  "performed_by": "user_123",
  "login_id": "operator_rub043",
  "session_id": "session_001",
  "device_name": "Samsung Android",
  "details": {
    "reason": "Operator muted siren after inspection",
    "previous_state": "ON",
    "new_state": "OFF"
  },
  "timestamp": "..."
}
8.8 firmware_versions
{
  "_id": "fw_esp32_1_0_1",
  "target": "ESP32_S3",
  "version": "1.0.1",
  "file_url": "https://server/firmware/esp32/1.0.1.bin",
  "sha256": "...",
  "mandatory": false,
  "release_notes": "Improved sensor filtering",
  "created_at": "..."
}
8.9 app_versions
{
  "_id": "app_android_1_0_3",
  "platform": "ANDROID",
  "version": "1.0.3",
  "apk_url": "https://server/apk/app-1.0.3.apk",
  "mandatory": false,
  "release_notes": "Added dry-run logs",
  "created_at": "..."
}
9. Mobile App / PWA Requirements
9.1 Technology
React
PWA support
Capacitor Android build
FCM push notification
Socket.IO / WebSocket live updates
JWT authentication
9.2 Main screens
Login screen
Login ID
Password
Remember device option
No Gmail login.

Location list screen
One user may monitor multiple locations.

Each location card:

Location name
Current status: NORMAL / ALERT / DANGER / OFFLINE
Current water level
Last update time
Battery status
Network status
Siren/beacon/voice status
Live location dashboard
Must show water visually like a vessel/tank.

UI idea:

Vertical vessel graphic
Water fill animation according to current level
Markers at 300mm and 500mm
Color:
  green = normal
  yellow/orange = alert
  red = danger
Display:

Current water level in mm
Distance reading
300mm switch status
500mm switch status
Battery voltage
Solar voltage
Device online/offline
Last heartbeat
Current incident status
Control panel
Buttons depending on permission:

Mute siren
Mute voice
Turn beacon ON/OFF
Run dry siren test
Run dry beacon test
Run dry voice test
Force clear incident with reason
Future: close/open boom barrier
All buttons require confirmation.

High-risk actions require reason:

Force clear
Manual barrier open during danger
Disable alarm
Audit log screen
Filters:

Location
Date range
Event type
User/login
Incident ID
Show:

Danger started
Danger cleared
Alarm muted
Alarm unmuted
Dry run
Force clear
Device offline
Device online
OTA update
Config changed
Incident report screen
For each incident:

Start time
End time
Max water level
Who muted alarm
Who force cleared
Duration
Sensor readings
Timeline
Export PDF/Excel later
10. FCM Push Notification Rules
FCM must be integrated for:

PWA web push
Android app push
Push to all users assigned to location.

Events requiring push:

ALERT started
DANGER confirmed
Alarm muted
Alarm unmuted
Force clear
Danger auto cleared
Device offline
Device online
Sensor fault
Battery low
Dry run started/completed
Example notification:

DANGER: RUB 43 water level crossed 500mm.
Siren and voice announcement activated.
Mute notification:

RUB 43 alarm muted by operator_rub043 at 10:32 AM.
Force clear notification:

RUB 43 incident force-cleared by location_admin with reason: Site inspected.
11. OTA Firmware Update
11.1 Firmware version control
ESP32 firmware must report:

firmware_version
hardware_version
build_date
device_id
Backend must provide latest firmware info.

ESP32 OTA flow:

Device checks latest firmware on boot and daily
Admin can trigger OTA from dashboard
Device downloads firmware over HTTP/HTTPS
Verify checksum
Apply update
Reboot
Report success/failure
Do not perform OTA during active danger.

If DANGER active:
  postpone OTA
11.2 App version control
Backend stores Android APK versions.

App should check latest version after login.

If mandatory:

Block app usage until update
If optional:

Show update available message
PWA should show build version in settings.

12. ESP32 Firmware Modules
Recommended firmware structure:

/src
  main.cpp
  config_manager.cpp
  wifi_manager.cpp
  mqtt_client.cpp
  http_fallback.cpp
  sensor_rs485.cpp
  switch_inputs.cpp
  relay_controller.cpp
  alarm_state_machine.cpp
  telemetry_manager.cpp
  command_handler.cpp
  ota_manager.cpp
  local_event_queue.cpp
  time_sync.cpp
  watchdog.cpp
12.1 State machine
States:

NORMAL
WATER_DETECTED
ALERT_PENDING
ALERT
DANGER_PENDING
DANGER
MUTED_DANGER
CLEAR_PENDING
SENSOR_FAULT
OFFLINE_LOCAL_MODE
12.2 Relay behavior
Siren relay:
  controlled by danger state and mute state

Beacon relay:
  ON during danger, not muted by normal mute

Voice relay:
  repeats during danger unless muted

Barrier relay:
  future support
12.3 Watchdog
Enable hardware/software watchdog.

If firmware hangs:

auto reboot
log reboot reason
12.4 Time sync
Use:

NTP when internet available
RTC optional later
If no internet:

continue local logic
timestamp local events with last known time + uptime
sync later
13. Security Requirements
JWT authentication
bcrypt passwords
Role-based permissions
MQTT username/password or token
Device authentication token
HTTPS for HTTP fallback
Do not expose raw MQTT broker publicly without auth
Audit every control action
Device commands must be validated:

command_id
device_id
location_id
issued_by
permission check
expiry time
Command expiry:

Ignore command older than 60 seconds unless config/OTA command
14. Regression Test Checklist
Firmware tests
Sensor reading valid
Sensor reading invalid
RS485 timeout
300mm switch debounce
500mm switch debounce
Alert after 60 sec stable
No alert for 10 sec splash
Danger after 60 sec stable
Danger clear after 5 min stable safe level
Mute siren
Mute voice
Beacon remains ON during danger
Dry run does not create real incident
MQTT connected telemetry
MQTT disconnected HTTP fallback
Internet down local alarm works
Offline events sync after reconnect
Scheduled reboot works
Scheduled reboot skipped during danger
OTA skipped during danger
OTA success
OTA failure rollback/report
Backend tests
Login works
Role permissions work
Viewer cannot mute
Operator can mute
Force clear requires reason
Audit log created for every command
FCM token saved
Push sent to all assigned users
Multiple devices under same login receive alert
Vendor sees all assigned locations
Department sees only its locations
Third-party monitor sees assigned locations only
Telemetry updates current status
Incident created on danger
Incident auto closes
Incident force clears with reason
PWA/App tests
Login
Location list
Live water vessel UI
Real-time updates
Offline indicator
Push notification received
Mute command
Dry run command
Force clear command
Audit timeline visible
Android Capacitor build
PWA installable
FCM token refresh handling
15. MVP Delivery Plan
Phase 1: Firmware local demo
ESP32 reads RS485 sensor
Reads 300mm and 500mm switch inputs
Implements delayed trigger logic
Controls siren/beacon/voice relays
Prints telemetry over serial
Phase 2: MQTT + VPS
MQTT telemetry
MQTT command receive
HTTP fallback
MongoDB telemetry storage
Basic backend APIs
Phase 3: React PWA
Login
Location dashboard
Water vessel UI
Live status
Manual dry run
Mute
Force clear
Audit logs
Phase 4: Android Capacitor + FCM
Capacitor Android build
FCM Android push
PWA web push
Version check
Phase 5: OTA and production hardening
Firmware OTA
APK version pipeline
Device config management
Scheduled reboot
Offline queue sync
Regression tests
16. Important Implementation Rule
The local ESP32 controller is the safety authority.

The VPS/app is for:

monitoring
notifications
audit
configuration
manual commands
OTA
But the site must still work if internet is down:

water detection
danger confirmation
siren
beacon
voice announcement
auto clear
local safety logic
Never make emergency warning dependent on cloud availability.

17. Final Hardware Output Mapping Example
Developer should keep this configurable, but initial mapping can be:

GPIO_RS485_RX
GPIO_RS485_TX
GPIO_RS485_DE_RE

GPIO_SWITCH_300MM
GPIO_SWITCH_500MM

GPIO_RELAY_SIREN
GPIO_RELAY_BEACON
GPIO_RELAY_VOICE
GPIO_RELAY_BARRIER
GPIO_RELAY_SPARE

ADC_BATTERY_VOLTAGE
ADC_SOLAR_VOLTAGE
Use config.h or remote config to change pin mapping later.

18. Final Notes for Developer
Build this as a government/audit-grade system, not just an IoT demo.

Every action must answer:

What happened?
Where happened?
When happened?
Who acted?
From which login/session/device?
What was the sensor value?
Was it automatic or manual?
Was notification sent?
Was the incident cleared automatically or forcefully?
The system must support:

multiple locations
multiple users
multiple users using same login
vendor-level monitoring
department-level hierarchy
future third-party monitoring company
future boom barrier integration
future industrial controller upgrade
This is the base project specification.

NOTE--- 
project commercial name- FloodGuard by Jenix
Use this for app:
FloodGuard by Jenix
And inside dashboard/project documents:
Jenix FloodGuard — RUB Water Level Monitoring & Alarm System
For Hindi users:

जल सुरक्षा निगरानी प्रणाली
For Play Store title:
FloodGuard by Jenix
For tagline:
Real-time RUB flood monitoring, alerts and audit logs

**IMPORTANT POINT - Project Dashboard Must be fully Responsive Mobile/Tab View Design First**
also check in firmware if [6:56 am, 17/5/2026] manoj kumar jain: 1. Wi-Fi connected or not
2. Gateway reachable or not
3. Internet available or not
4. SIM status
5. SIM signal level
6. MAC bind / allowed device check
7. Auto reboot router if internet is not available
8. Report status to VPS using MQTT
[6:58 am, 17/5/2026] manoj kumar jain: SIM inserted: yes/no
SIM registered: yes/no
4G connected: yes/no
Signal: RSSI / RSRP / bars
Operator name
WAN IP
Network mode: 2G/3G/4G

Reserve 2 pin for SIM 800L for backup sms channel 

Make two pin low at danger time to trigger RF Remote circuit so that relay based Boom can be operated exit and entry side
*VPS end at FGServer.jenix.in. ( In case VPS has to shift for new address)* 

*MongoDB , clear all reading if with in 24 hr no water is detected and keep one reading with remarks as average of whole day and show day as "no water day"* 

If water detected then keep only those water detected readings in DB ..