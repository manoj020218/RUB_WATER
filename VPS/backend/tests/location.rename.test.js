const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createApp } = require('../src/app');
const { dataStore } = require('../src/db/datastore');

let server;
let baseUrl;
let token;

async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (auth) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json() };
}

async function login(loginId, password) {
  const r = await api('/api/auth/login', { method: 'POST', auth: false, body: { login_id: loginId, password, device_name: 'test' } });
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  return r.body.data.token;
}

test.before(async () => {
  server = http.createServer(createApp({ resetStore: true, seed: true }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  token = await login('vendor_admin', 'Pass@123');
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

test('rename endpoint moves location ID with users, device, config and history', async () => {
  dataStore.telemetry.push({ _id: 'tel_x', type: 'TELEMETRY', location_id: 'RUB043', timestamp: new Date().toISOString(), status: 'NORMAL' });

  const r = await api('/api/admin/locations/RUB043/rename', { method: 'POST', body: { new_location_id: 'rub043-new' } });
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  assert.equal(r.body.data.location_id, 'RUB043-NEW');

  assert.ok(dataStore.locations.find((l) => l._id === 'RUB043-NEW'));
  assert.equal(dataStore.locations.find((l) => l._id === 'RUB043'), undefined);
  assert.equal(dataStore.devices.find((d) => d._id === 'RUB043-CTRL01').location_id, 'RUB043-NEW');
  assert.equal(dataStore.telemetry.find((t) => t._id === 'tel_x').location_id, 'RUB043-NEW');
  const operator = dataStore.users.find((u) => u.login_id === 'operator_rub043');
  assert.deepEqual(operator.assigned_location_ids, ['RUB043-NEW']);
  assert.ok(dataStore.auditLogs.some((l) => l.event_type === 'LOCATION_ID_RENAMED'));

  // Operator can still see the site
  const opToken = await login('operator_rub043', 'Pass@123');
  const saved = token; token = opToken;
  const list = await api('/api/locations');
  token = saved;
  assert.deepEqual(list.body.data.map((l) => l.location_id), ['RUB043-NEW']);

  // Conflicts are refused
  const clash = await api('/api/admin/locations/RUB043-NEW/rename', { method: 'POST', body: { new_location_id: 'RUB057' } });
  assert.equal(clash.status, 400);
});

test('legacy create + bind + delete sequence keeps user access', async () => {
  const created = await api('/api/admin/locations', { method: 'POST', body: { location_id: 'RUB057-B', location_name: 'B' } });
  assert.equal(created.body.ok, true, JSON.stringify(created.body));
  const bound = await api('/api/admin/locations/RUB057-B/bind-device', { method: 'POST', body: { device_id: 'RUB057-CTRL01' } });
  assert.equal(bound.body.ok, true, JSON.stringify(bound.body));
  const del = await api('/api/admin/locations/RUB057', { method: 'DELETE' });
  assert.equal(del.body.ok, true, JSON.stringify(del.body));
  assert.equal(del.body.data.renamed_to, 'RUB057-B');

  const operator = dataStore.users.find((u) => u.login_id === 'operator_rub057');
  assert.deepEqual(operator.assigned_location_ids, ['RUB057-B']);
});

test('plain delete of a location without a moved device does not migrate anything', async () => {
  const del = await api('/api/admin/locations/RUB071', { method: 'DELETE' });
  assert.equal(del.body.ok, true);
  assert.equal(del.body.data.renamed_to, null);
  const operator = dataStore.users.find((u) => u.login_id === 'operator_rub071');
  assert.deepEqual(operator.assigned_location_ids, ['RUB071']);
});
