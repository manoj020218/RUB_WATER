// Device offline watchdog.
//
// Firmware does not set an MQTT Last-Will, so a device that loses power, hangs or
// drops its link simply goes silent and nothing ever marks it OFFLINE. This job
// scans devices periodically and records each ONLINE -> OFFLINE and
// OFFLINE -> ONLINE transition as an audit log (DEVICE_OFFLINE / DEVICE_ONLINE),
// a realtime event, and an FCM notification to users with access to the location.
//
// The exact time a device went silent is kept as `offline_since` (= its last
// message), so the audit trail answers "when did it go offline" precisely.

const deviceRepository = require('../repositories/deviceRepository');
const auditService = require('../services/auditService');
const { publishNotification } = require('../services/notificationService');
const { publishRealtime } = require('../services/realtimeBus');
const { lastActivityMs, OFFLINE_THRESHOLD_MS } = require('../utils/deviceStatus');

const MONITORED_OPERATIONAL_STATUSES = new Set(['ACTIVE', '']);

function isMonitored(device) {
  const op = String(device.operational_status || '').trim().toUpperCase();
  return MONITORED_OPERATIONAL_STATUSES.has(op);
}

function formatDuration(ms) {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  return [d ? `${d}d` : '', h ? `${h}h` : '', `${m}m`].filter(Boolean).join(' ');
}

function safeNotify(eventName, payload, locationId) {
  if (!locationId) return;
  try {
    publishNotification(eventName, payload, { locationId });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`[OfflineWatchdog] notification ${eventName} failed: ${error.message}`);
  }
}

function markOffline(device, lastMs, nowMs) {
  const offlineSince = new Date(lastMs).toISOString();
  const detectedAt = new Date(nowMs).toISOString();

  deviceRepository.updateRuntime(device._id, {
    status: 'OFFLINE',
    connectivity_state: 'OFFLINE',
    offline_since: offlineSince,
    offline_detected_at: detectedAt
  });

  const details = {
    device_id: device._id,
    hardware_id: device.hardware_id || null,
    offline_since: offlineSince,
    detected_at: detectedAt,
    silent_for: formatDuration(nowMs - lastMs),
    last_ssid: device.last_ssid || null,
    last_local_ip: device.last_local_ip || null,
    last_wifi_rssi: device.last_wifi_rssi ?? null,
    firmware_version: device.firmware_version || null
  };

  auditService.writeAuditLog({
    locationId: device.location_id || null,
    eventType: 'DEVICE_OFFLINE',
    performedBy: 'SYSTEM',
    loginId: 'system:offline-watchdog',
    details
  });
  publishRealtime('DEVICE_CONNECTIVITY_CHANGED', {
    location_id: device.location_id || null,
    device_id: device._id,
    status: 'OFFLINE',
    offline_since: offlineSince
  });
  safeNotify('DEVICE_OFFLINE', { location_id: device.location_id, ...details }, device.location_id);

  // eslint-disable-next-line no-console
  console.warn(`[OfflineWatchdog] ${device._id} OFFLINE since ${offlineSince} (silent ${details.silent_for})`);
}

function markOnline(device, lastMs) {
  const backAt = new Date(lastMs).toISOString();
  const offlineSince = device.offline_since || null;
  const downtimeMs = offlineSince ? lastMs - new Date(offlineSince).getTime() : null;

  deviceRepository.updateRuntime(device._id, {
    connectivity_state: 'ONLINE',
    offline_since: null,
    offline_detected_at: null,
    last_recovered_at: backAt,
    last_outage_started_at: offlineSince,
    last_outage_duration_sec: downtimeMs != null ? Math.round(downtimeMs / 1000) : null
  });

  const details = {
    device_id: device._id,
    hardware_id: device.hardware_id || null,
    offline_since: offlineSince,
    back_online_at: backAt,
    downtime: downtimeMs != null ? formatDuration(downtimeMs) : null
  };

  auditService.writeAuditLog({
    locationId: device.location_id || null,
    eventType: 'DEVICE_ONLINE',
    performedBy: 'SYSTEM',
    loginId: 'system:offline-watchdog',
    details
  });
  publishRealtime('DEVICE_CONNECTIVITY_CHANGED', {
    location_id: device.location_id || null,
    device_id: device._id,
    status: 'ONLINE',
    back_online_at: backAt
  });
  safeNotify('DEVICE_RECOVERED', { location_id: device.location_id, ...details }, device.location_id);

  // eslint-disable-next-line no-console
  console.log(`[OfflineWatchdog] ${device._id} back ONLINE at ${backAt} (down ${details.downtime})`);
}

/**
 * One scan. `startedAtMs` is the process start: right after a server restart we
 * cannot tell silence from "we were not listening", so a device only counts as
 * silent once it has also been quiet for the threshold since the server started.
 */
function runDeviceOfflineScan({ nowMs = Date.now(), startedAtMs = 0, thresholdMs = OFFLINE_THRESHOLD_MS } = {}) {
  const result = { checked: 0, went_offline: [], came_online: [] };

  deviceRepository.listAll().forEach((device) => {
    if (!device || !isMonitored(device)) return;
    const lastMs = lastActivityMs(device);
    if (!lastMs) return; // never reported — nothing to track yet
    result.checked += 1;

    const flaggedOffline = device.connectivity_state === 'OFFLINE';
    const silent = (nowMs - Math.max(lastMs, startedAtMs)) > thresholdMs;

    if (!flaggedOffline && silent) {
      markOffline(device, lastMs, nowMs);
      result.went_offline.push(device._id);
    } else if (flaggedOffline && !silent && device.offline_since
      && lastMs > new Date(device.offline_since).getTime()) {
      markOnline(device, lastMs);
      result.came_online.push(device._id);
    }
  });

  return result;
}

function startDeviceOfflineWatchdog({ intervalMs = 60 * 1000 } = {}) {
  const startedAtMs = Date.now();
  const tick = () => {
    try {
      runDeviceOfflineScan({ startedAtMs });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`[OfflineWatchdog] scan failed: ${error.message}`);
    }
  };
  const timer = setInterval(tick, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return () => clearInterval(timer);
}

module.exports = {
  runDeviceOfflineScan,
  startDeviceOfflineWatchdog
};
