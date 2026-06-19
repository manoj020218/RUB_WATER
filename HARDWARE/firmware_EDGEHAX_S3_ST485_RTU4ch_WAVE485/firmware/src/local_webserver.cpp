#include "local_webserver.h"

#include <ArduinoJson.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include <WiFi.h>

#include "config_manager.h"
#include "device_profile.h"
#include "dyp_sensor.h"
#include "flood_state_machine.h"
#include "mqtt_manager.h"
#include "ota_manager.h"
#include "output_controller.h"
#include "pump_controller.h"
#include "remote_box_manager.h"
#include "rs485_rtu_master.h"
#include "sd_fifo.h"
#include "voltage_monitor.h"
#include "wifi_manager.h"

namespace {
constexpr uint8_t kGenericRelayModel2Ch = 2;
constexpr uint8_t kGenericRelayModel4Ch = 4;
constexpr uint32_t kGenericRelayReadbackDelayMs = 25UL;

uint8_t clampGenericRelayModel(int raw) {
    return raw >= 4 ? kGenericRelayModel4Ch : kGenericRelayModel2Ch;
}

uint8_t genericRelayCountFromModel(uint8_t model) {
    return model >= kGenericRelayModel4Ch ? 4 : 2;
}

uint16_t genericRelayFirstCoilFromModel(uint8_t model) {
    return model >= kGenericRelayModel4Ch ? 0x0001 : 0x0000;
}

uint16_t genericRelayPrimaryOnValueFromModel(uint8_t model) {
    return model >= kGenericRelayModel4Ch ? 0x0100 : 0xFF00;
}

uint16_t genericRelayAlternateOnValueFromModel(uint8_t model) {
    return model >= kGenericRelayModel4Ch ? 0xFF00 : 0x0100;
}

uint8_t genericRelayStatusReadCountFromModel(uint8_t model) {
    return model >= kGenericRelayModel4Ch ? 4 : 2;
}

uint16_t genericRelayAddressRegisterFromModel(uint8_t model) {
    return model >= kGenericRelayModel4Ch ? 0x4000 : 0x0000;
}

const char* genericRelayModelLabel(uint8_t model) {
    return model >= kGenericRelayModel4Ch ? "4CH" : "2CH";
}

struct GenericRelayStatusSnapshot {
    bool valid = false;
#ifdef GENERIC_REMOTE_RELAY_MODE
    uint8_t slaveId = GENERIC_REMOTE_RELAY_RIGHT_ADDR;
    uint8_t moduleType = GENERIC_REMOTE_RELAY_RIGHT_MODEL;
#else
    uint8_t slaveId = 255;
    uint8_t moduleType = kGenericRelayModel2Ch;
#endif
    uint8_t relayCount = genericRelayCountFromModel(moduleType);
    bool relay1On = false;
    bool relay2On = false;
    bool relay3On = false;
    bool relay4On = false;
    uint8_t exceptionCode = 0;
};

String genericRelayModelOptions(uint8_t model) {
    const uint8_t normalized = clampGenericRelayModel(model);
    String html;
    html += "<option value='2'";
    if (normalized == kGenericRelayModel2Ch) html += " selected";
    html += ">2 Relay Module</option>";
    html += "<option value='4'";
    if (normalized == kGenericRelayModel4Ch) html += " selected";
    html += ">4 Relay Module</option>";
    return html;
}

String genericRelayConfigFields(uint8_t addr, uint8_t model) {
    String html;
    html += "<label>Module Address</label><input type='number' min='1' max='255' name='modbus_addr' value='";
    html += String(addr);
    html += "'>";
    html += "<label>Module Type</label><select name='module_type'>";
    html += genericRelayModelOptions(model);
    html += "</select>";
    return html;
}

void updateGenericRelaySnapshot(GenericRelayStatusSnapshot& snapshot,
                                uint8_t slaveId, uint8_t model,
                                bool valid, uint8_t exceptionCode,
                                uint8_t coilByte) {
    snapshot.valid = valid;
    snapshot.slaveId = slaveId;
    snapshot.moduleType = clampGenericRelayModel(model);
    snapshot.relayCount = genericRelayCountFromModel(snapshot.moduleType);
    snapshot.exceptionCode = exceptionCode;
    snapshot.relay1On = valid ? ((coilByte & 0x01U) != 0) : false;
    snapshot.relay2On = valid ? ((coilByte & 0x02U) != 0) : false;
    snapshot.relay3On = valid ? ((coilByte & 0x04U) != 0) : false;
    snapshot.relay4On = valid ? ((coilByte & 0x08U) != 0) : false;
}

uint8_t snapshotCoilByte(const GenericRelayStatusSnapshot& snapshot) {
    uint8_t coilByte = 0;
    if (snapshot.relay1On) coilByte |= 0x01U;
    if (snapshot.relay2On) coilByte |= 0x02U;
    if (snapshot.relay3On) coilByte |= 0x04U;
    if (snapshot.relay4On) coilByte |= 0x08U;
    return coilByte;
}

RtuResult readGenericRelaySnapshot(RtuBus bus, uint8_t slaveId, uint8_t model, uint8_t& coilByte) {
    uint8_t coilBytes[1] = {0};
    const RtuResult result = Rs485RtuMaster::getInstance().readCoils(
        bus, slaveId,
        genericRelayFirstCoilFromModel(model),
        genericRelayStatusReadCountFromModel(model),
        coilBytes, sizeof(coilBytes));
    coilByte = coilBytes[0];
    return result;
}

struct GenericRelayWriteResult {
    RtuResult writeResult{false, 0xFC};
    RtuResult readResult{false, 0xFC};
    uint8_t coilByte = 0;
    bool observedOn = false;
};

bool performGenericRelayWriteAttempt(RtuBus bus, uint8_t slaveId, uint8_t model,
                                     uint16_t coilAddr, uint8_t logicalBit,
                                     bool coilOn, uint16_t onValue,
                                     GenericRelayWriteResult& result) {
    result.writeResult = Rs485RtuMaster::getInstance().writeCoilValue(
        bus, slaveId, coilAddr, coilOn ? onValue : 0x0000);
    delay(kGenericRelayReadbackDelayMs);
    result.coilByte = 0;
    result.readResult = readGenericRelaySnapshot(bus, slaveId, model, result.coilByte);
    const uint8_t mask = (uint8_t)(1U << logicalBit);
    result.observedOn = (result.coilByte & mask) != 0;
    return result.writeResult.ok || (result.readResult.ok && result.observedOn == coilOn);
}

GenericRelayStatusSnapshot g_genericRelayStatus;
}

LocalWebserver& LocalWebserver::getInstance() {
    static LocalWebserver inst;
    return inst;
}

void LocalWebserver::buildMdnsHost(char* out, size_t outSize, const char* deviceId) {
    if (!out || outSize == 0) return;
    size_t w = 0;
    bool lastWasDash = false;
    for (size_t i = 0; deviceId && deviceId[i] != '\0' && w + 1 < outSize; ++i) {
        const char c = deviceId[i];
        if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) {
            out[w++] = c;
            lastWasDash = false;
        } else if (c >= 'A' && c <= 'Z') {
            out[w++] = static_cast<char>(c - 'A' + 'a');
            lastWasDash = false;
        } else if (!lastWasDash && w > 0) {
            out[w++] = '-';
            lastWasDash = true;
        }
    }
    while (w > 0 && out[w - 1] == '-') --w;
    if (w == 0) {
        strncpy(out, "floodguard-main", outSize - 1);
        out[outSize - 1] = '\0';
        return;
    }
    out[w] = '\0';
}

void LocalWebserver::begin(const char* apSsid, const char* deviceId) {
    strncpy(_apSsid,    apSsid,   sizeof(_apSsid)    - 1);
    strncpy(_deviceId,  deviceId, sizeof(_deviceId)  - 1);
    buildMdnsHost(_mdnsHost, sizeof(_mdnsHost), deviceId);
    setupRoutes();
    Serial.printf("[WEB] Webserver ready on port 80 (AP SSID: %s, mDNS: %s.local)\n", _apSsid, _mdnsHost);
}

void LocalWebserver::loop() {
    startServerIfNeeded();
    _server.handleClient();
    updateMdns();
    if (_apActive) {
        // Auto-close AP after duration
        if (millis() - _apStartMs >= _apDurationMs) {
            stopAp();
        }
    }
}

void LocalWebserver::startAp(uint32_t durationMs) {
    WiFi.softAP(_apSsid);
    startServerIfNeeded();
    _apActive     = true;
    _apStartMs    = millis();
    _apDurationMs = durationMs;
    Serial.printf("[WEB] AP started: SSID=%s IP=%s duration=%lus\n",
                  _apSsid, WiFi.softAPIP().toString().c_str(), durationMs / 1000UL);
}

void LocalWebserver::stopAp() {
    WiFi.softAPdisconnect(true);
    _apActive  = false;
    _loggedIn  = false;
    Serial.println("[WEB] AP stopped");
}

void LocalWebserver::startServerIfNeeded() {
    if (_serverStarted) return;
    _server.begin();
    _serverStarted = true;
}

void LocalWebserver::updateMdns() {
    if (WifiManager::getInstance().isConnected()) {
        if (!_mdnsStarted) {
            if (MDNS.begin(_mdnsHost)) {
                MDNS.addService("http", "tcp", 80);
                _mdnsStarted = true;
                Serial.printf("[WEB] mDNS started: http://%s.local/\n", _mdnsHost);
            } else {
                Serial.printf("[WEB] mDNS start failed for %s.local\n", _mdnsHost);
            }
        }
        return;
    }

    if (_mdnsStarted) {
        MDNS.end();
        _mdnsStarted = false;
        Serial.println("[WEB] mDNS stopped (WiFi disconnected)");
    }
}

void LocalWebserver::setupRoutes() {
    _server.on("/",                    HTTP_GET,  [this]{ handleRoot(); });
    _server.on("/api/status",           HTTP_GET,  [this]{ handleApiStatus(); });
    _server.on("/wifi",                HTTP_GET,  [this]{ handleWifi(); });
    _server.on("/wifi",                HTTP_POST, [this]{ handleWifiPost(); });
    _server.on("/login",               HTTP_GET,  [this]{ handleLogin(); });
    _server.on("/login",               HTTP_POST, [this]{ handleLoginPost(); });
    _server.on("/logout",              HTTP_GET,  [this]{ handleLogout(); });
    _server.on("/status",              HTTP_GET,  [this]{ handleStatus(); });
    _server.on("/config",              HTTP_GET,  [this]{ handleConfig(); });
    _server.on("/config",              HTTP_POST, [this]{ handleConfigPost(); });
    _server.on("/diagnostics",         HTTP_GET,  [this]{ handleDiagnostics(); });
    _server.on("/diagnostics",         HTTP_POST, [this]{ handleDiagnosticsPost(); });
    _server.on("/relay-test",          HTTP_GET,  [this]{ handleRelayTest(); });
    _server.on("/relay-test",          HTTP_POST, [this]{ handleRelayTestPost(); });
    _server.on("/remote-test",         HTTP_GET,  [this]{ handleRemoteTest(); });
    _server.on("/remote-test",         HTTP_POST, [this]{ handleRemoteTestPost(); });
    _server.on("/calibration",         HTTP_GET,  [this]{ handleCalibration(); });
    _server.on("/calibration",         HTTP_POST, [this]{ handleCalibrationPost(); });
    _server.on("/firmware-upload",     HTTP_GET,  [this]{ handleFirmwareUpload(); });
    _server.on("/reboot",              HTTP_GET,  [this]{ handleReboot(); });
    _server.on("/reboot",              HTTP_POST, [this]{ handleRebootPost(); });
    _server.on("/factory-reset-confirm", HTTP_GET,  [this]{ handleFactoryReset(); });
    _server.on("/factory-reset-confirm", HTTP_POST, [this]{ handleFactoryResetPost(); });
    _server.onNotFound([this]{ handleNotFound(); });

    // Firmware upload handler
    _server.on("/firmware-upload", HTTP_POST,
        [this]{ handleFirmwareUploadPost(); },
        [this]{
            HTTPUpload& upload = _server.upload();
            if (upload.status == UPLOAD_FILE_START) {
                if (!OtaManager::getInstance().beginLocalUpload(upload.totalSize)) {
                    _server.send(503, "text/plain", "OTA blocked: alert/danger active");
                    return;
                }
            } else if (upload.status == UPLOAD_FILE_WRITE) {
                OtaManager::getInstance().writeChunk(upload.buf, upload.currentSize);
            } else if (upload.status == UPLOAD_FILE_END) {
                String reason;
                OtaManager::getInstance().endLocalUpload(reason);
            }
        }
    );
}

bool LocalWebserver::checkAuth() {
    if (_loggedIn && millis() < _sessionExpMs) return true;
    _loggedIn = false;
    return false;
}

void LocalWebserver::sendUnauth() {
    _server.sendHeader("Location", "/login");
    _server.send(302, "text/plain", "");
}

// HTML helpers

String LocalWebserver::htmlHeader(const char* title) {
    String h = "<!DOCTYPE html><html><head><meta charset='utf-8'>"
               "<meta name='viewport' content='width=device-width,initial-scale=1'>"
               "<title>FloodGuard - "; h += title;
    h += "</title><style>"
         "body{font-family:sans-serif;margin:0;background:#f4f4f4;color:#222}"
         "nav{background:#1a73e8;padding:8px 16px}"
         "nav a{color:#fff;margin-right:12px;text-decoration:none;font-size:14px}"
         ".card{background:#fff;border-radius:8px;padding:16px;margin:16px;box-shadow:0 1px 4px #0002}"
         "h2{margin-top:0;color:#1a73e8}label{display:block;margin:8px 0 2px}"
         "input,select{width:100%;padding:6px;box-sizing:border-box;border:1px solid #ccc;border-radius:4px}"
         "button,.btn{background:#1a73e8;color:#fff;border:none;padding:8px 16px;"
         "border-radius:4px;cursor:pointer;margin-top:8px}"
         ".btn-danger{background:#d32f2f}.btn-warn{background:#f57c00}"
         ".ok{color:green}.err{color:red}table{width:100%;border-collapse:collapse}"
         "td,th{padding:6px 8px;text-align:left;border-bottom:1px solid #eee}"
         "th{background:#f0f0f0}.badge{padding:2px 8px;border-radius:12px;font-size:12px;"
         "background:#1a73e8;color:#fff}"
         "</style></head><body>"
         "<nav><b style='color:#fff'>FloodGuard</b>&nbsp;&nbsp;";
    return h;
}

String LocalWebserver::htmlFooter() {
    return "<p style='text-align:center;color:#999;font-size:12px;margin-top:32px'>"
           "FloodGuard &copy; " FIRMWARE_VERSION "</p></body></html>";
}

String LocalWebserver::navBar(const char* active) {
    const char* pages[][2] = {
        {"/status","Status"},{"/wifi","WiFi Setup"},{"/config","Config"},{"/calibration","Calibrate"},
        {"/relay-test","Relay Test"},{"/remote-test","Remote"},
        {"/diagnostics","Diagnostics"},{"/firmware-upload","OTA"},
        {"/reboot","Reboot"},{"/logout","Logout"}
    };
    String nav;
    for (auto& p : pages) {
        nav += "<a href='"; nav += p[0]; nav += "'";
        if (strcmp(p[0] + 1, active) == 0) nav += " style='text-decoration:underline'";
        nav += ">"; nav += p[1]; nav += "</a>";
    }
    nav += "</nav>";

    // Connection status banner — shown on every page
    const bool wifiOk = WifiManager::getInstance().isConnected();
    const bool mqttOk = MqttManager::getInstance().isConnected();
    if (wifiOk && mqttOk) {
        nav += "<div style='background:#2e7d32;color:#fff;padding:6px 16px;"
               "text-align:center;font-size:13px'>"
               "&#x2705; Cloud connected</div>";
    } else if (wifiOk) {
        nav += "<div style='background:#f57c00;color:#fff;padding:6px 16px;"
               "text-align:center;font-size:13px'>"
               "&#x26A0; No internet &mdash; running in local mode. "
               "Cloud features unavailable. Checking every 60s...</div>";
    }
    return nav;
}

// Page handlers

void LocalWebserver::handleRoot() {
    if (checkAuth()) {
        _server.sendHeader("Location", "/status");
    } else if (_apActive) {
        _server.sendHeader("Location", "/wifi");
    } else {
        _server.sendHeader("Location", "/login");
    }
    _server.send(302, "text/plain", "");
}

void LocalWebserver::handleLogin() {
    String html = htmlHeader("Login") + "</nav>";
    html += "<div class='card' style='max-width:360px;margin:60px auto'>"
            "<h2>FloodGuard Login</h2>"
            "<form method='POST' action='/login'>"
            "<label>Password</label>"
            "<input type='password' name='pw' autofocus>"
            "<button type='submit'>Login</button></form></div>";
    html += htmlFooter();
    _server.send(200, "text/html", html);
}

void LocalWebserver::handleLoginPost() {
    if (_server.hasArg("pw") && _server.arg("pw") == kPassword) {
        _loggedIn     = true;
        _sessionExpMs = millis() + 3600000UL;  // 1 hour session
        _server.sendHeader("Location", "/status");
        _server.send(302, "text/plain", "");
    } else {
        String html = htmlHeader("Login") + "</nav>";
        html += "<div class='card' style='max-width:360px;margin:60px auto'>"
                "<p class='err'>Wrong password</p>"
                "<a href='/login'>Try again</a></div>";
        html += htmlFooter();
        _server.send(401, "text/html", html);
    }
}

void LocalWebserver::handleLogout() {
    _loggedIn = false;
    _server.sendHeader("Location", "/login");
    _server.send(302, "text/plain", "");
}

void LocalWebserver::handleStatus() {
    if (!checkAuth()) { sendUnauth(); return; }
    const auto& dyp  = DypSensor::getInstance().snapshot();
    const auto& fsm  = FloodStateMachine::getInstance().snapshot();
    const auto& out  = OutputController::getInstance().snapshot();
    const auto& vmon = VoltageMonitor::getInstance().snapshot();
    const auto& sd   = SdFifo::getInstance().status();
    const auto& left = RemoteBoxManager::getInstance().leftStatus();
    const auto& right= RemoteBoxManager::getInstance().rightStatus();

    String html = htmlHeader("Status") + navBar("status");
    html += "<div class='card'><h2>Device Status</h2>";
    html += "<table>";
    html += "<tr><th>PID</th><td>" PRODUCT_PID "</td></tr>";
    html += "<tr><th>Device ID</th><td>" + String(_deviceId) + "</td></tr>";
    html += "<tr><th>Firmware</th><td>" FIRMWARE_NAME "</td></tr>";
    html += "<tr><th>Version</th><td>" FIRMWARE_VERSION "</td></tr>";
    html += "<tr><th>Release Date</th><td>" FIRMWARE_DATE "</td></tr>";
    html += "<tr><th>Hardware</th><td>" HARDWARE_VERSION "</td></tr>";
    html += "<tr><th>Uptime</th><td>" + String(millis()/1000) + " s</td></tr>";
    html += "<tr><th>Free Heap</th><td>" + String(ESP.getFreeHeap()/1024) + " KB</td></tr>";
    html += "<tr><th>Hostname</th><td><span class='ok'>" + String(_mdnsHost) + ".local</span></td></tr>";
    html += "<tr><th>WiFi</th><td>" + (WifiManager::getInstance().isConnected()
            ? String("<span class='ok'>Connected</span> ") + WifiManager::getInstance().localIp()
            : String("<span class='err'>Disconnected</span>")) + "</td></tr>";
    html += "<tr><th>MQTT</th><td>" + String(MqttManager::getInstance().isConnected()
            ? "<span class='ok'>Connected</span>" : "<span class='err'>Disconnected</span>")
            + "</td></tr>";
    html += "<tr><th>SD Card</th><td>" + String(sd.mounted
            ? "<span class='ok'>Mounted</span>" : "<span class='err'>Missing/Fault</span>")
            + "</td></tr>";
    html += "</table></div>";

    html += "<div class='card'><h2>Flood State</h2><table>";
    html += "<tr><th>State</th><td><b>" + String(floodStateStr(fsm.state)) + "</b></td></tr>";
    html += "<tr><th>Water Level</th><td>" + String(dyp.waterLevelMm) + " mm</td></tr>";
    html += "<tr><th>Distance</th><td>" + String(dyp.distanceMm) + " mm</td></tr>";
    html += "<tr><th>Sensor Valid</th><td>" + String(dyp.valid ? "Yes" : "No") + "</td></tr>";
    html += "<tr><th>L1 Active</th><td>" + String(fsm.l1Active ? "YES" : "no") + "</td></tr>";
    html += "<tr><th>L2 Active</th><td>" + String(fsm.l2Active ? "YES" : "no") + "</td></tr>";
    html += "</table></div>";

    html += "<div class='card'><h2>Outputs</h2><table>";
    html += "<tr><th>Local Siren</th><td>" + String(out.sirenOn ? "<span class='err'>ON</span>" : "off") + "</td></tr>";
    html += "<tr><th>Local Flash</th><td>" + String(out.flashOn ? "<span class='err'>ON</span>" : "off") + "</td></tr>";
    html += "<tr><th>Pump</th><td>" + String(out.sumpPumpOn ? "<span class='ok'>ON</span>" : "off") + "</td></tr>";
    html += "</table></div>";

    html += "<div class='card'><h2>Battery (INA219)</h2><table>";
    html += "<tr><th>Voltage</th><td>" + String(vmon.voltage, 2) + " V</td></tr>";
    html += "<tr><th>Current</th><td>" + String(vmon.currentMa, 1) + " mA</td></tr>";
    html += "<tr><th>Power</th><td>" + String(vmon.powerMw, 0) + " mW</td></tr>";
    html += "<tr><th>Status</th><td>" + String(vmon.criticalBattery ? "<span class='err'>CRITICAL</span>"
            : vmon.lowBattery ? "<span class='badge' style='background:#f57c00'>LOW</span>"
            : "<span class='ok'>OK</span>") + "</td></tr>";
    if (!vmon.ready) html += "<tr><td colspan='2'><span class='err'>INA219 not detected</span></td></tr>";
    html += "</table></div>";

    html += "<div class='card'><h2>Remote Boxes</h2><table>";
    html += "<tr><th></th><th>Online</th><th>Battery</th><th>Siren</th><th>Flash</th></tr>";
#ifdef GENERIC_REMOTE_RELAY_MODE
    html += "<tr><td>Left Relay (" + String(GENERIC_REMOTE_RELAY_LEFT_MODEL) + "CH, ID" + String(GENERIC_REMOTE_RELAY_LEFT_ADDR) + ")</td><td>" + String(left.online ? "<span class='ok'>Y</span>" : "<span class='err'>N</span>")
            + "</td><td>" + String(left.batteryVoltage, 1) + "V</td>"
            + "<td>" + String(left.sirenOn ? "ON" : "off") + "</td>"
            + "<td>" + String(left.flashOn ? "ON" : "off") + "</td></tr>";
    html += "<tr><td>Right Relay (" + String(GENERIC_REMOTE_RELAY_RIGHT_MODEL) + "CH, ID" + String(GENERIC_REMOTE_RELAY_RIGHT_ADDR) + ")</td><td>" + String(right.online ? "<span class='ok'>Y</span>" : "<span class='err'>N</span>")
            + "</td><td>" + String(right.batteryVoltage, 1) + "V</td>"
            + "<td>" + String(right.sirenOn ? "ON" : "off") + "</td>"
            + "<td>" + String(right.flashOn ? "ON" : "off") + "</td></tr>";
#else
    html += "<tr><td>Left (ID11)</td><td>" + String(left.online ? "<span class='ok'>Y</span>" : "<span class='err'>N</span>")
            + "</td><td>" + String(left.batteryVoltage, 1) + "V</td>"
            + "<td>" + String(left.sirenOn ? "ON" : "off") + "</td>"
            + "<td>" + String(left.flashOn ? "ON" : "off") + "</td></tr>";
    html += "<tr><td>Right (ID12)</td><td>" + String(right.online ? "<span class='ok'>Y</span>" : "<span class='err'>N</span>")
            + "</td><td>" + String(right.batteryVoltage, 1) + "V</td>"
            + "<td>" + String(right.sirenOn ? "ON" : "off") + "</td>"
            + "<td>" + String(right.flashOn ? "ON" : "off") + "</td></tr>";
#endif
    html += "</table></div>";
    html += htmlFooter();
    _server.send(200, "text/html", html);
}

void LocalWebserver::handleConfig() {
    if (!checkAuth()) { sendUnauth(); return; }
    const auto& cfg = ConfigManager::getInstance().get();
    String html = htmlHeader("Config") + navBar("config");
    html += "<div class='card'><h2>Flood Thresholds</h2>"
            "<form method='POST' action='/config'>"
            "<label>Alert Level (mm)</label>"
            "<input type='number' name='alert_level_mm' value='" + String(cfg.alertLevelMm) + "'>"
            "<label>Danger Level (mm)</label>"
            "<input type='number' name='danger_level_mm' value='" + String(cfg.dangerLevelMm) + "'>"
            "<label>Danger Clear Level (mm)</label>"
            "<input type='number' name='danger_clear_level_mm' value='" + String(cfg.dangerClearLevelMm) + "'>"
            "<label>Pump Auto Start (mm)</label>"
            "<input type='number' name='pump_auto_start_level_mm' value='" + String(cfg.pumpAutoStartLevelMm) + "'>"
            "<label>Pump Auto Stop (mm)</label>"
            "<input type='number' name='pump_auto_stop_level_mm' value='" + String(cfg.pumpAutoStopLevelMm) + "'>"
            "<label>Trigger Delay (sec)</label>"
            "<input type='number' name='trigger_delay_seconds' value='" + String(cfg.triggerDelaySeconds) + "'>"
            "<label>Alarm Clear Delay (sec)</label>"
            "<input type='number' name='alarm_clear_delay_seconds' value='" + String(cfg.alarmClearDelaySeconds) + "'>"
            "<label>Pump Low Stop Delay (sec)</label>"
            "<input type='number' name='pump_low_level_stop_delay_seconds' value='" + String(cfg.pumpLowStopDelaySeconds) + "'>"
            "<label>Pump Max Runtime (min)</label>"
            "<input type='number' name='pump_max_runtime_minutes' value='" + String(cfg.pumpMaxRuntimeMinutes) + "'>"
            "<label>Left Remote Enabled</label>"
            "<select name='left_remote_enabled'><option value='1'" + String(cfg.leftRemoteEnabled?" selected":"") + ">Yes</option>"
            "<option value='0'" + String(!cfg.leftRemoteEnabled?" selected":"") + ">No</option></select>"
            "<label>Right Remote Enabled</label>"
            "<select name='right_remote_enabled'><option value='1'" + String(cfg.rightRemoteEnabled?" selected":"") + ">Yes</option>"
            "<option value='0'" + String(!cfg.rightRemoteEnabled?" selected":"") + ">No</option></select>"
            "<label>Daily Reboot Hour (0-23)</label>"
            "<input type='number' name='daily_reboot_hour' value='" + String(cfg.dailyRebootHour) + "'>"
            "<label>Daily Reboot Minute (0-59)</label>"
            "<input type='number' name='daily_reboot_minute' value='" + String(cfg.dailyRebootMinute) + "'>"
            "<button type='submit'>Save Config</button></form></div>";
    html += htmlFooter();
    _server.send(200, "text/html", html);
}

void LocalWebserver::handleConfigPost() {
    if (!checkAuth()) { sendUnauth(); return; }
    StaticJsonDocument<512> doc;
    auto setU16 = [&](const char* k) {
        if (_server.hasArg(k)) doc[k] = _server.arg(k).toInt();
    };
    setU16("alert_level_mm"); setU16("danger_level_mm"); setU16("danger_clear_level_mm");
    setU16("pump_auto_start_level_mm"); setU16("pump_auto_stop_level_mm");
    setU16("trigger_delay_seconds"); setU16("alarm_clear_delay_seconds");
    setU16("pump_low_level_stop_delay_seconds"); setU16("pump_max_runtime_minutes");
    setU16("daily_reboot_hour"); setU16("daily_reboot_minute");
    if (_server.hasArg("left_remote_enabled"))
        doc["left_remote_enabled"]  = (_server.arg("left_remote_enabled") == "1");
    if (_server.hasArg("right_remote_enabled"))
        doc["right_remote_enabled"] = (_server.arg("right_remote_enabled") == "1");

    char json[512];
    serializeJson(doc, json, sizeof(json));
    String reason;
    if (ConfigManager::getInstance().applyJson(json, reason)) {
        _server.sendHeader("Location", "/config");
        _server.send(302, "text/plain", "");
    } else {
        String html = htmlHeader("Config") + navBar("config");
        html += "<div class='card'><p class='err'>Error: " + reason + "</p>"
                "<a href='/config'>Back</a></div>";
        html += htmlFooter();
        _server.send(400, "text/html", html);
    }
}

void LocalWebserver::handleDiagnostics() {
    if (!checkAuth()) { sendUnauth(); return; }
    String html = htmlHeader("Diagnostics") + navBar("diagnostics");
    html += "<div class='card'><h2>System Diagnostics</h2><table>";
    html += "<tr><th>Free Heap</th><td>" + String(ESP.getFreeHeap()) + " bytes</td></tr>";
    html += "<tr><th>Min Free Heap</th><td>" + String(ESP.getMinFreeHeap()) + " bytes</td></tr>";
    html += "<tr><th>PSRAM Size</th><td>" + String(ESP.getPsramSize()/1024) + " KB</td></tr>";
    html += "<tr><th>Free PSRAM</th><td>" + String(ESP.getFreePsram()/1024) + " KB</td></tr>";
    html += "<tr><th>Chip Cores</th><td>" + String(ESP.getChipCores()) + "</td></tr>";
    html += "<tr><th>CPU Freq</th><td>" + String(ESP.getCpuFreqMHz()) + " MHz</td></tr>";
    html += "<tr><th>Reset Reason</th><td>" + String(esp_reset_reason()) + "</td></tr>";
    html += "<tr><th>WiFi RSSI</th><td>" + String(WifiManager::getInstance().rssi()) + " dBm</td></tr>";
    html += "<tr><th>MQTT State</th><td>" + String(MqttManager::getInstance().isConnected() ? "connected" : "disconnected") + "</td></tr>";
    const auto& sd = SdFifo::getInstance().status();
    html += "<tr><th>SD Mounted</th><td>" + String(sd.mounted ? "yes" : "no") + "</td></tr>";
    html += "<tr><th>SD Records</th><td>" + String(sd.recordCount) + "</td></tr>";
    html += "</table></div>";

    // ── Left RS485 bus TX pin diagnostic ─────────────────────────────────────
    html += "<div class='card'><h2>Left RS485 TX Pin Diagnostic (GPIO" + String(PIN_LEFT_RS485_TX) + ")</h2>";
    html += "<p>Pulses GPIO" + String(PIN_LEFT_RS485_TX) + " HIGH/LOW 5 times (~6s). "
            "Measure with multimeter between GPIO" + String(PIN_LEFT_RS485_TX) + " pad and GND while test runs.</p>"
            "<ul><li><b>Voltage alternates 0V ↔ 3.3V</b> → ESP32 GPIO OK, check PCB trace to Waveshare TXD or replace Waveshare module</li>"
            "<li><b>Constant 3.3V or 0V</b> → GPIO" + String(PIN_LEFT_RS485_TX) + " output not reaching your probe point — broken trace or cold joint</li></ul>";
    html += "<form method='POST' action='/diagnostics'>"
            "<input type='hidden' name='action' value='left_tx_pulse'>"
            "<button type='submit' class='btn btn-warn'>Pulse Left TX GPIO" + String(PIN_LEFT_RS485_TX) + " (blocks ~6s)</button>"
            "</form></div>";

    html += htmlFooter();
    _server.send(200, "text/html", html);
}

void LocalWebserver::handleDiagnosticsPost() {
    if (!checkAuth()) { sendUnauth(); return; }
    if (_server.arg("action") == "left_tx_pulse") {
        Rs485RtuMaster::getInstance().diagTxPulse(RtuBus::LEFT);
    }
    _server.sendHeader("Location", "/diagnostics");
    _server.send(302, "text/plain", "");
}

void LocalWebserver::handleRelayTest() {
    if (!checkAuth()) { sendUnauth(); return; }
    String html = htmlHeader("Relay Test") + navBar("relay-test");

#ifdef ST485_RTU4CH_WAVE485_MODE
    // ── Bus selector ──────────────────────────────────────────────────────────
    const bool busIsLeft = (_server.arg("bus") == "left");
    const RtuBus selBus  = busIsLeft ? RtuBus::LEFT : RtuBus::RIGHT;
    const auto& bstat    = busIsLeft ? RemoteBoxManager::getInstance().leftStatus()
                                     : RemoteBoxManager::getInstance().rightStatus();
    const char* busLabel = busIsLeft ? "LEFT" : "RIGHT";

    html += "<div class='card'><h2>RTU Relay Test — Select Bus</h2>"
            "<a href='/relay-test?bus=left' class='btn" + String(busIsLeft ? " btn-warn" : "") + "'>LEFT Bus</a>&nbsp;"
            "<a href='/relay-test?bus=right' class='btn" + String(!busIsLeft ? " btn-warn" : "") + "'>RIGHT Bus</a>"
            "</div>";

    // ── Selected bus status ───────────────────────────────────────────────────
    const char* stateStr =
        bstat.rtuState == RtuState::ONLINE      ? "ONLINE" :
        bstat.rtuState == RtuState::LOW_BATTERY ? "LOW_BATTERY" :
        bstat.rtuState == RtuState::LVD_TRIPPED ? "LVD_TRIPPED" : "COMM_LOST";
    const char* stateCss =
        bstat.rtuState == RtuState::ONLINE      ? "ok" :
        bstat.rtuState == RtuState::COMM_LOST   ? "err" : "warn";

    html += "<div class='card'><h2>" + String(busLabel) + " Bus — ST485-4CH Status</h2><table>";
    html += "<tr><th>State</th><td><span class='" + String(stateCss) + "'>" + String(stateStr) + "</span></td></tr>";
    html += "<tr><th>Online</th><td>" + String(bstat.online ? "Yes" : "No") + "</td></tr>";
    html += "<tr><th>R1 Siren</th><td>" + String(bstat.sirenOn ? "<span class='warn'>ON</span>" : "OFF") + "</td></tr>";
    html += "<tr><th>R2 Flash</th><td>" + String(bstat.flashOn ? "<span class='warn'>ON</span>" : "OFF") + "</td></tr>";
    html += "<tr><th>R3 Voice</th><td>" + String(bstat.voiceOn ? "<span class='warn'>ON</span>" : "OFF") + "</td></tr>";
    html += "<tr><th>R4 Boom</th><td>"  + String(bstat.boomOn  ? "<span class='warn'>ON</span>" : "OFF") + "</td></tr>";
    html += "</table></div>";

    // ── Individual relay control ──────────────────────────────────────────────
    const String busParam = busIsLeft ? "left" : "right";
    html += "<div class='card'><h2>" + String(busLabel) + " Bus — Individual Relay Control</h2>";
    html += "<p style='color:#f57c00'>Commands suspend auto-control for 15 min.</p>";

    // R1
    html += "<b>R1 — Siren</b><br>"
            "<form style='display:inline' method='POST' action='/relay-test'>"
            "<input type='hidden' name='action' value='rtu_on'>"
            "<input type='hidden' name='coil' value='0'>"
            "<input type='hidden' name='bus' value='" + busParam + "'>"
            "<button type='submit' class='btn btn-warn'>ON</button></form> "
            "<form style='display:inline' method='POST' action='/relay-test'>"
            "<input type='hidden' name='action' value='rtu_off'>"
            "<input type='hidden' name='coil' value='0'>"
            "<input type='hidden' name='bus' value='" + busParam + "'>"
            "<button type='submit' class='btn'>OFF</button></form><br><br>";
    // R2
    html += "<b>R2 — Flash</b><br>"
            "<form style='display:inline' method='POST' action='/relay-test'>"
            "<input type='hidden' name='action' value='rtu_on'>"
            "<input type='hidden' name='coil' value='1'>"
            "<input type='hidden' name='bus' value='" + busParam + "'>"
            "<button type='submit' class='btn btn-warn'>ON</button></form> "
            "<form style='display:inline' method='POST' action='/relay-test'>"
            "<input type='hidden' name='action' value='rtu_off'>"
            "<input type='hidden' name='coil' value='1'>"
            "<input type='hidden' name='bus' value='" + busParam + "'>"
            "<button type='submit' class='btn'>OFF</button></form><br><br>";
    // R3
    html += "<b>R3 — Voice</b><br>"
            "<form style='display:inline' method='POST' action='/relay-test'>"
            "<input type='hidden' name='action' value='rtu_on'>"
            "<input type='hidden' name='coil' value='2'>"
            "<input type='hidden' name='bus' value='" + busParam + "'>"
            "<button type='submit' class='btn btn-warn'>ON</button></form> "
            "<form style='display:inline' method='POST' action='/relay-test'>"
            "<input type='hidden' name='action' value='rtu_off'>"
            "<input type='hidden' name='coil' value='2'>"
            "<input type='hidden' name='bus' value='" + busParam + "'>"
            "<button type='submit' class='btn'>OFF</button></form><br><br>";
    // R4
    html += "<b>R4 — Boom Barrier</b> <span style='color:#888'>(reserved)</span><br>"
            "<form style='display:inline' method='POST' action='/relay-test'>"
            "<input type='hidden' name='action' value='rtu_on'>"
            "<input type='hidden' name='coil' value='3'>"
            "<input type='hidden' name='bus' value='" + busParam + "'>"
            "<button type='submit' class='btn btn-danger' onclick=\"return confirm('R4 Boom: are you sure?')\">ON</button></form> "
            "<form style='display:inline' method='POST' action='/relay-test'>"
            "<input type='hidden' name='action' value='rtu_off'>"
            "<input type='hidden' name='coil' value='3'>"
            "<input type='hidden' name='bus' value='" + busParam + "'>"
            "<button type='submit' class='btn'>OFF</button></form><br><br>";
    // All OFF
    html += "<form method='POST' action='/relay-test'>"
            "<input type='hidden' name='action' value='rtu_all_off'>"
            "<input type='hidden' name='bus' value='" + busParam + "'>"
            "<button type='submit' class='btn btn-danger'>All Relays OFF</button></form>";
    html += "</div>";

    // ── Local S3 board outputs ────────────────────────────────────────────────
    html += "<div class='card'><h2>Local S3 Board Outputs</h2>"
            "<p style='color:#888'>Relays physically on the main Edgehax S3 PCB (not RTU remote box).</p>"
            "<p style='color:#f57c00'>Page hangs briefly during test — normal.</p>"
            "<form method='POST' action='/relay-test'>"
            "<button type='submit' name='relay' value='siren' class='btn btn-warn'>Test Siren (3s)</button><br><br>"
            "<button type='submit' name='relay' value='flash' class='btn btn-warn'>Test Flash (5s)</button><br><br>"
            "<button type='submit' name='relay' value='voice' class='btn'>Test Voice (3s)</button><br><br>"
            "<button type='submit' name='relay' value='pump' class='btn btn-danger' onclick=\"return confirm('Confirm pump test?')\">Test Pump (5s)</button><br><br>"
            "<button type='submit' name='relay' value='rf_siren' class='btn btn-warn'>Test RF Siren (3s)</button><br><br>"
            "<button type='submit' name='relay' value='rf_pump' class='btn btn-warn'>Test RF Pump (3s)</button>"
            "</form></div>";

#else
    // ── Non-ST485 mode: simple local relay test ───────────────────────────────
    const bool lastOk = _server.arg("result") == "ok";
    const String lastRelay = _server.arg("relay");
    html += "<div class='card'><h2>Local Relay Test</h2>";
    if (lastOk && lastRelay.length() > 0) {
        html += "<p style='color:#388e3c'><b>Test complete:</b> " + lastRelay + "</p>";
    }
    html += "<p style='color:#f57c00'>Page hangs briefly during test — normal.</p>"
            "<form method='POST' action='/relay-test'>"
            "<button type='submit' name='relay' value='siren' class='btn btn-warn'>Test Siren (3s)</button><br><br>"
            "<button type='submit' name='relay' value='flash' class='btn btn-warn'>Test Flash (5s)</button><br><br>"
            "<button type='submit' name='relay' value='voice' class='btn'>Test Voice/Future (3s)</button><br><br>"
            "<button type='submit' name='relay' value='pump' class='btn btn-danger' onclick=\"return confirm('Confirm pump test?')\">Test Pump (5s)</button><br><br>"
            "<button type='submit' name='relay' value='rf_siren' class='btn btn-warn'>Test RF Siren (3s)</button><br><br>"
            "<button type='submit' name='relay' value='rf_pump'  class='btn btn-warn'>Test RF Pump (3s)</button>"
            "</form></div>";
#endif

    html += htmlFooter();
    _server.send(200, "text/html", html);
}

void LocalWebserver::handleRelayTestPost() {
    if (!checkAuth()) { sendUnauth(); return; }

    const String action = _server.arg("action");

#ifdef ST485_RTU4CH_WAVE485_MODE
    if (action == "rtu_on" || action == "rtu_off" || action == "rtu_all_off") {
        const bool busLeft = (_server.arg("bus") == "left");
        const RtuBus bus   = busLeft ? RtuBus::LEFT : RtuBus::RIGHT;
        const String busParam = busLeft ? "left" : "right";
        bool ok = false;
        if (action == "rtu_all_off") {
            ok = RemoteBoxManager::getInstance().manualSetSirenFlash(bus, false, false);
        } else {
            const uint8_t coil = (uint8_t)constrain(_server.arg("coil").toInt(), 0, 3);
            ok = RemoteBoxManager::getInstance().manualSetSingleRelay(bus, coil, action == "rtu_on");
        }
        if (!ok) {
            _server.send(500, "text/html",
                htmlHeader("Relay Test") + navBar("relay-test") +
                "<div class='card'><p class='err'>RTU command failed. Check wiring and slave ID.</p>"
                "<a href='/relay-test?bus=" + busParam + "'>Back</a></div>" + htmlFooter());
            return;
        }
        _server.sendHeader("Location", "/relay-test?bus=" + busParam);
        _server.send(302, "text/plain", "");
        return;
    }
#endif

    auto& out = OutputController::getInstance();
    const String relay = _server.arg("relay");
    if      (relay == "siren")    { out.setSiren(true);          delay(3000); out.setSiren(false); }
    else if (relay == "flash")    { out.setFlash(true);          delay(5000); out.setFlash(false); }
    else if (relay == "voice")    { out.setVoiceFuture(true);    delay(3000); out.setVoiceFuture(false); }
    else if (relay == "pump")     { out.setSumpPump(true);       delay(5000); out.setSumpPump(false); }
    Serial.printf("[WEB] Relay test: %s\n", relay.c_str());
#ifdef ST485_RTU4CH_WAVE485_MODE
    _server.sendHeader("Location", "/relay-test?bus=right&result=ok&relay=" + relay);
#else
    _server.sendHeader("Location", "/relay-test?result=ok&relay=" + relay);
#endif
    _server.send(302, "text/plain", "");
}

void LocalWebserver::handleRemoteTest() {
    if (!checkAuth()) { sendUnauth(); return; }
    String html = htmlHeader("Remote Test") + navBar("remote-test");

#ifdef ST485_RTU4CH_WAVE485_MODE
    const auto& right = RemoteBoxManager::getInstance().rightStatus();

    // ── Status card ─────────────────────────────────────────────────────────
    const char* rtuStateStr =
        right.rtuState == RtuState::ONLINE      ? "ONLINE" :
        right.rtuState == RtuState::LOW_BATTERY ? "LOW_BATTERY" :
        right.rtuState == RtuState::LVD_TRIPPED ? "LVD_TRIPPED" : "COMM_LOST";
    const char* rtuStateCss =
        right.rtuState == RtuState::ONLINE      ? "ok" :
        right.rtuState == RtuState::COMM_LOST   ? "err" : "warn";

    html += "<div class='card'><h2>ST485-4CH Right Bus Status</h2><table>";
    html += "<tr><th>RTU State</th><td><span class='" + String(rtuStateCss) + "'>"
            + String(rtuStateStr) + "</span></td></tr>";
    html += "<tr><th>Online</th><td>" + String(right.online ? "Yes" : "No") + "</td></tr>";
    html += "<tr><th>Poll Time</th><td>" + String(right.pollTimeMs) + " ms</td></tr>";
    html += "<tr><th>R1 Siren (FC1)</th><td>" + String(right.sirenOn ? "<span class='warn'>ON</span>" : "OFF") + "</td></tr>";
    html += "<tr><th>R2 Flash (FC1)</th><td>" + String(right.flashOn ? "<span class='warn'>ON</span>" : "OFF") + "</td></tr>";
    html += "<tr><th>R3 Voice (FC1)</th><td>" + String(right.voiceOn ? "<span class='warn'>ON</span>" : "OFF") + "</td></tr>";
    html += "<tr><th>R4 Boom (FC1)</th><td>" + String(right.boomOn  ? "<span class='warn'>ON</span>" : "OFF") + "</td></tr>";
    html += "<tr><th>IN1 Siren Conf (DI)</th><td>" + String(right.di_sirenConf ? "<span class='warn'>ACTIVE</span>" : "idle") + "</td></tr>";
    html += "<tr><th>IN2 Flash Conf (DI)</th><td>" + String(right.di_flashConf ? "<span class='warn'>ACTIVE</span>" : "idle") + "</td></tr>";
    html += "<tr><th>IN3 Voice Conf (DI)</th><td>" + String(right.di_voiceConf ? "<span class='warn'>ACTIVE</span>" : "idle") + "</td></tr>";
    html += "<tr><th>IN4 Batt Low (DI)</th><td>" + String(right.di_batteryLow ? "<span class='err'>LOW</span>" : "OK") + "</td></tr>";
    html += "<tr><th>R1 Faulty</th><td>" + String(right.sirenFaulty ? "<span class='err'>FAULTY</span>" : "OK") + "</td></tr>";
    html += "<tr><th>R2 Faulty</th><td>" + String(right.flashFaulty ? "<span class='err'>FAULTY</span>" : "OK") + "</td></tr>";
    html += "<tr><th>R3 Faulty</th><td>" + String(right.voiceFaulty ? "<span class='err'>FAULTY</span>" : "OK") + "</td></tr>";
    html += "</table></div>";

    // ── Individual relay control ─────────────────────────────────────────────
    html += "<div class='card'><h2>ST485-4CH Relay Manual Control</h2>";
    html += "<p style='color:#f57c00'>Manual commands suspend auto-control for 15 minutes.</p>";
    // R1 Siren
    html += "<b>R1 — Siren</b><br>"
            "<form style='display:inline' method='POST' action='/remote-test'>"
            "<input type='hidden' name='action' value='st485_r1_on'>"
            "<button type='submit' class='btn btn-warn'>ON</button></form> "
            "<form style='display:inline' method='POST' action='/remote-test'>"
            "<input type='hidden' name='action' value='st485_r1_off'>"
            "<button type='submit' class='btn'>OFF</button></form><br><br>";
    // R2 Flash
    html += "<b>R2 — Flash</b><br>"
            "<form style='display:inline' method='POST' action='/remote-test'>"
            "<input type='hidden' name='action' value='st485_r2_on'>"
            "<button type='submit' class='btn btn-warn'>ON</button></form> "
            "<form style='display:inline' method='POST' action='/remote-test'>"
            "<input type='hidden' name='action' value='st485_r2_off'>"
            "<button type='submit' class='btn'>OFF</button></form><br><br>";
    // R3 Voice
    html += "<b>R3 — Voice</b><br>"
            "<form style='display:inline' method='POST' action='/remote-test'>"
            "<input type='hidden' name='action' value='st485_r3_on'>"
            "<button type='submit' class='btn btn-warn'>ON</button></form> "
            "<form style='display:inline' method='POST' action='/remote-test'>"
            "<input type='hidden' name='action' value='st485_r3_off'>"
            "<button type='submit' class='btn'>OFF</button></form><br><br>";
    // R4 Boom — reserved
    html += "<b>R4 — Boom Barrier</b> <span style='color:#888'>(reserved)</span><br>"
            "<form style='display:inline' method='POST' action='/remote-test'>"
            "<input type='hidden' name='action' value='st485_r4_on'>"
            "<button type='submit' class='btn btn-danger' "
            "onclick=\"return confirm('R4 Boom: are you sure?')\">ON</button></form> "
            "<form style='display:inline' method='POST' action='/remote-test'>"
            "<input type='hidden' name='action' value='st485_r4_off'>"
            "<button type='submit' class='btn'>OFF</button></form><br><br>";
    // All OFF
    html += "<form method='POST' action='/remote-test'>"
            "<input type='hidden' name='action' value='st485_all_off'>"
            "<button type='submit' class='btn btn-danger'>All Relays OFF</button></form>";
    html += "</div>";

#else  // generic / legacy path
    const auto& left  = RemoteBoxManager::getInstance().leftStatus();
    const auto& right = RemoteBoxManager::getInstance().rightStatus();
    const uint8_t genericAddr  = g_genericRelayStatus.slaveId;
    const uint8_t genericModel = clampGenericRelayModel(g_genericRelayStatus.moduleType);

    html += "<div class='card'><h2>Remote Box Status</h2><table>";
    html += "<tr><th>Box</th><th>Online</th><th>Battery</th><th>Siren</th><th>Flash</th><th>Pump</th></tr>";
#ifdef GENERIC_REMOTE_RELAY_MODE
    html += "<tr><td>Left Relay (" + String(GENERIC_REMOTE_RELAY_LEFT_MODEL) + "CH, ID" + String(GENERIC_REMOTE_RELAY_LEFT_ADDR) + ")</td><td>" + String(left.online?"Y":"N") + "</td><td>"
            + String(left.batteryVoltage,1) + "V</td><td>" + String(left.sirenOn?"ON":"off")
            + "</td><td>" + String(left.flashOn?"ON":"off") + "</td><td>N/A</td></tr>";
    html += "<tr><td>Right Relay (" + String(GENERIC_REMOTE_RELAY_RIGHT_MODEL) + "CH, ID" + String(GENERIC_REMOTE_RELAY_RIGHT_ADDR) + ")</td><td>" + String(right.online?"Y":"N") + "</td><td>"
            + String(right.batteryVoltage,1) + "V</td><td>" + String(right.sirenOn?"ON":"off")
            + "</td><td>" + String(right.flashOn?"ON":"off") + "</td><td>N/A</td></tr>";
#else
    html += "<tr><td>Left (ID11)</td><td>" + String(left.online?"Y":"N") + "</td><td>"
            + String(left.batteryVoltage,1) + "V</td><td>" + String(left.sirenOn?"ON":"off")
            + "</td><td>" + String(left.flashOn?"ON":"off") + "</td><td>" + String(left.pumpOn?"ON":"off") + "</td></tr>";
    html += "<tr><td>Right (ID12)</td><td>" + String(right.online?"Y":"N") + "</td><td>"
            + String(right.batteryVoltage,1) + "V</td><td>" + String(right.sirenOn?"ON":"off")
            + "</td><td>" + String(right.flashOn?"ON":"off") + "</td><td>" + String(right.pumpOn?"ON":"off") + "</td></tr>";
#endif
    html += "</table></div>";

    html += "<div class='card'><h2>Right Box Manual RTU Test</h2>";
    html += "<p>Send immediate Modbus commands to right remote box.</p>";
    html += "<form method='POST' action='/remote-test'>"
            "<input type='hidden' name='action' value='right_siren_on'>"
            "<button type='submit' class='btn'>Right Siren ON</button></form>";
    html += "<form method='POST' action='/remote-test'>"
            "<input type='hidden' name='action' value='right_siren_off'>"
            "<button type='submit' class='btn'>Right Siren OFF</button></form>";
    html += "<form method='POST' action='/remote-test'>"
            "<input type='hidden' name='action' value='right_flash_on'>"
            "<button type='submit' class='btn'>Right Flash ON</button></form>";
    html += "<form method='POST' action='/remote-test'>"
            "<input type='hidden' name='action' value='right_flash_off'>"
            "<button type='submit' class='btn'>Right Flash OFF</button></form>";
    html += "<form method='POST' action='/remote-test'>"
            "<input type='hidden' name='action' value='right_all_off'>"
            "<button type='submit' class='btn'>Right All OFF</button></form></div>";

    html += "<div class='card'><h2>Generic Modbus Relay Module Test</h2>";
    html += "<p>Use this for standard RTU relay modules on the right bus.</p>";
    html += "<form method='POST' action='/remote-test'>"
            + genericRelayConfigFields(genericAddr, genericModel) +
            "<input type='hidden' name='action' value='generic_r1_on'>"
            "<button type='submit' class='btn'>Relay 1 ON</button></form>";
    html += "<form method='POST' action='/remote-test'>"
            + genericRelayConfigFields(genericAddr, genericModel) +
            "<input type='hidden' name='action' value='generic_r1_off'>"
            "<button type='submit' class='btn'>Relay 1 OFF</button></form>";
    html += "<form method='POST' action='/remote-test'>"
            + genericRelayConfigFields(genericAddr, genericModel) +
            "<input type='hidden' name='action' value='generic_r2_on'>"
            "<button type='submit' class='btn'>Relay 2 ON</button></form>";
    html += "<form method='POST' action='/remote-test'>"
            + genericRelayConfigFields(genericAddr, genericModel) +
            "<input type='hidden' name='action' value='generic_r2_off'>"
            "<button type='submit' class='btn'>Relay 2 OFF</button></form>";
    html += "<form method='POST' action='/remote-test'>"
            + genericRelayConfigFields(genericAddr, genericModel) +
            "<input type='hidden' name='action' value='generic_r3_on'>"
            "<button type='submit' class='btn'>Relay 3 ON</button></form>";
    html += "<form method='POST' action='/remote-test'>"
            + genericRelayConfigFields(genericAddr, genericModel) +
            "<input type='hidden' name='action' value='generic_r3_off'>"
            "<button type='submit' class='btn'>Relay 3 OFF</button></form>";
    html += "<form method='POST' action='/remote-test'>"
            + genericRelayConfigFields(genericAddr, genericModel) +
            "<input type='hidden' name='action' value='generic_r4_on'>"
            "<button type='submit' class='btn'>Relay 4 ON</button></form>";
    html += "<form method='POST' action='/remote-test'>"
            + genericRelayConfigFields(genericAddr, genericModel) +
            "<input type='hidden' name='action' value='generic_r4_off'>"
            "<button type='submit' class='btn'>Relay 4 OFF</button></form>";
    html += "<form method='POST' action='/remote-test'>"
            + genericRelayConfigFields(genericAddr, genericModel) +
            "<input type='hidden' name='action' value='generic_read_status'>"
            "<button type='submit' class='btn btn-warn'>Read Relay Status</button></form>";
    html += "<form method='POST' action='/remote-test'>"
            + genericRelayConfigFields(genericAddr, genericModel) +
            "<input type='hidden' name='action' value='generic_read_addr'>"
            "<button type='submit' class='btn btn-warn'>Read Module Address</button></form>";
    html += "<form method='POST' action='/remote-test'>"
            + genericRelayConfigFields(genericAddr, genericModel) +
            "<label>New Address</label><input type='number' min='1' max='255' name='new_addr' value='" + String(genericAddr) + "'>"
            "<input type='hidden' name='action' value='generic_set_addr'>"
            "<button type='submit' class='btn btn-warn'>Set Module Address</button></form></div>";

    html += "<div class='card'><h2>Generic Module Last Read</h2><table>";
    html += "<tr><th>Module Address</th><td>" + String(g_genericRelayStatus.slaveId) + "</td></tr>";
    html += "<tr><th>Module Type</th><td>" + String(genericRelayModelLabel(g_genericRelayStatus.moduleType)) + "</td></tr>";
    html += "<tr><th>Relay Count</th><td>" + String(g_genericRelayStatus.relayCount) + "</td></tr>";
    if (g_genericRelayStatus.valid) {
        html += "<tr><th>Link</th><td><span class='ok'>OK</span></td></tr>";
        html += "<tr><th>Relay 1</th><td>" + String(g_genericRelayStatus.relay1On ? "ON" : "OFF") + "</td></tr>";
        html += "<tr><th>Relay 2</th><td>" + String(g_genericRelayStatus.relay2On ? "ON" : "OFF") + "</td></tr>";
        html += "<tr><th>Relay 3</th><td>" + String(g_genericRelayStatus.relayCount >= 3 ? (g_genericRelayStatus.relay3On ? "ON" : "OFF") : "N/A") + "</td></tr>";
        html += "<tr><th>Relay 4</th><td>" + String(g_genericRelayStatus.relayCount >= 4 ? (g_genericRelayStatus.relay4On ? "ON" : "OFF") : "N/A") + "</td></tr>";
    } else {
        html += "<tr><th>Link</th><td><span class='err'>No valid status yet</span></td></tr>";
        html += "<tr><th>Last Error</th><td>0x" + String(g_genericRelayStatus.exceptionCode, HEX) + "</td></tr>";
    }
    html += "</table></div>";
#endif  // ST485_RTU4CH_WAVE485_MODE

    html += htmlFooter();
    _server.send(200, "text/html", html);
}

void LocalWebserver::handleRemoteTestPost() {
    if (!checkAuth()) { sendUnauth(); return; }

    const String action = _server.arg("action");
    bool ok = false;

#ifdef ST485_RTU4CH_WAVE485_MODE
    auto& rem = RemoteBoxManager::getInstance();
    if (action == "st485_r1_on") {
        ok = rem.manualSetSingleRelay(RtuBus::RIGHT, 0, true);
    } else if (action == "st485_r1_off") {
        ok = rem.manualSetSingleRelay(RtuBus::RIGHT, 0, false);
    } else if (action == "st485_r2_on") {
        ok = rem.manualSetSingleRelay(RtuBus::RIGHT, 1, true);
    } else if (action == "st485_r2_off") {
        ok = rem.manualSetSingleRelay(RtuBus::RIGHT, 1, false);
    } else if (action == "st485_r3_on") {
        ok = rem.manualSetSingleRelay(RtuBus::RIGHT, 2, true);
    } else if (action == "st485_r3_off") {
        ok = rem.manualSetSingleRelay(RtuBus::RIGHT, 2, false);
    } else if (action == "st485_r4_on") {
        ok = rem.manualSetSingleRelay(RtuBus::RIGHT, 3, true);
    } else if (action == "st485_r4_off") {
        ok = rem.manualSetSingleRelay(RtuBus::RIGHT, 3, false);
    } else if (action == "st485_all_off") {
        ok = rem.manualSetSirenFlash(RtuBus::RIGHT, false, false);
    }
    if (!ok) {
        _server.send(500, "text/html",
            htmlHeader("Remote Test") + navBar("remote-test") +
            "<div class='card'><p class='err'>ST485 RTU command failed. "
            "Check right bus wiring (GPIO39 TX → Waveshare RXD, GPIO38 RX → Waveshare TXD), "
            "slave ID 1, baud 9600.</p>"
            "<a href='/remote-test'>Back</a></div>" + htmlFooter());
        return;
    }
    _server.sendHeader("Location", "/remote-test");
    _server.send(302, "text/plain", "");
    return;
#endif  // ST485_RTU4CH_WAVE485_MODE

    if (action == "right_siren_on") {
        ok = RemoteBoxManager::getInstance().manualSetSirenFlash(RtuBus::RIGHT, true, false);
    } else if (action == "right_siren_off") {
        ok = RemoteBoxManager::getInstance().manualSetSirenFlash(RtuBus::RIGHT, false, false);
    } else if (action == "right_flash_on") {
        ok = RemoteBoxManager::getInstance().manualSetSirenFlash(RtuBus::RIGHT, false, true);
    } else if (action == "right_flash_off") {
        ok = RemoteBoxManager::getInstance().manualSetSirenFlash(RtuBus::RIGHT, false, false);
    } else if (action == "right_all_off") {
        ok = RemoteBoxManager::getInstance().manualSetSirenFlash(RtuBus::RIGHT, false, false);
    } else if (action == "generic_r1_on" || action == "generic_r1_off" ||
               action == "generic_r2_on" || action == "generic_r2_off" ||
               action == "generic_r3_on" || action == "generic_r3_off" ||
               action == "generic_r4_on" || action == "generic_r4_off" ||
               action == "generic_read_status" || action == "generic_read_addr" ||
               action == "generic_set_addr") {
        const uint8_t slaveId = (uint8_t)constrain(_server.arg("modbus_addr").toInt(), 1, 255);
        const uint8_t moduleType = clampGenericRelayModel(_server.arg("module_type").toInt());

        if (action == "generic_read_status") {
            uint8_t coilByte = 0;
            Serial.printf("[RTU] Generic module status read right bus id=%d type=%s\n",
                          (int)slaveId, genericRelayModelLabel(moduleType));
            const RtuResult result = readGenericRelaySnapshot(RtuBus::RIGHT, slaveId, moduleType, coilByte);
            updateGenericRelaySnapshot(g_genericRelayStatus, slaveId, moduleType, result.ok, result.exceptionCode, coilByte);
            ok = true;
        } else if (action == "generic_read_addr") {
            uint16_t addrReg[1] = {0};
            const uint16_t addrRegStart = genericRelayAddressRegisterFromModel(moduleType);
            Serial.printf("[RTU] Generic module address read right bus type=%s reg=0x%04X\n",
                          genericRelayModelLabel(moduleType), (unsigned)addrRegStart);
            const RtuResult result = Rs485RtuMaster::getInstance().readHolding(
                RtuBus::RIGHT, 0x00, addrRegStart, 1, addrReg);
            const uint8_t detectedAddr = result.ok ? (uint8_t)constrain((int)addrReg[0], 1, 255) : slaveId;
            updateGenericRelaySnapshot(g_genericRelayStatus, detectedAddr, moduleType, result.ok, result.exceptionCode, 0);
            ok = result.ok;
        } else if (action == "generic_set_addr") {
            const uint8_t newAddr = (uint8_t)constrain(_server.arg("new_addr").toInt(), 1, 255);
            RtuResult writeResult{false, 0xFF};
            if (moduleType >= kGenericRelayModel4Ch) {
                writeResult = Rs485RtuMaster::getInstance().writeSingle(
                    RtuBus::RIGHT, 0x00, genericRelayAddressRegisterFromModel(moduleType), newAddr);
            } else {
                const uint16_t values[1] = {newAddr};
                writeResult = Rs485RtuMaster::getInstance().writeMultipleRegisters(
                    RtuBus::RIGHT, 0x00, genericRelayAddressRegisterFromModel(moduleType), values, 1);
            }

            uint16_t addrReg[1] = {0};
            const RtuResult readResult = Rs485RtuMaster::getInstance().readHolding(
                RtuBus::RIGHT, 0x00, genericRelayAddressRegisterFromModel(moduleType), 1, addrReg);
            const bool readOk = readResult.ok;
            const uint8_t confirmedAddr = readOk ? (uint8_t)constrain((int)addrReg[0], 1, 255) : newAddr;
            updateGenericRelaySnapshot(
                g_genericRelayStatus, confirmedAddr, moduleType,
                readOk, writeResult.ok ? readResult.exceptionCode : writeResult.exceptionCode, 0);
            ok = writeResult.ok && readOk && confirmedAddr == newAddr;
        } else {
            const uint16_t firstCoil = genericRelayFirstCoilFromModel(moduleType);
            uint8_t logicalBit = 0;
            bool coilOn = false;
            if (action == "generic_r1_on") {
                logicalBit = 0;
                coilOn = true;
            } else if (action == "generic_r1_off") {
                logicalBit = 0;
                coilOn = false;
            } else if (action == "generic_r2_on") {
                logicalBit = 1;
                coilOn = true;
            } else if (action == "generic_r2_off") {
                logicalBit = 1;
                coilOn = false;
            } else if (action == "generic_r3_on") {
                logicalBit = 2;
                coilOn = true;
            } else if (action == "generic_r3_off") {
                logicalBit = 2;
                coilOn = false;
            } else if (action == "generic_r4_on") {
                logicalBit = 3;
                coilOn = true;
            } else if (action == "generic_r4_off") {
                logicalBit = 3;
                coilOn = false;
            }
            const uint16_t coilAddr = firstCoil + logicalBit;
            Serial.printf("[RTU] Generic module test right bus id=%d type=%s coil=%u on=%d\n",
                          (int)slaveId, genericRelayModelLabel(moduleType),
                          (unsigned)coilAddr, coilOn ? 1 : 0);
            RemoteBoxManager::getInstance().suspendAutoControl();
            const uint16_t primaryOnValue = genericRelayPrimaryOnValueFromModel(moduleType);
            const uint16_t alternateOnValue = genericRelayAlternateOnValueFromModel(moduleType);
            GenericRelayWriteResult commandResult;
            bool commandOk = performGenericRelayWriteAttempt(
                RtuBus::RIGHT, slaveId, moduleType, coilAddr, logicalBit, coilOn, primaryOnValue, commandResult);
            if (!commandOk && coilOn && alternateOnValue != primaryOnValue) {
                Serial.printf("[RTU] Generic module retry right bus id=%d coil=%u alt_on=0x%04X\n",
                              (int)slaveId, (unsigned)coilAddr, (unsigned)alternateOnValue);
                commandOk = performGenericRelayWriteAttempt(
                    RtuBus::RIGHT, slaveId, moduleType, coilAddr, logicalBit, coilOn, alternateOnValue, commandResult);
            }
            const bool linkOk = commandResult.writeResult.ok || commandResult.readResult.ok;
            uint8_t effectiveCoilByte = commandResult.coilByte;
            if (!commandResult.readResult.ok) {
                effectiveCoilByte = snapshotCoilByte(g_genericRelayStatus);
                const uint8_t mask = (uint8_t)(1U << logicalBit);
                if (commandResult.writeResult.ok) {
                    if (coilOn) effectiveCoilByte |= mask;
                    else        effectiveCoilByte &= (uint8_t)~mask;
                }
            }
            updateGenericRelaySnapshot(
                g_genericRelayStatus, slaveId, moduleType,
                linkOk,
                commandResult.writeResult.ok ? commandResult.readResult.exceptionCode : commandResult.writeResult.exceptionCode,
                effectiveCoilByte);
            const uint8_t mask = (uint8_t)(1U << logicalBit);
            const bool observedState = (effectiveCoilByte & mask) != 0;
            ok = commandOk || (commandResult.readResult.ok && observedState == coilOn);
        }
    }

    if (!ok) {
        const bool genericAction = action.startsWith("generic_");
        _server.send(500, "text/html",
            htmlHeader("Remote Test") + navBar("remote-test") +
            "<div class='card'><p class='err'>" +
            String(genericAction
                ? "Generic relay RTU command failed. Check module address, module type, right bus wiring, and module baud rate."
                : "Right RTU command failed. Check slave ID, right bus wiring, DE/RE, and module baud/address.") +
            "</p>"
            "<a href='/remote-test'>Back</a></div>" + htmlFooter());
        return;
    }

    _server.sendHeader("Location", "/remote-test");
    _server.send(302, "text/plain", "");
}

void LocalWebserver::handleCalibration() {
    if (!checkAuth()) { sendUnauth(); return; }
    const auto& dyp  = DypSensor::getInstance().snapshot();
    const auto& cfg  = ConfigManager::getInstance().get();
    const auto& vmon = VoltageMonitor::getInstance().snapshot();
    String html = htmlHeader("Calibration") + navBar("calibration");
    html += "<div class='card'><h2>Sensor Zero Calibration</h2>";
    html += "<p>Current distance: <b>" + String(dyp.distanceMm) + " mm</b> | "
            "Sensor valid: <b>" + String(dyp.valid?"yes":"no") + "</b></p>";
    html += "<p>Current zero distance: <b>" + String(cfg.zeroDistanceMm) + " mm</b></p>";
    html += "<form method='POST' action='/calibration'>"
            "<input type='hidden' name='action' value='zero'>"
            "<button type='submit' class='btn'>Set Current Reading as Ground Zero</button></form>";

    html += "<h2>Battery / Supply Monitor (INA219)</h2>";
    html += "<p>Voltage: <b>" + String(vmon.voltage, 2) + " V</b> &nbsp; "
            "Current: <b>" + String(vmon.currentMa, 1) + " mA</b> &nbsp; "
            "Power: <b>" + String(vmon.powerMw, 0) + " mW</b></p>";
    html += "<p>Cal factor: <b>" + String(cfg.vMonCalFactor, 4) + "</b></p>";
    html += "<p class='hint'>If the voltage shown above does not match your multimeter, "
            "enter the actual measured voltage below. The calibration factor will be updated automatically.</p>";
    html += "<form method='POST' action='/calibration'>"
            "<input type='hidden' name='action' value='vmon_cal'>"
            "<label>Actual Voltage from Multimeter (V)</label>"
            "<input type='number' name='vmon_actual_v' step='0.01' min='1' max='30' "
            "value='" + String(vmon.voltage, 2) + "'>"
            "<button type='submit' class='btn'>Set Voltage Calibration</button>"
            "</form></div>";
    html += htmlFooter();
    _server.send(200, "text/html", html);
}

void LocalWebserver::handleCalibrationPost() {
    if (!checkAuth()) { sendUnauth(); return; }
    const String action = _server.arg("action");
    String reason;
    bool ok = false;

    if (action == "zero") {
        ok = DypSensor::getInstance().setZeroFromCurrentReading(reason);
        if (ok) {
            const uint16_t z = (uint16_t)DypSensor::getInstance().zeroDistanceMm();
            ConfigManager::getInstance().setZeroDistance(z, reason);
        }
    }

    if (action == "vmon_cal") {
        if (!_server.hasArg("vmon_actual_v")) {
            reason = "missing_actual_voltage";
        } else {
            const float actualV = _server.arg("vmon_actual_v").toFloat();
            const auto& vmon    = VoltageMonitor::getInstance().snapshot();
            const auto& cfg     = ConfigManager::getInstance().get();
            const float rawV    = (vmon.voltage > 0.1f)
                                  ? vmon.voltage / cfg.vMonCalFactor : 0.0f;
            if (rawV < 0.5f) {
                reason = "ina219_reading_too_low_check_wiring";
            } else {
                const float newFactor = actualV / rawV;
                char buf[64];
                snprintf(buf, sizeof(buf), "{\"vmon_cal_factor\":%.4f}", newFactor);
                ok = ConfigManager::getInstance().applyJson(buf, reason);
            }
        }
    }

    if (ok) {
        _server.sendHeader("Location", "/calibration");
        _server.send(302, "text/plain", "");
    } else {
        String html = htmlHeader("Calibration") + navBar("calibration");
        html += "<div class='card'><p class='err'>" + reason + "</p>"
                "<a href='/calibration'>Back</a></div>";
        html += htmlFooter();
        _server.send(400, "text/html", html);
    }
}

void LocalWebserver::handleFirmwareUpload() {
    if (!checkAuth()) { sendUnauth(); return; }
    String html = htmlHeader("Firmware Upload") + navBar("firmware-upload");
    html += "<div class='card'><h2>Current Firmware</h2><table>";
    html += "<tr><th>Name</th><td>" FIRMWARE_NAME "</td></tr>";
    html += "<tr><th>Version</th><td>" FIRMWARE_VERSION "</td></tr>";
    html += "<tr><th>Release Date</th><td>" FIRMWARE_DATE "</td></tr>";
    html += "</table></div>";
    html += "<div class='card'><h2>Local OTA Firmware Upload</h2>";
    if (!OtaManager::getInstance().isSafeToOta()) {
        html += "<p class='err'>OTA is blocked while alert/danger/pump is active.</p>";
    } else {
        html += "<p>Upload a valid .bin firmware file. Device will reboot after successful upload.</p>"
                "<form method='POST' action='/firmware-upload' enctype='multipart/form-data'>"
                "<input type='file' name='firmware' accept='.bin'>"
                "<button type='submit' class='btn btn-warn'>Upload &amp; Flash</button></form>";
    }
    html += "</div>";
    html += htmlFooter();
    _server.send(200, "text/html", html);
}

void LocalWebserver::handleFirmwareUploadPost() {
    _server.send(200, "text/html",
        htmlHeader("OTA") + "</nav><div class='card'>"
        "<p>Upload processed. Device is rebooting...</p></div>" + htmlFooter());
}

void LocalWebserver::handleReboot() {
    if (!checkAuth()) { sendUnauth(); return; }
    String html = htmlHeader("Reboot") + navBar("reboot");
    html += "<div class='card'><h2>Reboot Device</h2>"
            "<form method='POST' action='/reboot'>"
            "<button type='submit' class='btn btn-warn' onclick=\"return confirm('Reboot now?')\">Reboot Now</button>"
            "</form></div>";
    html += htmlFooter();
    _server.send(200, "text/html", html);
}

void LocalWebserver::handleRebootPost() {
    if (!checkAuth()) { sendUnauth(); return; }
    _server.send(200, "text/html",
        htmlHeader("Rebooting") + "</nav><div class='card'><p>Rebooting...</p></div>" + htmlFooter());
    delay(500);
    ESP.restart();
}

void LocalWebserver::handleFactoryReset() {
    if (!checkAuth()) { sendUnauth(); return; }
    String html = htmlHeader("Factory Reset") + navBar("factory-reset-confirm");
    html += "<div class='card'><h2 style='color:red'>Factory Reset</h2>"
            "<p>This will erase WiFi credentials. Device will reboot into BLE provisioning mode.</p>"
            "<form method='POST' action='/factory-reset-confirm'>"
            "<input type='password' name='pw' placeholder='Confirm password'>"
            "<button type='submit' class='btn btn-danger'>Confirm Factory Reset</button></form></div>";
    html += htmlFooter();
    _server.send(200, "text/html", html);
}

void LocalWebserver::handleFactoryResetPost() {
    if (!checkAuth()) { sendUnauth(); return; }
    if (_server.arg("pw") != kPassword) {
        _server.send(401, "text/plain", "Wrong password");
        return;
    }
    Preferences prefs;
    prefs.begin(NVS_NS_WIFI, false);
    prefs.clear();
    prefs.end();
    Serial.println("[WEB] Factory reset triggered via webserver");
    _server.send(200, "text/html",
        htmlHeader("Reset") + "</nav><div class='card'>"
        "<p>WiFi credentials erased. Rebooting into provisioning mode...</p></div>" + htmlFooter());
    delay(1000);
    ESP.restart();
}

void LocalWebserver::handleApiStatus() {
    StaticJsonDocument<256> doc;
    doc["device_id"]      = _deviceId;
    doc["firmware"]       = FIRMWARE_VERSION;
    doc["wifi_connected"] = WifiManager::getInstance().isConnected();
    doc["ip"]             = WifiManager::getInstance().localIp();
    doc["mqtt_connected"] = MqttManager::getInstance().isConnected();
    doc["uptime_s"]       = (uint32_t)(millis() / 1000UL);
    char buf[256];
    serializeJson(doc, buf, sizeof(buf));
    _server.sendHeader("Access-Control-Allow-Origin", "*");
    _server.send(200, "application/json", buf);
}

void LocalWebserver::handleWifi() {
    const bool hasCreds  = WifiManager::getInstance().hasCredentials();
    const String curSsid = hasCreds ? WifiManager::getInstance().configuredSsid() : "";

    String html = htmlHeader("WiFi Setup");
    html += "<a href='/wifi' style='color:#fff;text-decoration:underline'>WiFi Setup</a>"
            "&nbsp;&nbsp;<a href='/login' style='color:#fff'>Login</a></nav>";

    if (_apActive) {
        html += "<div style='background:#1565c0;color:#fff;padding:6px 16px;"
                "text-align:center;font-size:13px'>"
                "AP mode active &#8212; enter WiFi credentials below to connect to the cloud</div>";
    }

    html += "<div class='card' style='max-width:440px;margin:40px auto'><h2>WiFi Setup</h2>";
    if (hasCreds && WifiManager::getInstance().isConnected()) {
        html += "<p><span class='ok'>&#x2713; Connected:</span> <b>" + curSsid + "</b> &mdash; "
                + WifiManager::getInstance().localIp() + "</p>";
    } else if (hasCreds) {
        html += "<p><span class='err'>Saved SSID: <b>" + curSsid + "</b> (not connected)</span></p>";
    }
    html += "<form method='POST' action='/wifi'>"
            "<label>WiFi SSID</label>"
            "<input type='text' name='ssid' placeholder='Network name' value='" + curSsid + "' autofocus required>"
            "<label>Password</label>"
            "<div style='position:relative;display:flex;align-items:center'>"
            "<input type='password' id='wpass' name='pass' placeholder='WiFi password (blank for open networks)' style='flex:1;padding-right:40px'>"
            "<button type='button' onclick=\"var i=document.getElementById('wpass');i.type=i.type==='password'?'text':'password';this.textContent=i.type==='password'?'&#128065;':'&#128064';\" "
            "style='position:absolute;right:6px;border:none;background:none;cursor:pointer;font-size:18px;padding:0'>&#128065;</button>"
            "</div>"
            "<button type='submit'>Save &amp; Connect</button></form>"
            "<p style='margin-top:16px;font-size:12px;color:#888'>"
            "Device reboots after saving. Reconnect to your WiFi then access the device at its local IP.</p>"
            "</div>";
    html += htmlFooter();
    _server.send(200, "text/html", html);
}

void LocalWebserver::handleWifiPost() {
    String ssid = _server.arg("ssid");
    String pass = _server.arg("pass");
    ssid.trim();
    if (ssid.length() == 0) {
        String html = htmlHeader("WiFi Setup") + "</nav>";
        html += "<div class='card' style='max-width:440px;margin:40px auto'>"
                "<p class='err'>SSID cannot be empty.</p><a href='/wifi'>Back</a></div>";
        html += htmlFooter();
        _server.send(400, "text/html", html);
        return;
    }
    WifiManager::getInstance().setCredentials(ssid.c_str(), pass.c_str(), true);
    Serial.printf("[WEB] WiFi credentials saved via web UI: ssid=%s\n", ssid.c_str());

    // Connect to WiFi now (before reboot) so we can read the assigned IP
    WiFi.begin(ssid.c_str(), pass.c_str());
    const uint32_t t0 = millis();
    while (WiFi.status() != WL_CONNECTED && (millis() - t0) < 12000UL) delay(200);
    const bool gotIp   = (WiFi.status() == WL_CONNECTED);
    const String ipStr = gotIp ? WiFi.localIP().toString() : String("(connecting...)");

    String body = htmlHeader("WiFi Setup") + "</nav>"
        "<meta http-equiv='refresh' content='18;url=http://" + String(_mdnsHost) + ".local'>"
        "<div class='card' style='max-width:480px;margin:40px auto'>"
        "<p class='ok'>&#x2713; Credentials saved for <b>" + ssid + "</b></p>";
    if (gotIp) {
        body += "<p>Device IP: <b><a href='http://" + ipStr + "'>" + ipStr + "</a></b></p>";
    }
    body += "<p>After your phone reconnects to your WiFi, open:<br>"
            "<b>http://" + String(_mdnsHost) + ".local</b><br>"
            "<small>(page auto-redirects in 18 s)</small></p>"
            "</div>";
    body += htmlFooter();
    _server.send(200, "text/html", body);
    delay(2000);
    ESP.restart();
}

void LocalWebserver::handleNotFound() {
    _server.sendHeader("Location", checkAuth() ? "/status" : "/login");
    _server.send(302, "text/plain", "");
}
