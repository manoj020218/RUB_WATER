#include "wifi_manager.h"

#include <Preferences.h>
#include <WiFi.h>
#include <cstring>

#include "device_profile.h"

namespace {
constexpr const char* kPrefsNamespace = "fgcfg";
constexpr const char* kPrefsWifiSsidKey = "wifi_ssid";
constexpr const char* kPrefsWifiPassKey = "wifi_pass";
}

WifiManager& WifiManager::getInstance() {
    static WifiManager instance;
    return instance;
}

void WifiManager::begin(const char* ssid, const char* password) {
    std::memset(_ssid, 0, sizeof(_ssid));
    std::memset(_password, 0, sizeof(_password));

    if (ssid) {
        std::strncpy(_ssid, ssid, sizeof(_ssid) - 1);
    }
    if (password) {
        std::strncpy(_password, password, sizeof(_password) - 1);
    }

    loadPersistedCredentials();

    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    WiFi.persistent(false);
    _lastConnectAttemptMs = 0;
}

void WifiManager::loop() {
    if (isConnected()) {
        return;
    }

    const unsigned long now = millis();
    if (now - _lastConnectAttemptMs < DeviceProfile::WIFI_RETRY_INTERVAL_MS) {
        return;
    }
    _lastConnectAttemptMs = now;

    if (_ssid[0] == '\0' || std::strcmp(_ssid, "CHANGE_WIFI_SSID") == 0) {
        return;
    }

    WiFi.begin(_ssid, _password);
}

void WifiManager::setCredentials(const char* ssid, const char* password, bool persistToNvs) {
    std::memset(_ssid, 0, sizeof(_ssid));
    std::memset(_password, 0, sizeof(_password));
    if (ssid) {
        std::strncpy(_ssid, ssid, sizeof(_ssid) - 1);
    }
    if (password) {
        std::strncpy(_password, password, sizeof(_password) - 1);
    }

    if (persistToNvs) {
        persistCredentials();
    }

    _lastConnectAttemptMs = 0;
    WiFi.disconnect(false, false);
}

bool WifiManager::connectNow(uint32_t timeoutMs) {
    if (_ssid[0] == '\0' || std::strcmp(_ssid, "CHANGE_WIFI_SSID") == 0) {
        return false;
    }

    WiFi.begin(_ssid, _password);
    const unsigned long start = millis();
    while (WiFi.status() != WL_CONNECTED && (millis() - start) < timeoutMs) {
        delay(150);
    }
    return WiFi.status() == WL_CONNECTED;
}

bool WifiManager::isConnected() const {
    return WiFi.status() == WL_CONNECTED;
}

int WifiManager::currentStatus() const {
    return WiFi.status();
}

const char* WifiManager::statusText(int status) const {
    switch (status) {
        case WL_IDLE_STATUS: return "IDLE";
        case WL_NO_SSID_AVAIL: return "NO_SSID";
        case WL_SCAN_COMPLETED: return "SCAN_COMPLETED";
        case WL_CONNECTED: return "CONNECTED";
        case WL_CONNECT_FAILED: return "CONNECT_FAILED";
        case WL_CONNECTION_LOST: return "CONNECTION_LOST";
        case WL_DISCONNECTED: return "DISCONNECTED";
#ifdef WL_NO_SHIELD
        case WL_NO_SHIELD: return "NO_SHIELD";
#endif
        default: return "UNKNOWN";
    }
}

int32_t WifiManager::getRssi() const {
    return isConnected() ? WiFi.RSSI() : -127;
}

String WifiManager::getLocalIp() const {
    return isConnected() ? WiFi.localIP().toString() : String("0.0.0.0");
}

String WifiManager::getConfiguredSsid() const {
    return String(_ssid);
}

void WifiManager::loadPersistedCredentials() {
    Preferences prefs;
    if (!prefs.begin(kPrefsNamespace, true)) {
        return;
    }

    const String savedSsid = prefs.getString(kPrefsWifiSsidKey, "");
    const String savedPass = prefs.getString(kPrefsWifiPassKey, "");
    prefs.end();

    if (savedSsid.length() == 0) {
        return;
    }

    std::memset(_ssid, 0, sizeof(_ssid));
    std::memset(_password, 0, sizeof(_password));
    std::strncpy(_ssid, savedSsid.c_str(), sizeof(_ssid) - 1);
    std::strncpy(_password, savedPass.c_str(), sizeof(_password) - 1);
}

void WifiManager::persistCredentials() {
    Preferences prefs;
    if (!prefs.begin(kPrefsNamespace, false)) {
        return;
    }

    prefs.putString(kPrefsWifiSsidKey, String(_ssid));
    prefs.putString(kPrefsWifiPassKey, String(_password));
    prefs.end();
}
