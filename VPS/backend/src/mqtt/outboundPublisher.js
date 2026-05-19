const env = require('../config/env');

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

function publishConfigUpdate(deviceId, payload) {
  if (!env.mqttEnabled || !deviceId) {
    return false;
  }

  const mqtt = resolveMqttLibrary();
  if (!mqtt) {
    return false;
  }

  const topic = `${env.mqttTopicBase}/${deviceId}/config`;
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload || {});
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

module.exports = {
  publishConfigUpdate
};
