const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createApp } = require('../src/app');
const { handleIncomingMqttMessage } = require('../src/mqtt/messageRouter');

let server;
let baseUrl;

async function requestJson(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = await response.json();
  return { response, body };
}

test.before(async () => {
  const app = createApp({ resetStore: true, seed: true });
  server = http.createServer(app);
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  if (!server) {
    return;
  }
  await new Promise((resolve) => server.close(resolve));
});

test('MQTT dummy ingestion works with firmware-style payloads', async () => {
  const login = await requestJson('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      login_id: 'operator_rub043',
      password: 'Pass@123',
      device_name: 'MQTT Regression Runner',
      app_type: 'PWA'
    })
  });

  assert.equal(login.response.status, 200);
  const token = login.body.data.token;

  const issueCommand = await requestJson('/api/commands/mute', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      location_id: 'RUB043',
      device_id: 'RUB043-CTRL01'
    })
  });
  assert.equal(issueCommand.response.status, 201);

  const commandId = issueCommand.body.data.command_id;
  assert.ok(commandId);

  const telemetryMessage = {
    device_id: 'RUB043-CTRL01',
    location_id: 'RUB043',
    product_pid: 'FLOODGUARD-S3-01',
    hardware_code: 'BA-S3-DA4',
    timestamp_ms: 123450,
    water_level_mm: 326,
    distance_mm: 874,
    status: 'ALERT',
    primary_sensor_status: 'OK',
    switch_300mm: true,
    switch_500mm: false,
    wifi_connected: true,
    internet_available: true,
    sim_registered: true,
    wifi_rssi: -65,
    router_online: true,
    sim_inserted: true,
    connected_4g: true,
    dry_run_active: false,
    battery_voltage: 12.4,
    solar_voltage: 18.1,
    firmware_version: '0.2.0-dev',
    relay_status: {
      siren: false,
      beacon: true,
      voice: false,
      barrier: false
    }
  };

  const telemetryOutcome = handleIncomingMqttMessage(
    'rub/RUB043-CTRL01/telemetry',
    JSON.stringify(telemetryMessage),
    { topicBase: 'rub' }
  );
  assert.equal(telemetryOutcome.handled, true);
  assert.equal(telemetryOutcome.channel, 'telemetry');
  assert.equal(telemetryOutcome.result.water_level_mm, 326);

  const httpFallbackNoApiKey = await requestJson('/api/device/telemetry', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      device_id: 'RUB043-CTRL01',
      location_id: 'RUB043',
      status: 'NORMAL',
      water_level_mm: 0,
      distance_mm: 1200,
      switch_300mm: false,
      switch_500mm: false,
      firmware_version: '0.2.0-dev'
    })
  });
  assert.equal(httpFallbackNoApiKey.response.status, 201);

  const heartbeatOutcome = handleIncomingMqttMessage(
    'rub/RUB043-CTRL01/heartbeat',
    JSON.stringify({
      type: 'heartbeat',
      product_pid: 'FLOODGUARD-S3-01',
      hardware_code: 'BA-S3-DA4',
      timestamp_ms: 123499,
      wifi_connected: true,
      internet_available: true,
      sim_registered: true,
      online: true
    }),
    { topicBase: 'rub' }
  );
  assert.equal(heartbeatOutcome.handled, true);
  assert.equal(heartbeatOutcome.channel, 'heartbeat');
  assert.equal(heartbeatOutcome.result.type, 'HEARTBEAT');

  const eventOutcome = handleIncomingMqttMessage(
    'rub/RUB043-CTRL01/event',
    JSON.stringify({
      event_type: 'DANGER_CONFIRMED',
      water_level_mm: 521,
      reason: 'Water level >= 500mm for 60 seconds',
      source: 'device'
    }),
    { topicBase: 'rub' }
  );

  assert.equal(eventOutcome.handled, true);
  assert.equal(eventOutcome.channel, 'event');
  assert.equal(eventOutcome.result.event.event_type, 'DANGER_CONFIRMED');

  const ackOutcome = handleIncomingMqttMessage(
    'rub/RUB043-CTRL01/command_ack',
    JSON.stringify({
      command_id: commandId,
      command: 'MUTE_ALARM',
      device_id: 'RUB043-CTRL01',
      location_id: 'RUB043',
      status: 'SUCCESS',
      executed_at_ms: 123550
    }),
    { topicBase: 'rub' }
  );

  assert.equal(ackOutcome.handled, true);
  assert.equal(ackOutcome.channel, 'command_ack');
  assert.equal(ackOutcome.result.status, 'SUCCESS');

  const pendingAfterAck = await requestJson('/api/device/RUB043-CTRL01/commands/pending', {
    method: 'GET',
    headers: {
      'x-api-key': 'FG_LOCAL_DEV_KEY'
    }
  });
  assert.equal(pendingAfterAck.response.status, 200);
  assert.equal(pendingAfterAck.body.data.some((item) => item.command_id === commandId), false);

  const issueCommandLegacy = await requestJson('/api/commands/dry-run', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      location_id: 'RUB043',
      device_id: 'RUB043-CTRL01',
      outputs: ['siren']
    })
  });
  assert.equal(issueCommandLegacy.response.status, 201);

  const legacyCommandId = issueCommandLegacy.body.data.command_id;
  const legacyAck = await requestJson('/api/device/command_ack', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      command_id: legacyCommandId,
      device_id: 'RUB043-CTRL01',
      status: 'SUCCESS'
    })
  });
  assert.equal(legacyAck.response.status, 200);

  const dashboard = await requestJson('/api/locations/RUB043/dashboard', {
    method: 'GET',
    headers: {
      authorization: `Bearer ${token}`
    }
  });
  assert.equal(dashboard.response.status, 200);
  assert.equal(typeof dashboard.body.data.latest.water_level_mm, 'number');
  assert.ok(dashboard.body.data.sample_count >= 2);

  const incidents = await requestJson('/api/incidents?location_id=RUB043', {
    method: 'GET',
    headers: {
      authorization: `Bearer ${token}`
    }
  });
  assert.equal(incidents.response.status, 200);
  assert.equal(incidents.body.data[0].status, 'ACTIVE');
});
