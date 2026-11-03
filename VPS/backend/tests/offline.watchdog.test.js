const test = require('node:test');
const assert = require('node:assert/strict');
const { dataStore, resetStore } = require('../src/db/datastore');
const { runDeviceOfflineScan } = require('../src/jobs/deviceOfflineWatchdogJob');
const { computeDeviceStatus } = require('../src/utils/deviceStatus');

const MIN = 60 * 1000;

function addDevice(overrides = {}) {
  const device = {
    _id: 'WD-TEST-01',
    location_id: 'LOC-WD',
    operational_status: 'ACTIVE',
    status: 'ONLINE',
    last_wifi_connected: true,
    last_mqtt_connected: true,
    last_ssid: 'SITE_WIFI',
    last_local_ip: '192.168.1.10',
    last_wifi_rssi: -40,
    ...overrides
  };
  dataStore.devices.push(device);
  return device;
}

function auditTypes() {
  return dataStore.auditLogs.filter((l) => l.details?.device_id === 'WD-TEST-01').map((l) => l.event_type);
}

test('stale device with last-known WiFi flags is OFFLINE, not IDLE', () => {
  resetStore();
  const device = addDevice({ last_seen: new Date(Date.now() - 4 * 24 * 60 * MIN).toISOString() });
  assert.equal(computeDeviceStatus(device), 'OFFLINE');
  device.last_seen = new Date(Date.now() - 4 * MIN).toISOString();
  assert.equal(computeDeviceStatus(device), 'IDLE'); // brief gap is still tolerated
  device.last_seen = new Date().toISOString();
  assert.equal(computeDeviceStatus(device), 'ONLINE');
});

test('watchdog records offline with exact last-seen time, then recovery with downtime', () => {
  resetStore();
  const lastSeen = Date.parse('2026-10-30T18:30:51.671Z');
  const device = addDevice({ last_seen: new Date(lastSeen).toISOString() });

  // Within threshold: nothing happens
  let r = runDeviceOfflineScan({ nowMs: lastSeen + 2 * MIN });
  assert.deepEqual(r.went_offline, []);

  r = runDeviceOfflineScan({ nowMs: lastSeen + 10 * MIN });
  assert.deepEqual(r.went_offline, ['WD-TEST-01']);
  assert.equal(device.connectivity_state, 'OFFLINE');
  assert.equal(device.offline_since, '2026-10-30T18:30:51.671Z');
  const offLog = dataStore.auditLogs.find((l) => l.event_type === 'DEVICE_OFFLINE');
  assert.equal(offLog.location_id, 'LOC-WD');
  assert.equal(offLog.details.offline_since, '2026-10-30T18:30:51.671Z');

  // Repeated scans do not duplicate the event
  runDeviceOfflineScan({ nowMs: lastSeen + 60 * MIN });
  assert.deepEqual(auditTypes(), ['DEVICE_OFFLINE']);

  // Device comes back (heartbeat updates last_seen)
  const backAt = lastSeen + 3 * 60 * MIN;
  device.last_seen = new Date(backAt).toISOString();
  r = runDeviceOfflineScan({ nowMs: backAt + 30 * 1000 });
  assert.deepEqual(r.came_online, ['WD-TEST-01']);
  assert.equal(device.connectivity_state, 'ONLINE');
  assert.equal(device.offline_since, null);
  assert.equal(device.last_outage_duration_sec, 3 * 60 * 60);
  assert.deepEqual(auditTypes(), ['DEVICE_OFFLINE', 'DEVICE_ONLINE']);
  assert.equal(dataStore.auditLogs.at(-1).details.downtime, '3h 0m');
});

test('server-restart grace period and decommissioned devices are respected', () => {
  resetStore();
  const now = Date.now();
  addDevice({ last_seen: new Date(now - 60 * MIN).toISOString() });
  addDevice({ _id: 'WD-DECOM', operational_status: 'DECOMMISSIONED', last_seen: new Date(now - 60 * MIN).toISOString() });

  // Server just started 1 min ago: don't flag yet
  let r = runDeviceOfflineScan({ nowMs: now, startedAtMs: now - MIN });
  assert.deepEqual(r.went_offline, []);

  // After grace, the real device is flagged; decommissioned one never is
  r = runDeviceOfflineScan({ nowMs: now + 10 * MIN, startedAtMs: now - MIN });
  assert.deepEqual(r.went_offline, ['WD-TEST-01']);
});
