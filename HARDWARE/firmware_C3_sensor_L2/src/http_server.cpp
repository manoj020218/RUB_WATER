#include "http_server.h"
#include "config.h"
#include "storage.h"
#include "led.h"
#include <WebServer.h>
#include <Update.h>

static WebServer    server(HTTP_PORT);
static DeviceConfig *g_cfg   = nullptr;
static AppState     *g_state = nullptr;

// ─── WiFi idle sleep tracking ─────────────────────────────────────────────────
static uint32_t g_last_activity_ms = 0;   // millis() of last valid HTTP activity

bool webserver_wifi_should_sleep() {
    if (g_last_activity_ms == 0) return false;
    return (millis() - g_last_activity_ms) >= WIFI_IDLE_TIMEOUT_MS;
}

uint32_t webserver_wifi_sleep_in_s() {
    if (g_last_activity_ms == 0) return WIFI_IDLE_TIMEOUT_MS / 1000;
    const uint32_t elapsed = millis() - g_last_activity_ms;
    if (elapsed >= WIFI_IDLE_TIMEOUT_MS) return 0;
    return (WIFI_IDLE_TIMEOUT_MS - elapsed) / 1000;
}

// ─── Session ──────────────────────────────────────────────────────────────────
static char     g_token[17]      = "";   // 16 hex chars + null
static uint32_t g_token_expires  = 0;

static void session_create() {
    uint32_t a = esp_random(), b = esp_random();
    snprintf(g_token, sizeof(g_token), "%08X%08X", a, b);
    g_token_expires = millis() + SESSION_TIMEOUT_MS;
}

static bool session_valid() {
    if (g_token[0] == '\0') return false;
    if (millis() > g_token_expires) { g_token[0] = '\0'; return false; }
    String cookie = server.header("Cookie");
    String needle = String("sess=") + g_token;
    if (cookie.indexOf(needle) < 0) return false;
    g_token_expires    = millis() + SESSION_TIMEOUT_MS;  // refresh session
    g_last_activity_ms = millis();                        // reset WiFi idle timer
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
<div class="btn-row">
<button class="btn-green" onclick="saveConfig()">Save</button>
<button class="btn-red" onclick="doReboot()">Reboot Device</button>
</div>
<div id="cfg-msg" class="msg"></div>
</div>

<div class="card">
<h3>Network Visibility</h3>
<div id="ssid-status-row" class="row" style="margin-bottom:12px">
  <span class="lbl">WiFi SSID</span>
  <span class="val"><span id="ssid-badge" class="badge ok">Visible</span></span>
</div>
<p class="hint" id="ssid-hint">Hide the SSID after installation so it does not appear in public WiFi scans. The BLE name (<span id="ble-id2">FgSensXXXXXX</span>) is always visible — use a BLE scanner to identify the device, then connect manually by typing the SSID. To force SSID visible without the app: hold the BOOT button on the board while powering on.</p>
<div class="btn-row">
<button id="ssid-btn" class="btn-outline" onclick="toggleSsid()">Hide SSID</button>
</div>
<div id="ssid-msg" class="msg"></div>
</div>

<div class="card">
<h3>Firmware Update (OTA)</h3>
<p class="hint">Select .bin file and upload. Device reboots automatically after success.</p>
<input type="file" id="ota-file" accept=".bin">
<div class="btn-row">
<button class="btn-outline" onclick="uploadOta()">Upload Firmware</button>
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
    var u=d.uptime_seconds;
    var h=Math.floor(u/3600),m=Math.floor((u%3600)/60),s=u%60;
    document.getElementById('up').textContent=(h?h+'h ':'')+( m?m+'m ':'')+s+'s';
    updateHints();
  }).catch(function(){});
  setTimeout(poll,2000);
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
  var zero=parseInt(document.getElementById('zd').textContent)||0;
  if(isNaN(l1)||l1<=0){showMsg('cfg-msg','Level 1 must be > 0 mm',false);return;}
  if(zero>0&&l1>=zero){showMsg('cfg-msg','Level 1 ('+l1+' mm) must be less than Zero reference ('+zero+' mm) — raise sensor or lower threshold',false);return;}
  if(isNaN(l2)||l2<=l1){showMsg('cfg-msg','Level 2 must be greater than Level 1',false);return;}
  if(zero>0&&l2>=zero){showMsg('cfg-msg','Level 2 ('+l2+' mm) must be less than Zero reference ('+zero+' mm) — raise sensor or lower threshold',false);return;}
  if(l2>2000){showMsg('cfg-msg','Level 2 must be ≤ 2000 mm',false);return;}
  if(isNaN(trig)||trig<1||trig>3600){showMsg('cfg-msg','Trigger delay must be 1–3600 s',false);return;}
  if(isNaN(clr)||clr<1||clr>3600){showMsg('cfg-msg','Clear delay must be 1–3600 s',false);return;}
  fetch('/api/config',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({level1_threshold_mm:l1,level2_threshold_mm:l2,trigger_delay_s:trig,clear_delay_s:clr})
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
function uploadOta(){
  var f=document.getElementById('ota-file').files[0];
  if(!f){showMsg('ota-msg','Select a .bin file first',false);return;}
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
    var ok=xhr.responseText==='OK';
    showMsg('ota-msg',ok?'Update OK — device rebooting…':'Update failed: '+xhr.responseText,ok);
  };
  xhr.onerror=function(){showMsg('ota-msg','Upload error',false);};
  xhr.open('POST','/update');
  xhr.send(fd);
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
    server.send(200, "text/html", FPSTR(CONFIG_HTML));
}

static void handle_get_login()  { serve_login(); }

static void handle_post_login() {
    String pw = server.arg("password");
    if (pw == DEFAULT_PASSWORD) {
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

    String j = "{";
    j += "\"device_name\":\"";  j += g_cfg->device_name; j += "\",";
    j += "\"ble_id\":\"";       j += g_cfg->device_name; j += "\",";
    j += "\"raw_distance_mm\":";  j += g_state->raw_distance_mm;  j += ",";
    j += "\"zero_distance_mm\":"; j += g_cfg->zero_distance_mm;   j += ",";
    j += "\"water_level_mm\":";   j += g_state->water_level_mm;   j += ",";
    j += "\"level1_threshold_mm\":"; j += g_cfg->level1_threshold_mm; j += ",";
    j += "\"level2_threshold_mm\":"; j += g_cfg->level2_threshold_mm; j += ",";
    j += "\"relay1\":"; j += (g_state->relay1 ? "true" : "false"); j += ",";
    j += "\"relay2\":"; j += (g_state->relay2 ? "true" : "false"); j += ",";
    j += "\"sensor_status\":\""; j += (g_state->sensor_ok ? "OK" : "FAULT"); j += "\",";
    j += "\"trigger_delay_s\":";  j += g_cfg->trigger_delay_s;  j += ",";
    j += "\"clear_delay_s\":";    j += g_cfg->clear_delay_s;    j += ",";
    j += "\"ssid_hidden\":";      j += (g_cfg->ssid_hidden ? "true" : "false"); j += ",";
    j += "\"uptime_seconds\":";  j += g_state->uptime_s;           j += ",";
    j += "\"config_version\":";  j += g_cfg->config_version;
    j += "}";
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
    int l1 = -1, l2 = -1, trig = -1, clr = -1;

    auto parseField = [&](const char *key) -> int {
        int idx = body.indexOf(key);
        if (idx < 0) return -1;
        idx = body.indexOf(':', idx) + 1;
        return body.substring(idx).toInt();
    };

    l1   = parseField("\"level1_threshold_mm\"");
    l2   = parseField("\"level2_threshold_mm\"");
    trig = parseField("\"trigger_delay_s\"");
    clr  = parseField("\"clear_delay_s\"");

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
        send_json(400, err_json("Trigger delay must be 1–3600 s")); return;
    }
    if (clr < 1 || clr > 3600) {
        send_json(400, err_json("Clear delay must be 1–3600 s")); return;
    }

    g_cfg->level1_threshold_mm = (uint32_t)l1;
    g_cfg->level2_threshold_mm = (uint32_t)l2;
    g_cfg->trigger_delay_s     = (uint32_t)trig;
    g_cfg->clear_delay_s       = (uint32_t)clr;
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
    server.on("/api/reboot",      HTTP_POST, handle_api_reboot);
    server.on("/api/ssid-hidden", HTTP_POST, handle_api_ssid_hidden);

    // OTA firmware upload
    server.on("/update", HTTP_POST,
        []() {
            if (!session_valid()) { server.send(403, "text/plain", "Forbidden"); return; }
            server.sendHeader("Connection", "close");
            server.send(200, "text/plain", Update.hasError() ? "FAIL" : "OK");
            delay(1000);
            ESP.restart();
        },
        []() {
            if (!session_valid()) { Update.abort(); return; }
            HTTPUpload &upload = server.upload();
            if (upload.status == UPLOAD_FILE_START) {
                Update.begin(UPDATE_SIZE_UNKNOWN);
            } else if (upload.status == UPLOAD_FILE_WRITE) {
                Update.write(upload.buf, upload.currentSize);
            } else if (upload.status == UPLOAD_FILE_END) {
                Update.end(true);
            }
        }
    );

    server.onNotFound(handle_not_found);
    server.begin();
}

void webserver_handle() {
    server.handleClient();
}
