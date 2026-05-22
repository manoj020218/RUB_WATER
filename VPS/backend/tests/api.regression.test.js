const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createApp } = require('../src/app');

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

test('FloodGuard VPS API regression suite', async () => {
  const health = await requestJson('/health');
  assert.equal(health.response.status, 200);
  assert.equal(health.body.ok, true);

  const operatorLogin = await requestJson('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      login_id: 'operator_rub043',
      password: 'Pass@123',
      device_name: 'Regression Test Device',
      app_type: 'PWA'
    })
  });
  assert.equal(operatorLogin.response.status, 200);
  const operatorToken = operatorLogin.body.data.token;
  assert.ok(operatorToken);

  const viewerLogin = await requestJson('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      login_id: 'viewer_rub043',
      password: 'Pass@123',
      device_name: 'Viewer Device',
      app_type: 'PWA'
    })
  });
  assert.equal(viewerLogin.response.status, 200);
  const viewerToken = viewerLogin.body.data.token;

  const viewerMute = await requestJson('/api/commands/mute', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${viewerToken}`
    },
    body: JSON.stringify({
      location_id: 'RUB043',
      device_id: 'RUB043-CTRL01'
    })
  });
  assert.equal(viewerMute.response.status, 403);

  const viewerConfigUpdate = await requestJson('/api/devices/RUB043-CTRL01/config', {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${viewerToken}`
    },
    body: JSON.stringify({
      alert_level_mm: 210,
      danger_level_mm: 520,
      clear_level_mm: 460,
      trigger_delay_seconds: 60,
      clear_delay_seconds: 300,
      rs485_sensor_enabled: true,
      switch_sensor_enabled: true,
      sensor_mount_height_mm: 1300
    })
  });
  assert.equal(viewerConfigUpdate.response.status, 403);

  const operatorMute = await requestJson('/api/commands/mute', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${operatorToken}`
    },
    body: JSON.stringify({
      location_id: 'RUB043',
      device_id: 'RUB043-CTRL01'
    })
  });
  assert.equal(operatorMute.response.status, 201);
  const commandId = operatorMute.body.data.command_id;
  assert.ok(commandId);

  const pending = await requestJson('/api/device/RUB043-CTRL01/commands/pending', {
    method: 'GET',
    headers: {
      'x-api-key': 'FG_LOCAL_DEV_KEY'
    }
  });
  assert.equal(pending.response.status, 200);
  assert.ok(Array.isArray(pending.body.data));
  assert.equal(pending.body.data[0].command_id, commandId);

  const ack = await requestJson(`/api/device/commands/${commandId}/ack`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': 'FG_LOCAL_DEV_KEY'
    },
    body: JSON.stringify({
      command_id: commandId,
      device_id: 'RUB043-CTRL01',
      status: 'SUCCESS'
    })
  });
  assert.equal(ack.response.status, 200);
  assert.equal(ack.body.data.status, 'SUCCESS');

  const forceClearBad = await requestJson('/api/commands/force-clear', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${operatorToken}`
    },
    body: JSON.stringify({
      location_id: 'RUB043',
      device_id: 'RUB043-CTRL01'
    })
  });
  assert.equal(forceClearBad.response.status, 400);

  for (let i = 0; i < 3; i += 1) {
    const telemetry = await requestJson('/api/device/telemetry', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': 'FG_LOCAL_DEV_KEY'
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
    assert.equal(telemetry.response.status, 201);
  }

  const vendorLogin = await requestJson('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      login_id: 'vendor_admin',
      password: 'Pass@123',
      device_name: 'Vendor Device',
      app_type: 'PWA'
    })
  });
  assert.equal(vendorLogin.response.status, 200);
  const vendorToken = vendorLogin.body.data.token;
  const provisionProfile = await requestJson('/api/devices/RUB043-CTRL01/provision-profile', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${vendorToken}`
    }
  });
  assert.equal(provisionProfile.response.status, 200);
  assert.ok(provisionProfile.body.data.device_key);

  const telemetryByDeviceKey = await requestJson('/api/device/telemetry', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-device-key': provisionProfile.body.data.device_key
    },
    body: JSON.stringify({
      device_id: 'RUB043-CTRL01',
      location_id: 'RUB043',
      status: 'NORMAL',
      water_level_mm: 10,
      distance_mm: 1190,
      switch_300mm: false,
      switch_500mm: false,
      firmware_version: '0.2.0-dev'
    })
  });
  assert.equal(telemetryByDeviceKey.response.status, 201);

  const putConfig = await requestJson('/api/devices/RUB043-CTRL01/config', {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${vendorToken}`
    },
    body: JSON.stringify({
      alert_level_mm: 220,
      danger_level_mm: 540,
      clear_level_mm: 470,
      trigger_delay_seconds: 80,
      clear_delay_seconds: 360,
      rs485_sensor_enabled: true,
      switch_sensor_enabled: true,
      switch_level_1_mm: 300,
      switch_level_2_mm: 500,
      sensor_mount_height_mm: 1300
    })
  });
  assert.equal(putConfig.response.status, 202);
  const configCommandId = putConfig.body.data.command_id;
  assert.ok(configCommandId);

  const configAck = await requestJson('/api/device/config_ack', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': 'FG_LOCAL_DEV_KEY'
    },
    body: JSON.stringify({
      command_id: configCommandId,
      device_id: 'RUB043-CTRL01',
      status: 'SUCCESS',
      applied_config_version: 2,
      saved_to_nvs: true
    })
  });
  assert.equal(configAck.response.status, 200);
  assert.equal(configAck.body.data.status, 'SUCCESS');

  const currentConfig = await requestJson('/api/devices/RUB043-CTRL01/config', {
    method: 'GET',
    headers: {
      authorization: `Bearer ${vendorToken}`
    }
  });
  assert.equal(currentConfig.response.status, 200);
  assert.equal(currentConfig.body.data.config_version, 2);

  const configHistory = await requestJson('/api/devices/RUB043-CTRL01/config/history', {
    method: 'GET',
    headers: {
      authorization: `Bearer ${vendorToken}`
    }
  });
  assert.equal(configHistory.response.status, 200);
  assert.ok(configHistory.body.data.length >= 1);

  const adminUserList = await requestJson('/api/admin/users', {
    method: 'GET',
    headers: {
      authorization: `Bearer ${vendorToken}`
    }
  });
  assert.equal(adminUserList.response.status, 200);
  assert.ok(Array.isArray(adminUserList.body.data));
  assert.ok(adminUserList.body.data.some((item) => item.login_id === 'operator_rub043'));

  const createAppUser = await requestJson('/api/admin/users', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${vendorToken}`
    },
    body: JSON.stringify({
      login_id: 'apk_user_test',
      password: 'Pass@123',
      name: 'APK User Test',
      role: 'OPERATOR',
      assigned_location_ids: ['RUB043'],
      is_active: true
    })
  });
  assert.equal(createAppUser.response.status, 201);
  const managedUserId = createAppUser.body.data.user_id;
  assert.ok(managedUserId);

  const managedUserLogin = await requestJson('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      login_id: 'apk_user_test',
      password: 'Pass@123',
      device_name: 'Managed User Device',
      app_type: 'ANDROID'
    })
  });
  assert.equal(managedUserLogin.response.status, 200);
  const managedUserToken = managedUserLogin.body.data.token;

  const revokeAccess = await requestJson(`/api/admin/users/${managedUserId}/access`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${vendorToken}`
    },
    body: JSON.stringify({
      is_active: false,
      reason: 'Access withdrawn by super admin for test'
    })
  });
  assert.equal(revokeAccess.response.status, 200);
  assert.equal(revokeAccess.body.data.user.is_active, false);

  const revokedLogin = await requestJson('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      login_id: 'apk_user_test',
      password: 'Pass@123',
      device_name: 'Managed User Device',
      app_type: 'ANDROID'
    })
  });
  assert.equal(revokedLogin.response.status, 401);

  const revokedSessionUse = await requestJson('/api/locations', {
    method: 'GET',
    headers: {
      authorization: `Bearer ${managedUserToken}`
    }
  });
  assert.equal(revokedSessionUse.response.status, 401);

  const compaction = await requestJson('/api/admin/jobs/no-water-compaction', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${vendorToken}`
    },
    body: JSON.stringify({ hours: 24 })
  });
  assert.equal(compaction.response.status, 200);
  assert.ok(Number.isInteger(compaction.body.data.compacted_groups));
  assert.ok(compaction.body.data.compacted_groups >= 0);

  const dangerEvent = await requestJson('/api/device/event', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': 'FG_LOCAL_DEV_KEY'
    },
    body: JSON.stringify({
      device_id: 'RUB043-CTRL01',
      location_id: 'RUB043',
      event_type: 'DANGER_CONFIRMED',
      water_level_mm: 512,
      reason: 'Water level >= 500mm for 60 seconds'
    })
  });
  assert.equal(dangerEvent.response.status, 201);

  const incidents = await requestJson('/api/incidents?location_id=RUB043', {
    method: 'GET',
    headers: {
      authorization: `Bearer ${operatorToken}`
    }
  });
  assert.equal(incidents.response.status, 200);
  assert.ok(incidents.body.data.length >= 1);
  assert.equal(incidents.body.data[0].status, 'ACTIVE');

  const firmware = await requestJson('/api/device/RUB043-CTRL01/firmware/latest', {
    method: 'GET',
    headers: {
      'x-api-key': 'FG_LOCAL_DEV_KEY'
    }
  });
  assert.equal(firmware.response.status, 200);
  assert.match(firmware.body.data.file_url, /flash\.iotsoft\.in/);

  const audit = await requestJson('/api/audit-logs?location_id=RUB043', {
    method: 'GET',
    headers: {
      authorization: `Bearer ${operatorToken}`
    }
  });
  assert.equal(audit.response.status, 200);
  assert.ok(audit.body.data.length >= 2);

  const locations = await requestJson('/api/locations', {
    method: 'GET',
    headers: {
      authorization: `Bearer ${operatorToken}`
    }
  });
  assert.equal(locations.response.status, 200);
  assert.ok(locations.body.data.length >= 1);
});
