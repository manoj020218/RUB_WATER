#pragma once

#include <Arduino.h>
#include <WebServer.h>

class LocalWebserver {
public:
    static LocalWebserver& getInstance();

    void begin(const char* apSsid, const char* deviceId);
    void loop();
    void startAp(uint32_t durationMs = 900000UL);  // default 15 min
    void stopAp();
    bool isApActive() const { return _apActive; }

private:
    LocalWebserver() = default;
    WebServer _server{80};
    char      _apSsid[32]{};
    char      _deviceId[32]{};
    bool      _apActive   = false;
    bool      _loggedIn   = false;
    uint32_t  _apStartMs  = 0;
    uint32_t  _apDurationMs = 0;
    uint32_t  _sessionExpMs = 0;

    static constexpr const char* kPassword = "Hanuman#2026";

    void setupRoutes();
    bool checkAuth();
    void sendUnauth();

    void handleRoot();
    void handleLogin();
    void handleLoginPost();
    void handleLogout();
    void handleStatus();
    void handleConfig();
    void handleConfigPost();
    void handleDiagnostics();
    void handleRelayTest();
    void handleRelayTestPost();
    void handleRemoteTest();
    void handleRemoteTestPost();
    void handleCalibration();
    void handleCalibrationPost();
    void handleFirmwareUpload();
    void handleFirmwareUploadPost();
    void handleReboot();
    void handleRebootPost();
    void handleFactoryReset();
    void handleFactoryResetPost();
    void handleNotFound();

    static String htmlHeader(const char* title);
    static String htmlFooter();
    static String navBar(const char* active);
};
