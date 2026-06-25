#pragma once

#include <Arduino.h>
#include <WebServer.h>

class LocalWebserver {
public:
    static LocalWebserver& getInstance();

    void begin(const char* apSsid, const char* deviceId, const char* hardwareId);
    void loop();
    void startAp(uint32_t durationMs = 900000UL);  // default 15 min
    void stopAp();
    bool isApActive() const { return _apActive; }
    const char* mdnsHost() const { return _mdnsHost; }

private:
    LocalWebserver() = default;
    WebServer _server{80};
    char      _apSsid[32]{};
    char      _deviceId[32]{};
    char      _hardwareId[32]{};
    char      _mdnsHost[64]{};
    bool      _apActive   = false;
    bool      _loggedIn   = false;
    bool      _serverStarted = false;
    bool      _mdnsStarted = false;
    uint32_t  _apStartMs  = 0;
    uint32_t  _apDurationMs = 0;
    uint32_t  _sessionExpMs = 0;

    static constexpr const char* kPassword = "Hanuman#2026";

    void setupRoutes();
    void updateMdns();
    void startServerIfNeeded();
    bool checkAuth();
    bool checkLocalPinAuth();
    bool wantsJsonResponse();
    void sendCorsHeaders();
    void sendUnauth();

    void handleRoot();
    void handleLogin();
    void handleLoginPost();
    void handleLogout();
    void handleStatus();
    void handleConfig();
    void handleConfigPost();
    void handleActionSheet();
    void handleActionSheetPost();
    void handleDiagnostics();
    void handleDiagnosticsPost();
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
    void handleApiStatus();
    void handleWifi();
    void handleWifiPost();
    void handleIdentity();
    void handleIdentityPost();
    void handleFactoryReset();
    void handleFactoryResetPost();
    void handleNotFound();

    static String htmlHeader(const char* title);
    static String htmlFooter();
    static String navBar(const char* active);
    static void buildMdnsHost(char* out, size_t outSize, const char* deviceId);
};
