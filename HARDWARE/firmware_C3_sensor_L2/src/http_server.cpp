#include "http_server.h"
#include "config.h"
#include "storage.h"
#include "led.h"
#include <WebServer.h>
#include <WiFi.h>
#include <Update.h>

static WebServer    server(HTTP_PORT);
static DeviceConfig *g_cfg   = nullptr;
static AppState     *g_state = nullptr;
static bool         g_ota_success = false;
static bool         g_ota_failed = false;
static size_t       g_ota_written_bytes = 0;
static String       g_ota_status = "";

// ─── WiFi idle sleep tracking ─────────────────────────────────────────────────
static uint32_t g_last_activity_ms = 0;   // millis() of last valid HTTP activity

bool webserver_wifi_should_sleep() {
    if (g_cfg && g_cfg->wifi_mode == FG_WIFI_MODE_STA) return false;
    if (WiFi.status() == WL_CONNECTED) return false;
    if (g_last_activity_ms == 0) return false;
    return (millis() - g_last_activity_ms) >= WIFI_IDLE_TIMEOUT_MS;
}

uint32_t webserver_wifi_sleep_in_s() {
    if (g_cfg && g_cfg->wifi_mode == FG_WIFI_MODE_STA) return 0;
    if (WiFi.status() == WL_CONNECTED) return 0;
    if (g_last_activity_ms == 0) return WIFI_IDLE_TIMEOUT_MS / 1000;
    const uint32_t elapsed = millis() - g_last_activity_ms;
    if (elapsed >= WIFI_IDLE_TIMEOUT_MS) return 0;
    return (WIFI_IDLE_TIMEOUT_MS - elapsed) / 1000;
}

// ─── Session ──────────────────────────────────────────────────────────────────
static char     g_token[17]          = "";   // 16 hex chars + null
static uint32_t g_token_refreshed_ms = 0;   // millis() at last create/refresh

static void session_create() {
    uint32_t a = esp_random(), b = esp_random();
    snprintf(g_token, sizeof(g_token), "%08X%08X", a, b);
    g_token_refreshed_ms = millis();
}

static bool session_valid() {
    if (g_token[0] == '\0') return false;
    // Overflow-safe: use subtraction (same pattern as relay/sensor timers)
    if ((millis() - g_token_refreshed_ms) >= SESSION_TIMEOUT_MS) {
        g_token[0] = '\0'; return false;
    }
    String cookie = server.header("Cookie");
    String needle = String("sess=") + g_token;
    if (cookie.indexOf(needle) < 0) return false;
    g_token_refreshed_ms = millis();   // refresh session
    g_last_activity_ms   = millis();   // reset WiFi idle timer
    return true;
}

static void require_auth() {
    server.sendHeader("Location", "/login");
    server.send(302, "text/plain", "");
}

// ─── JSON helpers ─────────────────────────────────────────────────────────────
static void send_json(int code, const String &body) {
    server.send(code, "application/json", body);
}

static String ok_json()              { return "{\"ok\":true}"; }
static String err_json(const char *msg) {
    return String("{\"ok\":false,\"error\":\"") + msg + "\"}";
}

static void ota_reset_state() {
    g_ota_success = false;
    g_ota_failed = false;
    g_ota_written_bytes = 0;
    g_ota_status = "";
}

static String ota_error_message(const char *prefix) {
    return String(prefix) + " (code " + String(Update.getError()) + ")";
}

static void ota_fail(const String &message) {
    g_ota_success = false;
    g_ota_failed = true;
    g_ota_status = message;
}

static String parse_json_string(const String &body, const char *key) {
    int idx = body.indexOf(key);
    if (idx < 0) return "";
    idx = body.indexOf('"', body.indexOf(':', idx) + 1) + 1;
    if (idx <= 0) return "";
    int end = body.indexOf('"', idx);
    if (end < 0) return "";
    return body.substring(idx, end);
}

// ─── HTML pages ───────────────────────────────────────────────────────────────
static const char LOGIN_HTML[] PROGMEM = R"FGSENS(<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>FgSens Login</title>
<style>
*{box-sizing:border-box}
body{font-family:sans-serif;background:#0d6e56;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;padding:16px}
.card{background:#fff;border-radius:12px;padding:32px 24px;width:100%;max-width:320px;box-shadow:0 4px 20px rgba(0,0,0,.3)}
h2{margin:0 0 6px;color:#0d6e56;font-size:20px;text-align:center}
.sub{text-align:center;color:#aaa;font-size:12px;margin-bottom:24px}
label{font-size:13px;color:#555;display:block;margin-bottom:4px}
.pw-wrap{position:relative}
input{width:100%;padding:11px 40px 11px 12px;border:1px solid #ccc;border-radius:8px;font-size:15px;outline:none}
input:focus{border-color:#0d6e56}
.eye{position:absolute;right:10px;top:50%;transform:translateY(-50%);cursor:pointer;font-size:18px;user-select:none;line-height:1}
.btn{width:100%;margin-top:20px;padding:12px;background:#0d6e56;color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer}
.btn:hover{background:#0b5c49}
.err{color:#dc3545;font-size:13px;text-align:center;margin-top:10px;min-height:18px}
</style>
</head>
<body>
<div class="card">
<h2>&#128167; FloodGuard Sensor</h2>
<div class="sub">%DEVNAME%</div>
<form method="POST" action="/login">
<label>Password</label>
<div class="pw-wrap">
<input id="pw" type="password" name="password" autocomplete="current-password" required>
<span class="eye" onclick="var i=document.getElementById('pw');i.type=i.type=='password'?'text':'password'">&#128065;</span>
</div>
<button class="btn" type="submit">Login</button>
<div class="err">%ERR%</div>
</form>
</div>
</body></html>)FGSENS";

static const char CONFIG_HTML[] PROGMEM = R"FGSENS(<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>FgSens Config</title>
<style>
*{box-sizing:border-box}
body{font-family:sans-serif;background:#f0f4f8;margin:0;padding:12px}
.card{background:#fff;border-radius:12px;padding:18px;margin-bottom:14px;box-shadow:0 2px 8px rgba(0,0,0,.09)}
h2{margin:0 0 14px;color:#0d6e56;font-size:18px}
h3{margin:0 0 12px;color:#333;font-size:14px;font-weight:700;border-bottom:1px solid #eee;padding-bottom:6px}
.row{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-size:13px}
.lbl{color:#666}
.val{font-weight:600;color:#222}
.badge{display:inline-block;padding:2px 10px;border-radius:10px;font-size:11px;font-weight:700}
.ok{background:#d4edda;color:#155724}
.fault{background:#f8d7da;color:#721c24}
.relay-on{background:#cce5ff;color:#004085}
.relay-off{background:#e2e3e5;color:#383d41}
label{display:block;font-size:13px;color:#555;margin-bottom:4px;margin-top:8px}
input[type=number]{width:100%;padding:9px 12px;border:1px solid #ccc;border-radius:8px;font-size:15px}
input[type=number]:focus{outline:none;border-color:#0d6e56}
input[type=file]{font-size:13px;margin-bottom:4px}
.btn-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
button{padding:10px 18px;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer}
.btn-green{background:#0d6e56;color:#fff}
.btn-green:hover{background:#0b5c49}
.btn-red{background:#dc3545;color:#fff}
.btn-red:hover{background:#c82333}
.btn-outline{background:#fff;color:#0d6e56;border:1px solid #0d6e56}
.btn-outline:hover{background:#f0faf6}
.msg{font-size:12px;margin-top:8px;padding:7px 10px;border-radius:6px;display:none}
.msg.ok{background:#d4edda;color:#155724;display:block}
.msg.err{background:#f8d7da;color:#721c24;display:block}
#ota-wrap{background:#e9ecef;border-radius:4px;height:7px;margin-top:8px}
#ota-bar{background:#0d6e56;height:7px;border-radius:4px;width:0;transition:width .3s}
#ota-pct{font-size:11px;text-align:right;color:#555;margin-top:2px}
p.hint{font-size:12px;color:#777;margin:0 0 10px}
a.logout{float:right;font-size:12px;color:#dc3545;text-decoration:none}
</style>
</head>
<body>
<div class="card">
<h2>&#128167; FloodGuard Sensor <a class="logout" href="/logout">Logout</a></h2>
<div class="row"><span class="lbl">Device Name</span><span class="val" id="dev-name">-</span></div>
<div class="row"><span class="lbl">BLE ID</span><span class="val" id="ble-id">-</span></div>
<div class="row"><span class="lbl">Firmware</span><span class="val" id="fw-ver">-</span></div>
</div>

<div class="card">
<h3>Live Readings</h3>
<div class="row"><span class="lbl">Sensor</span><span class="val"><span class="badge ok" id="ss">OK</span></span></div>
<div class="row"><span class="lbl">Raw Distance</span><span class="val"><span id="rd">-</span> mm</span></div>
<div class="row"><span class="lbl">Zero Distance</span><span class="val"><span id="zd">-</span> mm</span></div>
<div class="row"><span class="lbl">Water Level</span><span class="val"><span id="wl">-</span> mm</span></div>
<div class="row"><span class="lbl">Relay 1 (Alert)</span><span class="val"><span class="badge relay-off" id="r1">OFF</span></span></div>
<div class="row"><span class="lbl">Relay 2 (Danger)</span><span class="val"><span class="badge relay-off" id="r2">OFF</span></span></div>
<div class="row"><span class="lbl">Level 1 Threshold</span><span class="val"><span id="th1">-</span> mm</span></div>
<div class="row"><span class="lbl">Level 2 Threshold</span><span class="val"><span id="th2">-</span> mm</span></div>
<div class="row"><span class="lbl">Uptime</span><span class="val" id="up">-</span></div>
<div class="row"><span class="lbl">Next Auto-Restart</span><span class="val" id="nar">-</span></div>
</div>

<div class="card">
<h3>Calibration</h3>
<p class="hint">Point sensor at dry ground. Confirm the reading below is stable, then click Set Zero.</p>
<div class="row" style="background:#f8f9fa;border-radius:8px;padding:10px 12px;margin-bottom:12px">
<span class="lbl" style="font-size:13px;color:#444">Current Sensor Reading</span>
<span class="val" style="font-size:20px;color:#0d6e56"><span id="cal-rd">--</span> <span style="font-size:13px;color:#888">mm</span>&nbsp;&nbsp;<span class="badge" id="cal-ss" style="font-size:11px">--</span></span>
</div>
<button class="btn-outline" onclick="setZero()">Set Current Value as Zero Reference</button>
<div id="zero-msg" class="msg"></div>
</div>

<div class="card">
<h3>Thresholds &amp; Delays</h3>
<div style="background:#fff8e1;border:1px solid #ffe082;border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:13px">
  <span style="color:#555">Zero Reference (sensor → dry ground):</span>&nbsp;
  <strong id="zero-ref-display" style="color:#0d6e56;font-size:15px">-- mm</strong>
  <span style="color:#888;font-size:12px;display:block;margin-top:3px">Level 1 and Level 2 must each be <b>less than</b> this value to be reachable.</span>
</div>
<label>Level 1 Alert Threshold (mm)</label>
<input type="number" id="l1" min="10" max="2000" value="200" oninput="updateHints()">
<div id="l1-hint" style="font-size:12px;color:#0d6e56;margin:3px 0 6px 2px"></div>
<label>Level 2 Danger Threshold (mm)</label>
<input type="number" id="l2" min="10" max="2000" value="400" oninput="updateHints()">
<div id="l2-hint" style="font-size:12px;color:#dc3545;margin:3px 0 6px 2px"></div>
<label>Trigger Delay (s) — relay ON only after level stays above threshold for this long</label>
<input type="number" id="trig" min="1" max="3600" value="60">
<label>Clear Delay (s) — relay OFF only after level stays below threshold for this long</label>
<input type="number" id="clr" min="1" max="3600" value="300">
<label>Sensor Read Interval (ms) — how often the ultrasonic sensor is polled</label>
<input type="number" id="sens_ms" min="100" max="180000" value="1000" oninput="updateSensHint()">
<div id="sens-hint" style="font-size:12px;color:#0d6e56;margin:3px 0 6px 2px"></div>
<label>Auto-Restart Interval (h) — 0 = disabled &nbsp;|&nbsp; 1–168 h = reboot every N hours (all settings saved in memory, nothing lost)</label>
<input type="number" id="ar_h" min="0" max="168" value="24" oninput="updateArHint()">
<div id="ar-hint" style="font-size:12px;color:#0d6e56;margin:3px 0 6px 2px"></div>
<div class="btn-row">
<button class="btn-green" onclick="saveConfig()">Save</button>
<button class="btn-red" onclick="doReboot()">Reboot Device</button>
</div>
<div id="cfg-msg" class="msg"></div>
</div>

<div class="card">
<h3>Network Access</h3>
<div class="row"><span class="lbl">Current Mode</span><span class="val"><span id="wifi-mode-badge" class="badge ok">AP Only</span></span></div>
<div class="row"><span class="lbl">AP SSID</span><span class="val" id="ap-ssid">-</span></div>
<div class="row"><span class="lbl">AP IP</span><span class="val" id="ap-ip">-</span></div>
<div class="row"><span class="lbl">LAN Status</span><span class="val"><span id="lan-badge" class="badge fault">Not Connected</span></span></div>
<div class="row"><span class="lbl">LAN SSID</span><span class="val" id="lan-ssid-live">-</span></div>
<div class="row"><span class="lbl">LAN IP</span><span class="val" id="lan-ip">-</span></div>
<div class="row"><span class="lbl">LAN WebUI</span><span class="val" id="lan-url">-</span></div>
<div class="row"><span class="lbl">AP Recovery Window</span><span class="val" id="ap-recovery">-</span></div>
<div id="ssid-status-row" class="row" style="margin-bottom:12px">
  <span class="lbl">AP SSID Visibility</span>
  <span class="val"><span id="ssid-badge" class="badge ok">Visible</span></span>
</div>
<p class="hint" id="ssid-hint">Hide the SSID after installation so it does not appear in public WiFi scans. The BLE name (<span id="ble-id2">FgSensXXXXXX</span>) is always visible — use a BLE scanner to identify the device, then connect manually by typing the SSID. To force SSID visible without the app: hold the BOOT button on the board while powering on.</p>
<p class="hint">LAN mode is only for OTA access. After every reboot in LAN OTA mode, the AP stays visible for a short recovery window so RESET gives you a local fallback path.</p>
<label>LAN SSID (for OTA mode)</label>
<input type="text" id="sta-ssid" maxlength="32" autocomplete="off">
<label>LAN Password</label>
<div class="pw-wrap"><input id="sta-pw" type="password" maxlength="64" autocomplete="off"><span class="eye" onclick="var i=document.getElementById('sta-pw');i.type=i.type=='password'?'text':'password'">&#128065;</span></div>
<div class="btn-row">
<button class="btn-green" onclick="saveLanConfig()">Use LAN For OTA</button>
<button class="btn-outline" onclick="switchToApMode()">Switch Back To AP Mode</button>
<button id="ssid-btn" class="btn-outline" onclick="toggleSsid()">Hide SSID</button>
</div>
<div id="wifi-msg" class="msg"></div>
<div id="ssid-msg" class="msg"></div>
</div>

<div class="card">
<h3>Change Password</h3>
<p class="hint">Changes the login password stored on this device. You will need the new password on next login.</p>
<label>Current Password</label>
<div class="pw-wrap"><input id="cp-cur" type="password" autocomplete="current-password"><span class="eye" onclick="var i=document.getElementById('cp-cur');i.type=i.type=='password'?'text':'password'">&#128065;</span></div>
<label>New Password (4–31 characters)</label>
<div class="pw-wrap"><input id="cp-new" type="password" autocomplete="new-password"><span class="eye" onclick="var i=document.getElementById('cp-new');i.type=i.type=='password'?'text':'password'">&#128065;</span></div>
<div class="btn-row"><button class="btn-green" onclick="changePassword()">Change Password</button></div>
<div id="cp-msg" class="msg"></div>
</div>

<div class="card">
<h3>Firmware Update (OTA)</h3>
<p class="hint">Select .bin file and upload. Device reboots automatically after success.</p>
<input type="file" id="ota-file" accept=".bin">
<div class="btn-row">
<button id="ota-upload-btn" class="btn-outline" onclick="uploadOta()">Upload Firmware</button>
</div>
<div id="ota-wrap"><div id="ota-bar"></div></div>
<div id="ota-pct"></div>
<div id="ota-msg" class="msg"></div>
</div>

<script>
function showMsg(id,txt,ok){
  var e=document.getElementById(id);
  e.textContent=txt;
  e.className='msg '+(ok?'ok':'err');
  setTimeout(function(){e.className='msg';},5000);
}
function poll(){
  fetch('/api/status').then(function(r){return r.json();}).then(function(d){
    document.getElementById('dev-name').textContent=d.device_name;
    document.getElementById('ble-id').textContent=d.ble_id;
    document.getElementById('ble-id2').textContent=d.ble_id;
    document.getElementById('fw-ver').textContent=d.firmware_version+' ('+d.firmware_date+')';
    document.getElementById('ap-ssid').textContent=d.device_name;
    document.getElementById('ap-ip').textContent=d.ap_ip||'-';
    document.getElementById('lan-ssid-live').textContent=d.sta_ssid||'-';
    document.getElementById('lan-ip').textContent=d.lan_ip||'-';
    var lanUrl=document.getElementById('lan-url');
    if(d.lan_ip){lanUrl.innerHTML='<a href="http://'+d.lan_ip+'/" target="_blank" rel="noopener">http://'+d.lan_ip+'/</a>';}
    else{lanUrl.textContent='-';}
    var modeBadge=document.getElementById('wifi-mode-badge');
    if(d.wifi_mode==='LAN_OTA'){modeBadge.textContent='LAN OTA';modeBadge.className='badge ok';}
    else if(d.wifi_mode==='AP_FALLBACK'){modeBadge.textContent='AP Fallback';modeBadge.className='badge fault';}
    else{modeBadge.textContent='AP Only';modeBadge.className='badge ok';}
    var lanBadge=document.getElementById('lan-badge');
    if(d.sta_connected){lanBadge.textContent='Connected';lanBadge.className='badge ok';}
    else{lanBadge.textContent='Not Connected';lanBadge.className='badge fault';}
    var recovery=document.getElementById('ap-recovery');
    if(d.ap_recovery_in_s>0){recovery.textContent=d.ap_recovery_in_s+' s';}
    else if(d.wifi_mode==='LAN_OTA'&&d.ap_active){recovery.textContent='Available';}
    else if(d.wifi_mode==='LAN_OTA'){recovery.textContent='Closed';}
    else{recovery.textContent='Always available';}
    var sb=document.getElementById('ssid-badge');
    var btn=document.getElementById('ssid-btn');
    if(d.ssid_hidden){sb.textContent='Hidden';sb.className='badge fault';btn.textContent='Show SSID';}
    else{sb.textContent='Visible';sb.className='badge ok';btn.textContent='Hide SSID';}
    document.getElementById('rd').textContent=d.raw_distance_mm;
    document.getElementById('cal-rd').textContent=d.raw_distance_mm;
    var cs=document.getElementById('cal-ss');
    cs.textContent=d.sensor_status;
    cs.className='badge '+(d.sensor_status==='OK'?'ok':'fault');
    document.getElementById('zd').textContent=d.zero_distance_mm;
    document.getElementById('zero-ref-display').textContent=d.zero_distance_mm+' mm';
    document.getElementById('wl').textContent=d.water_level_mm;
    document.getElementById('th1').textContent=d.level1_threshold_mm;
    document.getElementById('th2').textContent=d.level2_threshold_mm;
    var ss=document.getElementById('ss');
    ss.textContent=d.sensor_status;
    ss.className='badge '+(d.sensor_status==='OK'?'ok':'fault');
    var r1=document.getElementById('r1');
    r1.textContent=d.relay1?'ON':'OFF';
    r1.className='badge '+(d.relay1?'relay-on':'relay-off');
    var r2=document.getElementById('r2');
    r2.textContent=d.relay2?'ON':'OFF';
    r2.className='badge '+(d.relay2?'relay-on':'relay-off');
    var focused=document.activeElement;
    function setIfUnfocused(id,v){if(document.getElementById(id)!==focused)document.getElementById(id).value=v;}
    setIfUnfocused('l1',d.level1_threshold_mm);
    setIfUnfocused('l2',d.level2_threshold_mm);
    setIfUnfocused('trig',d.trigger_delay_s);
    setIfUnfocused('clr',d.clear_delay_s);
    setIfUnfocused('sens_ms',d.sensor_interval_ms);
    setIfUnfocused('ar_h',d.auto_restart_hours);
    setIfUnfocused('sta-ssid',d.sta_ssid||'');
    updateSensHint();
    updateArHint();
    var u=d.uptime_seconds;
    var h=Math.floor(u/3600),m=Math.floor((u%3600)/60),s=u%60;
    document.getElementById('up').textContent=(h?h+'h ':'')+( m?m+'m ':'')+s+'s';
    var nar=document.getElementById('nar');
    if(d.auto_restart_hours===0){nar.textContent='Disabled';}
    else{var rs=d.restart_in_s,rh=Math.floor(rs/3600),rm=Math.floor((rs%3600)/60);nar.textContent=(rh?rh+'h ':'')+rm+'m';}
    updateHints();
  }).catch(function(){});
  setTimeout(poll,2000);
}
function updateSensHint(){
  var v=parseInt(document.getElementById('sens_ms').value)||0;
  var h=document.getElementById('sens-hint');
  if(v<100||v>180000){h.style.color='#dc3545';h.textContent='Must be 100 – 180,000 ms (3 min max)';return;}
  h.style.color='#0d6e56';
  var s=(v/1000).toFixed(v<1000?1:0);
  h.textContent='Sensor polled every '+s+' s — lower = more responsive, higher = cooler device';
}
function updateArHint(){
  var v=parseInt(document.getElementById('ar_h').value);
  var h=document.getElementById('ar-hint');
  if(isNaN(v)||v<0||v>168){h.style.color='#dc3545';h.textContent='Must be 0–168 h';return;}
  if(v===0){h.style.color='#888';h.textContent='Auto-restart disabled — device runs until manually rebooted';return;}
  var d=Math.floor(v/24),r=v%24;
  h.style.color='#0d6e56';
  h.textContent='Device restarts every '+(d?d+'d ':'')+( r?r+'h ':'')+' — settings restored from memory automatically';
}
function updateHints(){
  var zero=parseInt(document.getElementById('zd').textContent)||0;
  var l1=parseInt(document.getElementById('l1').value)||0;
  var l2=parseInt(document.getElementById('l2').value)||0;
  var h1=document.getElementById('l1-hint');
  var h2=document.getElementById('l2-hint');
  if(zero>0&&l1>0){
    if(l1>=zero){
      h1.style.color='#dc3545';
      h1.textContent='Warning: '+l1+' mm ≥ Zero ('+zero+' mm) — unreachable. Max allowed: '+(zero-1)+' mm';
    } else {
      h1.style.color='#0d6e56';
      h1.textContent='Relay 1 alerts when water rises '+l1+' mm above dry ground (sensor reads ≤'+(zero-l1)+' mm)';
    }
  } else { h1.textContent=''; }
  if(zero>0&&l2>0){
    if(l2>=zero){
      h2.style.color='#dc3545';
      h2.textContent='Warning: '+l2+' mm ≥ Zero ('+zero+' mm) — unreachable. Max allowed: '+(zero-1)+' mm';
    } else {
      h2.style.color='#dc3545';
      h2.textContent='Relay 2 danger when water rises '+l2+' mm above dry ground (sensor reads ≤'+(zero-l2)+' mm)';
    }
  } else { h2.textContent=''; }
}
function setZero(){
  fetch('/api/set-zero',{method:'POST'}).then(function(r){return r.json();}).then(function(d){
    if(d.ok){
      showMsg('zero-msg','Zero saved. Checking thresholds…',true);
      setTimeout(function(){
        fetch('/api/status').then(function(r){return r.json();}).then(function(s){
          var z=s.zero_distance_mm;
          document.getElementById('zd').textContent=z;
          document.getElementById('zero-ref-display').textContent=z+' mm';
          var l1=parseInt(document.getElementById('l1').value)||0;
          var l2=parseInt(document.getElementById('l2').value)||0;
          var changed=false;
          if(l1>=z){var nl1=Math.max(10,Math.round(z*0.3));document.getElementById('l1').value=nl1;changed=true;}
          if(l2>=z){var nl2=Math.max(20,Math.round(z*0.6));document.getElementById('l2').value=nl2;changed=true;}
          updateHints();
          if(changed)showMsg('zero-msg','Zero saved. Thresholds auto-adjusted to fit new range.',true);
          else showMsg('zero-msg','Zero level saved successfully.',true);
        });
      },300);
    } else {
      showMsg('zero-msg','Error: '+d.error,false);
    }
  }).catch(function(){showMsg('zero-msg','Request failed',false);});
}
function saveConfig(){
  var l1=parseInt(document.getElementById('l1').value);
  var l2=parseInt(document.getElementById('l2').value);
  var trig=parseInt(document.getElementById('trig').value);
  var clr=parseInt(document.getElementById('clr').value);
  var sensMs=parseInt(document.getElementById('sens_ms').value);
  var arH=parseInt(document.getElementById('ar_h').value);
  var zero=parseInt(document.getElementById('zd').textContent)||0;
  if(isNaN(l1)||l1<=0){showMsg('cfg-msg','Level 1 must be > 0 mm',false);return;}
  if(zero>0&&l1>=zero){showMsg('cfg-msg','Level 1 ('+l1+' mm) must be less than Zero reference ('+zero+' mm) — raise sensor or lower threshold',false);return;}
  if(isNaN(l2)||l2<=l1){showMsg('cfg-msg','Level 2 must be greater than Level 1',false);return;}
  if(zero>0&&l2>=zero){showMsg('cfg-msg','Level 2 ('+l2+' mm) must be less than Zero reference ('+zero+' mm) — raise sensor or lower threshold',false);return;}
  if(l2>2000){showMsg('cfg-msg','Level 2 must be ≤ 2000 mm',false);return;}
  if(isNaN(trig)||trig<1||trig>3600){showMsg('cfg-msg','Trigger delay must be 1–3600 s',false);return;}
  if(isNaN(clr)||clr<1||clr>3600){showMsg('cfg-msg','Clear delay must be 1–3600 s',false);return;}
  if(isNaN(sensMs)||sensMs<100||sensMs>180000){showMsg('cfg-msg','Sensor interval must be 100–180,000 ms',false);return;}
  if(isNaN(arH)||arH<0||arH>168){showMsg('cfg-msg','Auto-restart must be 0–168 h',false);return;}
  fetch('/api/config',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({level1_threshold_mm:l1,level2_threshold_mm:l2,trigger_delay_s:trig,clear_delay_s:clr,sensor_interval_ms:sensMs,auto_restart_hours:arH})
  }).then(function(r){return r.json();}).then(function(d){
    showMsg('cfg-msg',d.ok?'Settings saved':('Error: '+d.error),d.ok);
  }).catch(function(){showMsg('cfg-msg','Request failed',false);});
}
function doReboot(){
  if(!confirm('Reboot device now?'))return;
  fetch('/api/reboot',{method:'POST'}).then(function(){
    showMsg('cfg-msg','Rebooting… reconnect in a few seconds.',true);
  }).catch(function(){});
}
function toggleSsid(){
  fetch('/api/ssid-hidden',{method:'POST'}).then(function(r){return r.json();}).then(function(d){
    if(d.ok){showMsg('ssid-msg',d.hidden?'SSID is now hidden. Device will reboot.':'SSID is now visible. Device will reboot.',true);setTimeout(function(){location.reload();},4000);}
    else{showMsg('ssid-msg','Error: '+d.error,false);}
  }).catch(function(){showMsg('ssid-msg','Request failed',false);});
}
function saveLanConfig(){
  var ssid=(document.getElementById('sta-ssid').value||'').trim();
  var password=document.getElementById('sta-pw').value||'';
  if(!ssid){showMsg('wifi-msg','Enter LAN SSID first',false);return;}
  fetch('/api/lan-config',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({sta_ssid:ssid,sta_password:password})
  }).then(function(r){return r.json();}).then(function(d){
    if(d.ok){showMsg('wifi-msg','LAN OTA mode saved. Keep this page open and wait for the LAN link below to appear.',true);}
    else{showMsg('wifi-msg','Error: '+d.error,false);}
  }).catch(function(){showMsg('wifi-msg','Request failed',false);});
}
function switchToApMode(){
  if(!confirm('Switch device back to AP-only mode now?'))return;
  fetch('/api/ap-mode',{method:'POST'}).then(function(r){return r.json();}).then(function(d){
    if(d.ok){showMsg('wifi-msg','Switching back to AP-only mode. Device is rebooting.',true);setTimeout(function(){location.reload();},5000);}
    else{showMsg('wifi-msg','Error: '+d.error,false);}
  }).catch(function(){showMsg('wifi-msg','Request failed',false);});
}
function uploadOta(){
  var f=document.getElementById('ota-file').files[0];
  if(!f){showMsg('ota-msg','Select a .bin file first',false);return;}
  var btn=document.getElementById('ota-upload-btn');
  if(btn){btn.disabled=true;btn.textContent='Uploading...';}
  var fd=new FormData();
  fd.append('firmware',f);
  var xhr=new XMLHttpRequest();
  xhr.upload.onprogress=function(e){
    if(e.lengthComputable){
      var p=Math.round(e.loaded/e.total*100);
      document.getElementById('ota-bar').style.width=p+'%';
      document.getElementById('ota-pct').textContent=p+'%';
    }
  };
  xhr.onload=function(){
    var raw=(xhr.responseText||'').trim();
    var ok=(xhr.status>=200&&xhr.status<300&&raw.indexOf('OK:')===0);
    var msg=raw;
    if(ok){msg=raw.replace(/^OK:\s*/,'');}
    else if(raw.indexOf('ERROR:')===0){msg='Update failed: '+raw.replace(/^ERROR:\s*/,'');}
    else if(!raw){msg='Update failed';}
    showMsg('ota-msg',msg,ok);
    if(!ok){
      document.getElementById('ota-bar').style.width='0%';
      document.getElementById('ota-pct').textContent='';
    }
    if(btn){btn.disabled=false;btn.textContent='Upload Firmware';}
    return;
    showMsg('ota-msg',ok?'Update OK — device rebooting…':'Update failed: '+xhr.responseText,ok);
  };
  xhr.onerror=function(){showMsg('ota-msg','Upload error',false);};
  xhr.onerror=function(){
    showMsg('ota-msg','Upload error',false);
    document.getElementById('ota-bar').style.width='0%';
    document.getElementById('ota-pct').textContent='';
    if(btn){btn.disabled=false;btn.textContent='Upload Firmware';}
  };
  xhr.open('POST','/update');
  xhr.send(fd);
}
function changePassword(){
  var cur=document.getElementById('cp-cur').value;
  var nw=document.getElementById('cp-new').value;
  if(!cur){showMsg('cp-msg','Enter current password',false);return;}
  if(nw.length<4||nw.length>31){showMsg('cp-msg','New password must be 4–31 characters',false);return;}
  fetch('/api/change-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({current_password:cur,new_password:nw})}).then(function(r){return r.json();}).then(function(d){
    showMsg('cp-msg',d.ok?'Password changed successfully':('Error: '+d.error),d.ok);
    if(d.ok){document.getElementById('cp-cur').value='';document.getElementById('cp-new').value='';}
  }).catch(function(){showMsg('cp-msg','Request failed',false);});
}
poll();
</script>
</body></html>)FGSENS";

// ─── Route handlers ───────────────────────────────────────────────────────────
static void serve_login(const char *err = "") {
    String html = FPSTR(LOGIN_HTML);
    html.replace("%DEVNAME%", g_cfg->device_name);
    html.replace("%ERR%", err);
    server.send(200, "text/html", html);
}

static void handle_get_root() {
    if (!session_valid()) { require_auth(); return; }
    server.sendHeader("Cache-Control", "no-store");
    server.send(200, "text/html", FPSTR(CONFIG_HTML));
}

static void handle_get_login()  { serve_login(); }

static void handle_post_login() {
    String pw = server.arg("password");
    if (pw.equals(g_cfg->password)) {
        session_create();
        server.sendHeader("Set-Cookie",
            String("sess=") + g_token + "; Path=/; HttpOnly");
        server.sendHeader("Location", "/");
        server.send(302, "text/plain", "");
    } else {
        serve_login("Invalid password");
    }
}

static void handle_logout() {
    g_token[0] = '\0';
    server.sendHeader("Set-Cookie", "sess=; Path=/; Max-Age=0");
    server.sendHeader("Location", "/login");
    server.send(302, "text/plain", "");
}

static void handle_api_status() {
    if (!session_valid()) { send_json(403, err_json("Forbidden")); return; }

    uint32_t ar_target_ms = (uint32_t)g_cfg->auto_restart_hours * 3600000UL;
    uint32_t now_ms       = millis();
    uint32_t restart_in_s = (g_cfg->auto_restart_hours > 0 && now_ms < ar_target_ms)
                            ? (ar_target_ms - now_ms) / 1000UL : 0;

    String ap_ip = g_state->ap_active ? WiFi.softAPIP().toString() : "";
    String lan_ip = g_state->sta_connected ? WiFi.localIP().toString() : "";
    const char *wifi_mode = "AP_ONLY";
    if (g_cfg->wifi_mode == FG_WIFI_MODE_STA && g_cfg->sta_ssid[0] != '\0') {
        wifi_mode = g_state->sta_connected ? "LAN_OTA" : "AP_FALLBACK";
    }

    char j[1100];
    snprintf(j, sizeof(j),
        "{"
        "\"device_name\":\"%s\","
        "\"ble_id\":\"%s\","
        "\"wifi_mode\":\"%s\","
        "\"sta_connected\":%s,"
        "\"ap_active\":%s,"
        "\"sta_ssid\":\"%s\","
        "\"ap_ip\":\"%s\","
        "\"lan_ip\":\"%s\","
        "\"ap_recovery_in_s\":%u,"
        "\"wifi_sleep_enabled\":%s,"
        "\"raw_distance_mm\":%u,"
        "\"zero_distance_mm\":%u,"
        "\"water_level_mm\":%u,"
        "\"level1_threshold_mm\":%u,"
        "\"level2_threshold_mm\":%u,"
        "\"relay1\":%s,"
        "\"relay2\":%s,"
        "\"sensor_status\":\"%s\","
        "\"trigger_delay_s\":%u,"
        "\"clear_delay_s\":%u,"
        "\"ssid_hidden\":%s,"
        "\"uptime_seconds\":%u,"
        "\"config_version\":%u,"
        "\"sensor_interval_ms\":%u,"
        "\"auto_restart_hours\":%u,"
        "\"restart_in_s\":%u,"
        "\"wifi_sleep_in_s\":%u,"
        "\"firmware_version\":\"%s\","
        "\"firmware_date\":\"%s\""
        "}",
        g_cfg->device_name,
        g_cfg->device_name,
        wifi_mode,
        g_state->sta_connected ? "true" : "false",
        g_state->ap_active ? "true" : "false",
        g_cfg->sta_ssid,
        ap_ip.c_str(),
        lan_ip.c_str(),
        g_state->ap_recovery_in_s,
        g_state->sta_connected ? "false" : "true",
        g_state->raw_distance_mm,
        g_cfg->zero_distance_mm,
        g_state->water_level_mm,
        g_cfg->level1_threshold_mm,
        g_cfg->level2_threshold_mm,
        g_state->relay1 ? "true" : "false",
        g_state->relay2 ? "true" : "false",
        g_state->sensor_ok ? "OK" : "FAULT",
        g_cfg->trigger_delay_s,
        g_cfg->clear_delay_s,
        g_cfg->ssid_hidden ? "true" : "false",
        g_state->uptime_s,
        g_cfg->config_version,
        g_cfg->sensor_interval_ms,
        (uint32_t)g_cfg->auto_restart_hours,
        restart_in_s,
        webserver_wifi_sleep_in_s(),
        FIRMWARE_VERSION,
        FIRMWARE_DATE
    );
    send_json(200, j);
}

static void handle_api_set_zero() {
    if (!session_valid()) { send_json(403, err_json("Forbidden")); return; }
    if (!g_state->sensor_ok) {
        send_json(400, err_json("Sensor fault — cannot calibrate now"));
        return;
    }
    if (g_state->raw_distance_mm == 0) {
        send_json(400, err_json("No valid reading available"));
        return;
    }
    g_cfg->zero_distance_mm = g_state->raw_distance_mm;
    g_cfg->config_version++;
    storage_save(*g_cfg);
    led_signal_config_saved();
    send_json(200, ok_json());
}

static void handle_api_config() {
    if (!session_valid()) { send_json(403, err_json("Forbidden")); return; }

    String body = server.arg("plain");
    int l1 = -1, l2 = -1, trig = -1, clr = -1, sens_ms = -1, ar_h = -1;

    auto parseField = [&](const char *key) -> int {
        int idx = body.indexOf(key);
        if (idx < 0) return -1;
        idx = body.indexOf(':', idx) + 1;
        return body.substring(idx).toInt();
    };

    l1      = parseField("\"level1_threshold_mm\"");
    l2      = parseField("\"level2_threshold_mm\"");
    trig    = parseField("\"trigger_delay_s\"");
    clr     = parseField("\"clear_delay_s\"");
    sens_ms = parseField("\"sensor_interval_ms\"");
    ar_h    = parseField("\"auto_restart_hours\"");

    if (l1 <= 0 || l2 <= 0) {
        send_json(400, err_json("Missing or invalid fields")); return;
    }
    if (l1 >= l2) {
        send_json(400, err_json("Level 2 must be greater than Level 1")); return;
    }
    if (l2 > 2000) {
        send_json(400, err_json("Level 2 must be <= 2000 mm")); return;
    }
    if (trig < 1 || trig > 3600) {
        send_json(400, err_json("Trigger delay must be 1-3600 s")); return;
    }
    if (clr < 1 || clr > 3600) {
        send_json(400, err_json("Clear delay must be 1-3600 s")); return;
    }
    if (sens_ms < 100 || sens_ms > 180000) {
        send_json(400, err_json("Sensor interval must be 100-180000 ms")); return;
    }
    if (ar_h < 0 || ar_h > 168) {
        send_json(400, err_json("Auto-restart must be 0-168 h")); return;
    }

    g_cfg->level1_threshold_mm = (uint32_t)l1;
    g_cfg->level2_threshold_mm = (uint32_t)l2;
    g_cfg->trigger_delay_s     = (uint32_t)trig;
    g_cfg->clear_delay_s       = (uint32_t)clr;
    g_cfg->sensor_interval_ms  = (uint32_t)sens_ms;
    g_cfg->auto_restart_hours  = (uint8_t)ar_h;
    g_cfg->config_version++;
    storage_save(*g_cfg);
    led_signal_config_saved();
    send_json(200, ok_json());
}

static void handle_api_reboot() {
    if (!session_valid()) { send_json(403, err_json("Forbidden")); return; }
    send_json(200, ok_json());
    delay(500);
    ESP.restart();
}

static void handle_api_ssid_hidden() {
    if (!session_valid()) { send_json(403, err_json("Forbidden")); return; }
    g_cfg->ssid_hidden = g_cfg->ssid_hidden ? 0 : 1;
    storage_save(*g_cfg);
    String j = "{\"ok\":true,\"hidden\":";
    j += (g_cfg->ssid_hidden ? "true" : "false");
    j += "}";
    send_json(200, j);
    delay(500);
    ESP.restart();
}

static void handle_api_lan_config() {
    if (!session_valid()) { send_json(403, err_json("Forbidden")); return; }

    String body = server.arg("plain");
    String ssid = parse_json_string(body, "\"sta_ssid\"");
    String password = parse_json_string(body, "\"sta_password\"");
    bool keep_existing_password =
        password.length() == 0 &&
        ssid.equals(g_cfg->sta_ssid) &&
        g_cfg->sta_password[0] != '\0';

    if (ssid.length() == 0 || ssid.length() > 32) {
        send_json(400, err_json("LAN SSID must be 1-32 characters")); return;
    }
    if (password.length() > 64) {
        send_json(400, err_json("LAN password must be 0-64 characters")); return;
    }

    strlcpy(g_cfg->sta_ssid, ssid.c_str(), sizeof(g_cfg->sta_ssid));
    if (!keep_existing_password) {
        strlcpy(g_cfg->sta_password, password.c_str(), sizeof(g_cfg->sta_password));
    }
    g_cfg->wifi_mode = FG_WIFI_MODE_STA;
    g_cfg->config_version++;
    storage_save(*g_cfg);

    send_json(200, "{\"ok\":true,\"switching\":true}");
}

static void handle_api_ap_mode() {
    if (!session_valid()) { send_json(403, err_json("Forbidden")); return; }

    g_cfg->wifi_mode = FG_WIFI_MODE_AP_ONLY;
    g_cfg->ssid_hidden = 0;
    g_cfg->config_version++;
    storage_save(*g_cfg);

    send_json(200, "{\"ok\":true,\"restarting\":true}");
    delay(500);
    ESP.restart();
}

static void handle_api_change_password() {
    if (!session_valid()) { send_json(403, err_json("Forbidden")); return; }

    String body = server.arg("plain");
    auto parseStr = [&](const char *key) -> String {
        int idx = body.indexOf(key);
        if (idx < 0) return "";
        idx = body.indexOf('"', body.indexOf(':', idx) + 1) + 1;
        int end = body.indexOf('"', idx);
        if (end < 0) return "";
        return body.substring(idx, end);
    };

    String cur = parseStr("\"current_password\"");
    String nw  = parseStr("\"new_password\"");

    if (!cur.equals(g_cfg->password)) {
        send_json(400, err_json("Current password incorrect")); return;
    }
    if (nw.length() < 4 || nw.length() > 31) {
        send_json(400, err_json("New password must be 4-31 characters")); return;
    }
    strlcpy(g_cfg->password, nw.c_str(), sizeof(g_cfg->password));
    g_cfg->config_version++;
    storage_save(*g_cfg);
    send_json(200, ok_json());
}

static void handle_not_found() {
    server.sendHeader("Location", "/");
    server.send(302, "text/plain", "");
}

// ─── Public API ───────────────────────────────────────────────────────────────
void webserver_init(DeviceConfig *cfg, AppState *state) {
    g_cfg   = cfg;
    g_state = state;

    // Collect Cookie header on every request
    const char *headers[] = {"Cookie"};
    server.collectHeaders(headers, 1);

    server.on("/",           HTTP_GET,  handle_get_root);
    server.on("/login",      HTTP_GET,  handle_get_login);
    server.on("/login",      HTTP_POST, handle_post_login);
    server.on("/logout",     HTTP_GET,  handle_logout);
    server.on("/api/status", HTTP_GET,  handle_api_status);
    server.on("/api/set-zero", HTTP_POST, handle_api_set_zero);
    server.on("/api/config",   HTTP_POST, handle_api_config);
    server.on("/api/lan-config",       HTTP_POST, handle_api_lan_config);
    server.on("/api/ap-mode",          HTTP_POST, handle_api_ap_mode);
    server.on("/api/reboot",           HTTP_POST, handle_api_reboot);
    server.on("/api/ssid-hidden",      HTTP_POST, handle_api_ssid_hidden);
    server.on("/api/change-password",  HTTP_POST, handle_api_change_password);

    // OTA firmware upload
    server.on("/update", HTTP_POST,
        []() {
            if (!session_valid()) { server.send(403, "text/plain", "Forbidden"); return; }
            server.sendHeader("Connection", "close");
            if (g_ota_success && !g_ota_failed) {
                server.send(200, "text/plain", "OK: Firmware update verified. Device rebooting.");
                delay(1000);
                ESP.restart();
                return;
            }

            String message = g_ota_status.length() ? g_ota_status : "OTA failed";
            server.send(500, "text/plain", String("ERROR: ") + message);
        },
        []() {
            if (!session_valid()) {
                ota_fail("Forbidden");
                Update.abort();
                return;
            }

            HTTPUpload &upload = server.upload();
            if (upload.status == UPLOAD_FILE_START) {
                ota_reset_state();
                if (!Update.begin(UPDATE_SIZE_UNKNOWN)) {
                    ota_fail(ota_error_message("Update begin failed"));
                    Update.abort();
                } else {
                    g_ota_status = "Upload started";
                }
            } else if (upload.status == UPLOAD_FILE_WRITE) {
                if (g_ota_failed) return;
                size_t written = Update.write(upload.buf, upload.currentSize);
                g_ota_written_bytes += written;
                if (written != upload.currentSize) {
                    ota_fail(ota_error_message("Flash write failed"));
                    Update.abort();
                }
            } else if (upload.status == UPLOAD_FILE_END) {
                if (g_ota_failed) return;
                if (!Update.end(true)) {
                    ota_fail(ota_error_message("Finalize failed"));
                    return;
                }
                g_ota_success = true;
                g_ota_status = String("Firmware update verified (") + String(g_ota_written_bytes) + " bytes). Device rebooting.";
            } else if (upload.status == UPLOAD_FILE_ABORTED) {
                ota_fail("Upload aborted");
                Update.abort();
            }
        }
    );

    server.onNotFound(handle_not_found);
    server.begin();
    g_last_activity_ms = millis();   // start idle clock from boot
}

void webserver_handle() {
    server.handleClient();
}
