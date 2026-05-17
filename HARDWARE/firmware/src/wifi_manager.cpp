#include "wifi_manager.h"

#include <WiFi.h>
#include <cstring>

#include "device_profile.h"

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

bool WifiManager::isConnected() const {
    return WiFi.status() == WL_CONNECTED;
}

int32_t WifiManager::getRssi() const {
    return isConnected() ? WiFi.RSSI() : -127;
}

String WifiManager::getLocalIp() const {
    return isConnected() ? WiFi.localIP().toString() : String("0.0.0.0");
}
