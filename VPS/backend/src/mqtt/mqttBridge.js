const env = require('../config/env');
const { handleIncomingMqttMessage } = require('./messageRouter');

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

function buildSubscriptions(topicBases) {
  const bases = Array.isArray(topicBases) ? topicBases : [topicBases];
  return [...new Set(bases.filter(Boolean).flatMap((topicBase) => ([
    `${topicBase}/+/telemetry`,
    `${topicBase}/+/event`,
    `${topicBase}/+/heartbeat`,
    `${topicBase}/+/command_ack`,
    `${topicBase}/+/config_ack`
  ])))];
}

function startMqttBridge() {
  if (!env.mqttEnabled) {
    // eslint-disable-next-line no-console
    console.log('[FloodGuard MQTT] Bridge disabled by config');
    return null;
  }

  const mqtt = resolveMqttLibrary();
  if (!mqtt) {
    // eslint-disable-next-line no-console
    console.warn('[FloodGuard MQTT] mqtt package not installed. MQTT bridge not started.');
    return null;
  }

  const options = {
    reconnectPeriod: 2000,
    clientId: `floodguard-vps-${Math.random().toString(16).slice(2, 10)}`
  };

  if (env.mqttUser) {
    options.username = env.mqttUser;
  }
  if (env.mqttPass) {
    options.password = env.mqttPass;
  }

  const client = mqtt.connect(env.mqttUrl, options);

  client.on('connect', () => {
    // eslint-disable-next-line no-console
    console.log(`[FloodGuard MQTT] Connected to ${env.mqttUrl}`);

    const subscriptions = buildSubscriptions(env.mqttTopicAliases || env.mqttTopicBase);
    subscriptions.forEach((topic) => {
      client.subscribe(topic, { qos: 1 }, (err) => {
        if (err) {
          // eslint-disable-next-line no-console
          console.error(`[FloodGuard MQTT] Subscribe failed for ${topic}:`, err.message);
          return;
        }
        // eslint-disable-next-line no-console
        console.log(`[FloodGuard MQTT] Subscribed: ${topic}`);
      });
    });
  });

  client.on('message', (topic, message) => {
    try {
      const outcome = handleIncomingMqttMessage(topic, message, {
        topicBases: env.mqttTopicAliases || env.mqttTopicBase
      });

      if (!outcome.handled) {
        // eslint-disable-next-line no-console
        console.log(`[FloodGuard MQTT] Skipped message topic=${topic} reason=${outcome.reason}`);
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`[FloodGuard MQTT] Failed processing message topic=${topic}:`, error.message);
    }
  });

  client.on('error', (error) => {
    // eslint-disable-next-line no-console
    console.error('[FloodGuard MQTT] Client error:', error.message);
  });

  client.on('offline', () => {
    // eslint-disable-next-line no-console
    console.warn('[FloodGuard MQTT] Client offline');
  });

  return client;
}

module.exports = {
  startMqttBridge,
  buildSubscriptions
};
