const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fg-telemetry-'));
process.env.TELEMETRY_DIR = tmpDir;

const http = require('http');
const { createApp } = require('../src/app');
const { dataStore } = require('../src/db/datastore');
const telemetryStore = require('../src/db/telemetryStore');
const telemetryRepository = require('../src/repositories/telemetryRepository');

const DAY = 24 * 60 * 60 * 1000;
let server;
let baseUrl;
let token;

async function api(p) {
  const r = await fetch(`${baseUrl}${p}`, { headers: { authorization: `Bearer ${token}` } });
  return r.json();
}

test.before(async () => {
  server = http.createServer(createApp({ resetStore: true, seed: true }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const r = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ login_id: 'vendor_admin', password: 'Pass@123', device_name: 'test' })
  });
  token = (await r.json()).data.token;
  telemetryStore.start(dataStore, { flushIntervalMs: 60000, maintenanceIntervalMs: 60000 });
});

test.after(async () => {
  telemetryStore.stop();
  if (server) await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function rec(id, ms, extra = {}) {
  return { _id: id, type: 'TELEMETRY', device_id: 'RUB043-CTRL01', location_id: 'RUB043', status: 'NORMAL', water_level_mm: 0, timestamp: new Date(ms).toISOString(), ...extra };
}

test('telemetry is written to daily files and survives losing memory', () => {
  const now = Date.now();
  telemetryRepository.insert(rec('t_old', now - 10 * DAY));
  telemetryRepository.insert(rec('t_new', now - 60 * 1000));
  telemetryStore.flushSync();

  const files = fs.readdirSync(tmpDir).filter((f) => f.endsWith('.ndjson'));
  assert.equal(files.length, 2);

  dataStore.telemetry = []; // simulate restart
  const back = telemetryStore.readRange(now - 30 * DAY, now).map((r) => r._id).sort();
  assert.deepEqual(back, ['t_new', 't_old']);
});

test('memory trim keeps only the recent window; files older than retention are pruned', () => {
  const now = Date.now();
  dataStore.telemetry = [rec('m_old', now - 5 * DAY), rec('m_new', now - 1000)];
  telemetryStore.trimMemory(dataStore, now);
  assert.deepEqual(dataStore.telemetry.map((r) => r._id), ['m_new']);

  const ancient = new Date(now - (telemetryStore.RETENTION_DAYS + 5) * DAY).toISOString().slice(0, 10);
  fs.writeFileSync(path.join(tmpDir, `${ancient}.ndjson`), '{}\n');
  assert.equal(telemetryStore.pruneOldFiles(now), 1);
  assert.equal(fs.existsSync(path.join(tmpDir, `${ancient}.ndjson`)), false);
});

test('report includes file telemetry, whole end day (IST), renamed IDs and limit', async () => {
  const now = Date.now();
  dataStore.telemetry = [];
  telemetryRepository.insert(rec('r_today', now - 60 * 1000, { location_id: 'OLD-RUB043' }));
  telemetryStore.flushSync();
  dataStore.telemetry = []; // only on disk now
  dataStore.locations.find((l) => l._id === 'RUB043').previous_location_ids = ['OLD-RUB043'];

  // IST calendar date of "now"
  const istToday = new Date(now + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const from = new Date(now - 3 * DAY + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const r = await api(`/api/reports/audit?from=${from}&to=${istToday}&location_id=RUB043`);
  assert.equal(r.ok, true, JSON.stringify(r));
  const row = r.data.rows.find((x) => JSON.parse(x.details_json)._id === 'r_today');
  assert.ok(row, 'telemetry from file on the end day should be in the report');
  assert.equal(row.location_id, 'RUB043');

  const limited = await api(`/api/reports/audit?from=${from}&to=${istToday}&limit=1`);
  assert.equal(limited.data.rows.length, 1);
});
