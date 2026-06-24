const env = require('../config/env');
const deviceRepository = require('../repositories/deviceRepository');

let mqttLib;

function resolveMqttLibrary() {
  if (mqttLib !== undefined) {
    return mqttLib;
  }

  try {
    // eslint-disable-next-line global-require
    mqttLib = require('mqtt');
  } catch (error) {
    mqttLib = null;
  }
  return mqttLib;
}

function normalizeIdentity(value) {
  return String(value || '').trim().toUpperCase();
}

function resolvePublishTarget(deviceIdentity) {
  const identity = normalizeIdentity(deviceIdentity);
  if (!identity) {
    return { device: null, routeId: '' };
  }

  const device = deviceRepository.resolveByIdentity({
    deviceId: identity,
    hardwareId: identity,
    routeId: identity
  }) || null;
  const routeId = normalizeIdentity(device?.mqtt_route_id || device?.hardware_id || device?._id || identity);
  return { device, routeId };
}

function buildPayloadBody(payload, device, routeId) {
  if (typeof payload === 'string') {
    return payload;
  }

  const body = {
    ...(payload || {})
  };
  if (device) {
    if (!body.device_id) {
      body.device_id = device._id;
    }
    if (!body.hardware_id && device.hardware_id) {
      body.hardware_id = device.hardware_id;
    }
  }
  if (!body.mqtt_route_id && routeId) {
    body.mqtt_route_id = routeId;
  }
  return JSON.stringify(body);
}

function publishDeviceMessage(deviceIdentity, channel, payload) {
  if (!env.mqttEnabled || !deviceIdentity || !channel) {
    return false;
  }

  const mqtt = resolveMqttLibrary();
  if (!mqtt) {
    return false;
  }

  const { device, routeId } = resolvePublishTarget(deviceIdentity);
  if (!routeId) {
    return false;
  }

  const topic = `${env.mqttTopicBase}/${routeId}/${channel}`;
  const body = buildPayloadBody(payload, device, routeId);
  const client = mqtt.connect(env.mqttUrl, {
    reconnectPeriod: 0,
    connectTimeout: 2000,
    clientId: `fg-out-${Math.random().toString(16).slice(2, 10)}`,
    username: env.mqttUser || undefined,
    password: env.mqttPass || undefined
  });

  const done = () => {
    try {
      client.end(true);
    } catch (error) {
      // ignore
    }
  };

  client.on('connect', () => {
    client.publish(topic, body, { qos: 1, retain: false }, () => done());
  });

  client.on('error', () => done());
  setTimeout(done, 3000);
  return true;
}

function publishConfigUpdate(deviceId, payload) {
  return publishDeviceMessage(deviceId, 'config', payload);
}

module.exports = {
  publishDeviceMessage,
  publishConfigUpdate
};
