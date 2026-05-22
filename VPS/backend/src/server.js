const http = require('http');
const env = require('./config/env');
const { createApp } = require('./app');
const { startMqttBridge } = require('./mqtt/mqttBridge');
const { createLiveSocketServer } = require('./services/liveSocketService');
const { startWebhookDispatcher } = require('./services/headOfficeIntegrationService');

const app = createApp();
const httpServer = http.createServer(app);
const mqttClient = startMqttBridge();
const liveSocket = createLiveSocketServer(httpServer);
const stopWebhookDispatcher = startWebhookDispatcher();

httpServer.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`[FloodGuard VPS] listening on port ${env.port}`);
  if (liveSocket?.enabled) {
    // eslint-disable-next-line no-console
    console.log('[FloodGuard Live] WebSocket enabled at /ws/live');
  }
});

function shutdown(signalName) {
  // eslint-disable-next-line no-console
  console.log(`[FloodGuard VPS] shutting down on ${signalName}`);

  if (mqttClient && typeof mqttClient.end === 'function') {
    mqttClient.end(true);
  }
  if (liveSocket && typeof liveSocket.close === 'function') {
    liveSocket.close();
  }
  if (typeof stopWebhookDispatcher === 'function') {
    stopWebhookDispatcher();
  }

  httpServer.close(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
