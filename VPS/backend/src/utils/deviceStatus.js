const STALE_THRESHOLD_MS = 3 * 60 * 1000;

function lastActivityMs(device) {
  if (!device) {
    return 0;
  }
  const lastHeartbeat = device.last_heartbeat ? new Date(device.last_heartbeat).getTime() : 0;
  const lastSeen = device.last_seen ? new Date(device.last_seen).getTime() : 0;
  return Math.max(lastHeartbeat || 0, lastSeen || 0);
}

function computeDeviceStatus(device) {
  if (!device) {
    return 'UNMAPPED';
  }

  const freshest = lastActivityMs(device);
  if (!freshest) {
    return 'OFFLINE';
  }

  const fresh = (Date.now() - freshest) <= STALE_THRESHOLD_MS;
  const hasWifiTransport = device.last_wifi_connected === true && device.last_mqtt_connected === true;
  const hasWifiIdentity = Boolean(String(device.last_ssid || '').trim())
    && Boolean(String(device.last_local_ip || '').trim());
  const hasWifiSignal = typeof device.last_wifi_rssi === 'number' && Number.isFinite(device.last_wifi_rssi);

  if (fresh && hasWifiTransport && hasWifiIdentity && hasWifiSignal) {
    return 'ONLINE';
  }

  if (fresh) {
    return 'IDLE';
  }

  if (
    device.last_mqtt_connected === true
    || device.last_wifi_connected === true
    || Boolean(String(device.last_ssid || '').trim())
    || Boolean(String(device.last_local_ip || '').trim())
    || device.last_internet_available === true
  ) {
    return 'IDLE';
  }

  return 'OFFLINE';
}

module.exports = {
  STALE_THRESHOLD_MS,
  lastActivityMs,
  computeDeviceStatus
};
