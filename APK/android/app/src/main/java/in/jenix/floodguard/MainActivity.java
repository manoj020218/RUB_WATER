package in.jenix.floodguard;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.net.DhcpInfo;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;

import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

import org.json.JSONObject;

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
                return sanitizeSsid(info.getSSID());
            } catch (Exception ignored) {
                return "";
            }
        }

        @JavascriptInterface
        public String getCurrentWifiInfo() {
            if (!hasWifiStatePermission()) {
                return "{}";
            }
            try {
                WifiManager wifiManager = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                if (wifiManager == null) {
                    return "{}";
                }
                WifiInfo info = wifiManager.getConnectionInfo();
                DhcpInfo dhcpInfo = wifiManager.getDhcpInfo();
                JSONObject payload = new JSONObject();

                if (info != null) {
                    String ssid = sanitizeSsid(info.getSSID());
                    if (!ssid.isEmpty()) {
                        payload.put("ssid", ssid);
                    }
                    String ip = intToIpv4(info.getIpAddress());
                    if (!ip.isEmpty()) {
                        payload.put("ip", ip);
                    }
                }

                if (dhcpInfo != null) {
                    String ip = intToIpv4(dhcpInfo.ipAddress);
                    String gateway = intToIpv4(dhcpInfo.gateway);
                    String netmask = intToIpv4(dhcpInfo.netmask);
                    if (!ip.isEmpty()) {
                        payload.put("ip", ip);
                    }
                    if (!gateway.isEmpty()) {
                        payload.put("gateway", gateway);
                    }
                    if (!netmask.isEmpty()) {
                        payload.put("netmask", netmask);
                        payload.put("prefixLength", Integer.bitCount(dhcpInfo.netmask));
                    }
                }

                return payload.toString();
            } catch (Exception ignored) {
                return "{}";
            }
        }
    }

    private String sanitizeSsid(String ssid) {
        if (ssid == null) {
            return "";
        }
        String normalized = ssid.trim();
        if (normalized.startsWith("\"") && normalized.endsWith("\"") && normalized.length() >= 2) {
            normalized = normalized.substring(1, normalized.length() - 1);
        }
        if ("<unknown ssid>".equalsIgnoreCase(normalized) || "0x".equalsIgnoreCase(normalized)) {
            return "";
        }
        return normalized;
    }

    private String intToIpv4(int value) {
        if (value == 0) {
            return "";
        }
        return (value & 0xFF) + "."
                + ((value >> 8) & 0xFF) + "."
                + ((value >> 16) & 0xFF) + "."
                + ((value >> 24) & 0xFF);
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
