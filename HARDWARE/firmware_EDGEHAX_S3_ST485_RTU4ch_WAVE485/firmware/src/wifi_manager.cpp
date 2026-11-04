#include "wifi_manager.h"

#include <Preferences.h>
#include <WiFi.h>

#include "device_profile.h"

// Backup WiFi credentials live in a git-ignored local header so the password is
// never committed. Create src/wifi_backup_secrets.h (see
// wifi_backup_secrets.example.h) before building production firmware.
#if __has_include("wifi_backup_secrets.h")
#include "wifi_backup_secrets.h"
#endif
#ifndef BACKUP_WIFI_SSID
#define BACKUP_WIFI_SSID "FLOODGUARD"
#endif
#ifndef BACKUP_WIFI_PASS
#error "BACKUP_WIFI_PASS not set: create src/wifi_backup_secrets.h (copy wifi_backup_secrets.example.h)"
#endif

namespace {
constexpr uint32_t kRetryIntervalMs = 15000UL;
// Standard backup network (0.2.2): lets any spare router set to
// FLOODGUARD / <password> replace a damaged site router. Tried ONLY when the
// saved (primary) network has been unreachable for kPrimaryFailBeforeBackupMs;
// never while connected, never while a phone is on the setup AP, never saved to NVS.
constexpr uint32_t kPrimaryFailBeforeBackupMs = 3UL * 60UL * 1000UL;  // 3 min
constexpr uint32_t kBackupTryWindowMs         = 60UL * 1000UL;        // 60 s
}

WifiManager& WifiManager::getInstance() {
    static WifiManager inst;
    return inst;
}

void WifiManager::setHostname(const char* hostname) {
    if (!hostname || !hostname[0]) return;
    strncpy(_hostname, hostname, sizeof(_hostname) - 1);
    _hostname[sizeof(_hostname) - 1] = '\0';
}

void WifiManager::begin() {
    loadFromNvs();

#ifdef DEV_WIFI_SSID
    if (!_hasCredentials) {
        strncpy(_ssid, DEV_WIFI_SSID, sizeof(_ssid) - 1);
        strncpy(_pass, DEV_WIFI_PASS, sizeof(_pass) - 1);
        _hasCredentials = true;
        Serial.printf("[WIFI] Dev override: SSID=%s\n", _ssid);
    }
#endif

    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    if (_hostname[0] != '\0') {
        WiFi.setHostname(_hostname);
        Serial.printf("[WIFI] Hostname=%s.local\n", _hostname);
    }

    if (_hasCredentials) {
        Serial.printf("[WIFI] Connecting to '%s'...\n", _ssid);
        WiFi.begin(_ssid, _pass);
        _connectStartMs   = millis();
        _connectTimedOut  = false;
        _firstConnectDone = false;
    } else {
        Serial.println("[WIFI] No credentials — waiting for BLE/AP provisioning");
    }
}

void WifiManager::loop() {
    if (!_hasCredentials) return;

    const uint32_t now = millis();

    if (isConnected()) {
        if (!_firstConnectDone) {
            _firstConnectDone = true;
            _lastIpLogMs = now;
            Serial.printf("[WIFI] Connected! IP=%s  SSID=%s  RSSI=%ddBm%s\n",
                          WiFi.localIP().toString().c_str(), activeSsid(), WiFi.RSSI(),
                          _onBackup ? "  (backup network)" : "");
        } else if ((now - _lastIpLogMs) >= 120000UL) {
            _lastIpLogMs = now;
            Serial.printf("[WIFI] IP=%s  SSID=%s  RSSI=%ddBm%s\n",
                          WiFi.localIP().toString().c_str(), activeSsid(), WiFi.RSSI(),
                          _onBackup ? "  (backup network)" : "");
        }
        _connectTimedOut = false;
        _primaryDownSinceMs = 0;
        return;
    }

    // WiFi just dropped — reset so next reconnect prints the IP again
    if (_firstConnectDone) {
        _firstConnectDone = false;
        Serial.printf("[WIFI] Disconnected from '%s'\n", activeSsid());
        if (_onBackup) {
            // Backup router gone: go back to the saved network first.
            _onBackup = false;
            _lastAttemptMs = 0;
        }
    }

    if (_onBackup) {
        // Trying the backup network; give it a fixed window, then back to primary.
        if ((now - _backupStartMs) >= kBackupTryWindowMs) {
            Serial.printf("[WIFI] Backup '%s' not reachable — back to '%s'\n", BACKUP_WIFI_SSID, _ssid);
            _onBackup = false;
            _primaryDownSinceMs = now;  // full primary window again before next backup try
            _lastAttemptMs = 0;
        } else {
            if ((now - _lastAttemptMs) < kRetryIntervalMs * 2) return;
            _lastAttemptMs = now;
            WiFi.begin(BACKUP_WIFI_SSID, BACKUP_WIFI_PASS);
            return;
        }
    }

    if (_primaryDownSinceMs == 0) _primaryDownSinceMs = now;
    // A technician is connected to the setup AP: don't switch channels under them.
    const bool apActive = ((WiFi.getMode() & WIFI_MODE_AP) != 0) && WiFi.softAPgetStationNum() > 0;
    if (!apActive && strcmp(_ssid, BACKUP_WIFI_SSID) != 0 &&
            (now - _primaryDownSinceMs) >= kPrimaryFailBeforeBackupMs) {
        Serial.printf("[WIFI] '%s' unreachable for %lus — trying backup '%s'\n", _ssid,
                      (unsigned long)((now - _primaryDownSinceMs) / 1000UL), BACKUP_WIFI_SSID);
        _onBackup = true;
        _backupStartMs = now;
        _lastAttemptMs = now;
        WiFi.disconnect(false);
        WiFi.begin(BACKUP_WIFI_SSID, BACKUP_WIFI_PASS);
        return;
    }
    if (apActive) _primaryDownSinceMs = now;

    // Only flag timeout on the initial connect attempt (not transient disconnects)
    if (!_firstConnectDone && !_connectTimedOut && _connectStartMs > 0
            && (now - _connectStartMs) >= 60000UL) {
        _connectTimedOut = true;
        Serial.println("[WIFI] 60s connect timeout — wrong password or SSID not found");
    }

    if ((now - _lastAttemptMs) < kRetryIntervalMs) return;
    _lastAttemptMs = now;

    Serial.printf("[WIFI] Reconnecting to '%s'...\n", _ssid);
    WiFi.begin(_ssid, _pass);
}

bool WifiManager::isConnectTimedOut() const { return _connectTimedOut; }

void WifiManager::setCredentials(const char* ssid, const char* password, bool persist) {
    strncpy(_ssid, ssid,     sizeof(_ssid) - 1);
    strncpy(_pass, password, sizeof(_pass) - 1);
    _ssid[sizeof(_ssid)-1] = '\0';
    _pass[sizeof(_pass)-1] = '\0';
    _hasCredentials   = (strlen(_ssid) > 0);
    _onBackup         = false;
    _primaryDownSinceMs = 0;
    _connectStartMs   = millis();
    _connectTimedOut  = false;
    _firstConnectDone = false;
    if (persist) persistToNvs();
}

bool WifiManager::connectNow(uint32_t timeoutMs) {
    if (!_hasCredentials) return false;
    WiFi.disconnect(false);
    WiFi.begin(_ssid, _pass);
    const uint32_t deadline = millis() + timeoutMs;
    while (millis() < deadline && WiFi.status() != WL_CONNECTED) {
        delay(200);
        yield();
    }
    return WiFi.status() == WL_CONNECTED;
}

bool WifiManager::isConnected() const { return WiFi.status() == WL_CONNECTED; }
bool WifiManager::hasCredentials() const { return _hasCredentials; }
int32_t WifiManager::rssi() const { return WiFi.RSSI(); }
String WifiManager::localIp() const { return WiFi.localIP().toString(); }
String WifiManager::hostname() const { return String(_hostname); }
String WifiManager::configuredSsid() const { return String(_ssid); }
bool WifiManager::onBackupNetwork() const { return _onBackup && isConnected(); }
const char* WifiManager::activeSsid() const { return _onBackup ? BACKUP_WIFI_SSID : _ssid; }

void WifiManager::loadFromNvs() {
    Preferences prefs;
    if (!prefs.begin(NVS_NS_WIFI, true)) return;
    const String ssid = prefs.getString("wifi_ssid", "");
    const String pass = prefs.getString("wifi_pass", "");
    prefs.end();
    if (ssid.length() > 0 && ssid != "CHANGE_WIFI_SSID") {
        strncpy(_ssid, ssid.c_str(), sizeof(_ssid) - 1);
        strncpy(_pass, pass.c_str(), sizeof(_pass) - 1);
        _hasCredentials = true;
    }
}

void WifiManager::persistToNvs() {
    Preferences prefs;
    if (!prefs.begin(NVS_NS_WIFI, false)) return;
    prefs.putString("wifi_ssid", _ssid);
    prefs.putString("wifi_pass", _pass);
    prefs.end();
}
