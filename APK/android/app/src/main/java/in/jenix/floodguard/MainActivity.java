package in.jenix.floodguard;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;

import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final String BRIDGE_NAME = "FGAndroid";

    private final class FloodGuardBridge {
        @JavascriptInterface
        public String getCurrentWifiSsid() {
            if (!hasLocationPermission() || !hasWifiStatePermission()) {
                return "";
            }
            try {
                WifiManager wifiManager = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                if (wifiManager == null) {
                    return "";
                }
                WifiInfo info = wifiManager.getConnectionInfo();
                if (info == null) {
                    return "";
                }
                String ssid = info.getSSID();
                if (ssid == null) {
                    return "";
                }
                ssid = ssid.trim();
                if (ssid.startsWith("\"") && ssid.endsWith("\"") && ssid.length() >= 2) {
                    ssid = ssid.substring(1, ssid.length() - 1);
                }
                if ("<unknown ssid>".equalsIgnoreCase(ssid) || "0x".equalsIgnoreCase(ssid)) {
                    return "";
                }
                return ssid;
            } catch (Exception ignored) {
                return "";
            }
        }
    }

    private boolean hasLocationPermission() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasWifiStatePermission() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_WIFI_STATE) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebSettings settings = getBridge().getWebView().getSettings();
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
            getBridge().getWebView().addJavascriptInterface(new FloodGuardBridge(), BRIDGE_NAME);
        }
    }
}
