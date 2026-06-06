#include "wifi_manager.h"

#include <Preferences.h>
#include <WiFi.h>

#include "device_profile.h"

namespace {
constexpr uint32_t kRetryIntervalMs = 15000UL;
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
    } else {
        Serial.println("[WIFI] No credentials — waiting for BLE/AP provisioning");
    }
}

void WifiManager::loop() {
    if (!_hasCredentials) return;
    if (isConnected()) return;

    const uint32_t now = millis();
    if ((now - _lastAttemptMs) < kRetryIntervalMs) return;
    _lastAttemptMs = now;

    Serial.printf("[WIFI] Reconnecting to '%s'...\n", _ssid);
    WiFi.begin(_ssid, _pass);
}

void WifiManager::setCredentials(const char* ssid, const char* password, bool persist) {
    strncpy(_ssid, ssid,     sizeof(_ssid) - 1);
    strncpy(_pass, password, sizeof(_pass) - 1);
    _ssid[sizeof(_ssid)-1] = '\0';
    _pass[sizeof(_pass)-1] = '\0';
    _hasCredentials = (strlen(_ssid) > 0);
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
    if (WiFi.status() == WL_CONNECTED) {
        _lastInternetChkMs = 0;  // force internet check on next pollInternet()
    }
    return WiFi.status() == WL_CONNECTED;
}

bool WifiManager::hasInternet() const { return _internetAvailable; }

void WifiManager::pollInternet() {
    if (!isConnected()) {
        _internetAvailable = false;
        return;
    }
    const uint32_t now = millis();
    if (_lastInternetChkMs > 0 && (now - _lastInternetChkMs) < 60000UL) return;
    _lastInternetChkMs = now;

    WiFiClient client;
    const bool ok = client.connect(IPAddress(8, 8, 8, 8), 53, 3000);
    if (ok) client.stop();

    if (ok != _internetAvailable) {
        _internetAvailable = ok;
        Serial.printf("[WIFI] Internet: %s\n", ok ? "AVAILABLE" : "NOT AVAILABLE");
    }
}

bool WifiManager::isConnected() const { return WiFi.status() == WL_CONNECTED; }
bool WifiManager::hasCredentials() const { return _hasCredentials; }
int32_t WifiManager::rssi() const { return WiFi.RSSI(); }
String WifiManager::localIp() const { return WiFi.localIP().toString(); }
String WifiManager::hostname() const { return String(_hostname); }
String WifiManager::configuredSsid() const { return String(_ssid); }

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
