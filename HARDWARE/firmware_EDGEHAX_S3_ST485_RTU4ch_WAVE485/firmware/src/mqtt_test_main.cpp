// mqtt_test_main.cpp — minimal MQTT pub/sub test
// Compiled only when MQTT_TEST_MODE is defined.
// Tests: connect → subscribe → receive command → publish event (deferred) → reboot.
// OTA back: POST binary to http://192.168.1.201/firmware-upload (Content-Type: application/octet-stream)
#ifdef MQTT_TEST_MODE

#include <Arduino.h>
#include <Update.h>
#include <WebServer.h>
#include <WiFi.h>
#include <PubSubClient.h>

#define WIFI_SSID  "jenix123"
#define WIFI_PASS  "Kherli@321"
#define MQTT_HOST  "api.floodguard.iotsoft.in"
#define MQTT_PORT  1883
#define DEVICE_ID  "RUB42-CTRL01"
#define DEVICE_PW  "change_me_before_flash"
#define CMD_TOPIC  "floodguard/RUB42-CTRL01/command"
#define EVT_TOPIC  "floodguard/RUB42-CTRL01/event"

// Request the same 64KB loop-task stack as the full firmware
// (default 8KB is too small for WiFi + PubSubClient + WebServer)
size_t getArduinoLoopTaskStackSize() { return 65536; }

static WiFiClient   gWifi;
static PubSubClient gMqtt(gWifi);
static WebServer    gWeb(80);

static bool gPendingReboot = false;
static bool gPendingEvent  = false;
static char gEvtBuf[128]   = {};

static void onCmd(char* topic, byte* payload, unsigned int len) {
    char buf[256] = {};
    size_t n = len < sizeof(buf)-1 ? len : sizeof(buf)-1;
    memcpy(buf, payload, n);
    Serial.printf("[CB] topic=%s  payload=%s  len=%u\n", topic, buf, len);

    snprintf(gEvtBuf, sizeof(gEvtBuf), "{\"type\":\"ack\",\"uptime\":%lu,\"cmd\":\"%s\"}", millis()/1000, buf);
    gPendingEvent = true;

    if (strstr(buf, "reboot")) {
        Serial.println("[CB] Reboot queued");
        gPendingReboot = true;
    }
}

static void mqttConnect() {
    Serial.printf("[MQTT] Connecting id=%s user=%s...\n", DEVICE_ID, DEVICE_ID);
    if (gMqtt.connect(DEVICE_ID, DEVICE_ID, DEVICE_PW)) {
        Serial.printf("[MQTT] Connected. state=%d\n", gMqtt.state());
        bool ok = gMqtt.subscribe(CMD_TOPIC, 1);
        Serial.printf("[MQTT] Subscribe %s QoS1: %s\n", CMD_TOPIC, ok ? "OK" : "FAIL");
    } else {
        Serial.printf("[MQTT] FAILED state=%d\n", gMqtt.state());
    }
}

void setupOta() {
    gWeb.on("/firmware-upload", HTTP_POST,
        []() { gWeb.send(200, "text/plain", "OTA done, rebooting"); delay(500); ESP.restart(); },
        []() {
            HTTPUpload& u = gWeb.upload();
            if (u.status == UPLOAD_FILE_START) {
                Update.begin(UPDATE_SIZE_UNKNOWN);
            } else if (u.status == UPLOAD_FILE_WRITE) {
                Update.write(u.buf, u.currentSize);
            } else if (u.status == UPLOAD_FILE_END) {
                Update.end(true);
            }
        });
    gWeb.on("/", HTTP_GET, []() {
        gWeb.send(200, "text/plain", "MQTT-TEST-FW uptime=" + String(millis()/1000) + "s");
    });
    gWeb.begin();
    Serial.println("[WEB] OTA server at /firmware-upload");
}

void setup() {
    Serial.begin(115200);
    delay(500);
    Serial.println("\n=== MQTT TEST FIRMWARE (minimal) ===");

    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    Serial.print("[WIFI] Connecting");
    uint32_t t0 = millis();
    while (WiFi.status() != WL_CONNECTED && millis()-t0 < 20000) {
        delay(300); Serial.print(".");
    }
    Serial.printf("\n[WIFI] status=%d IP=%s\n", (int)WiFi.status(), WiFi.localIP().toString().c_str());

    gMqtt.setServer(MQTT_HOST, MQTT_PORT);
    gMqtt.setCallback(onCmd);
    gMqtt.setBufferSize(512);
    gMqtt.setKeepAlive(30);
    mqttConnect();

    setupOta();
}

void loop() {
    if (!gMqtt.connected()) {
        Serial.printf("[MAIN] Not connected (state=%d), reconnecting\n", gMqtt.state());
        mqttConnect();
        delay(3000);
        return;
    }

    gMqtt.loop();
    gWeb.handleClient();

    // Deferred publish — runs OUTSIDE the PubSubClient callback
    if (gPendingEvent) {
        gPendingEvent = false;
        Serial.printf("[MAIN] isConnected=%d\n", gMqtt.connected());
        bool ok = gMqtt.publish(EVT_TOPIC, gEvtBuf);
        Serial.printf("[MAIN] Event publish -> %s  payload=%s\n", ok ? "OK" : "FAIL", gEvtBuf);
    }

    if (gPendingReboot) {
        gPendingReboot = false;
        Serial.println("[MAIN] Executing reboot now");
        delay(500);
        ESP.restart();
    }

    // Heartbeat to event topic every 15 seconds (proves publish path works)
    static uint32_t sHbMs = 0;
    if (millis() - sHbMs >= 15000) {
        sHbMs = millis();
        char hb[96];
        snprintf(hb, sizeof(hb), "{\"type\":\"hb\",\"uptime\":%lu,\"state\":%d}", millis()/1000, gMqtt.state());
        bool ok = gMqtt.publish(EVT_TOPIC, hb);
        Serial.printf("[HB] %s -> %s\n", hb, ok ? "OK" : "FAIL");
    }
}

#endif // MQTT_TEST_MODE
