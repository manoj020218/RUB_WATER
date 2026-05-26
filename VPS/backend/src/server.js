const http = require('http');
const env = require('./config/env');
const { dataStore } = require('./db/datastore');
const { loadFromDisk, flushSync, startAutoSave, stopAutoSave } = require('./db/persistence');
const { createApp } = require('./app');
const { startMqttBridge } = require('./mqtt/mqttBridge');
const { createLiveSocketServer } = require('./services/liveSocketService');
const { startWebhookDispatcher } = require('./services/headOfficeIntegrationService');

// Load persisted data before createApp() so seedIfEmpty() sees existing records
loadFromDisk(dataStore);

const app = createApp();

// Persist state every 5 seconds — at most 5s data loss on hard kill
startAutoSave(dataStore, 5000);
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

  stopAutoSave();
  flushSync(dataStore); // Final save before exit

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
