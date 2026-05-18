const env = require('./config/env');
const { createApp } = require('./app');
const { startMqttBridge } = require('./mqtt/mqttBridge');

const app = createApp();
const mqttClient = startMqttBridge();

const server = app.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`[FloodGuard VPS] listening on port ${env.port}`);
});

function shutdown(signalName) {
  // eslint-disable-next-line no-console
  console.log(`[FloodGuard VPS] shutting down on ${signalName}`);

  if (mqttClient && typeof mqttClient.end === 'function') {
    mqttClient.end(true);
  }

  server.close(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
