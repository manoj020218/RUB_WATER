const { onRealtime } = require('./realtimeBus');

function createLiveSocketServer(httpServer) {
  let WebSocketServer;
  try {
    ({ WebSocketServer } = require('ws'));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[FloodGuard Live] ws package not installed. Live WebSocket disabled.');
    return {
      enabled: false,
      close: () => {}
    };
  }

  const wss = new WebSocketServer({ server: httpServer, path: '/ws/live' });
  const clients = new Map();

  function safeSend(ws, payload) {
    if (!ws || ws.readyState !== ws.OPEN) {
      return;
    }
    try {
      ws.send(JSON.stringify(payload));
    } catch (error) {
      // ignore send errors for disconnected clients
    }
  }

  wss.on('connection', (ws) => {
    const state = {
      locationIds: new Set()
    };
    clients.set(ws, state);

    safeSend(ws, {
      event: 'CONNECTED',
      payload: {
        channel: 'FloodGuard Live',
        path: '/ws/live'
      },
      timestamp: new Date().toISOString()
    });

    ws.on('message', (raw) => {
      let data;
      try {
        data = JSON.parse(String(raw || ''));
      } catch (error) {
        safeSend(ws, {
          event: 'ERROR',
          payload: { message: 'Invalid JSON message' },
          timestamp: new Date().toISOString()
        });
        return;
      }

      const action = String(data?.action || '').trim().toLowerCase();
      if (action === 'subscribe_location') {
        const locationId = String(data?.location_id || '').trim();
        if (locationId) {
          state.locationIds.add(locationId);
          safeSend(ws, {
            event: 'SUBSCRIBED',
            payload: { location_id: locationId },
            timestamp: new Date().toISOString()
          });
        }
      } else if (action === 'unsubscribe_location') {
        const locationId = String(data?.location_id || '').trim();
        if (locationId) {
          state.locationIds.delete(locationId);
          safeSend(ws, {
            event: 'UNSUBSCRIBED',
            payload: { location_id: locationId },
            timestamp: new Date().toISOString()
          });
        }
      } else if (action === 'ping') {
        safeSend(ws, {
          event: 'PONG',
          payload: {},
          timestamp: new Date().toISOString()
        });
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
    });
  });

  const unsubscribe = onRealtime((message) => {
    const locationId = String(message?.payload?.location_id || '').trim();
    clients.forEach((state, ws) => {
      if (state.locationIds.size > 0 && locationId && !state.locationIds.has(locationId)) {
        return;
      }
      safeSend(ws, message);
    });
  });

  return {
    enabled: true,
    close: () => {
      unsubscribe();
      wss.close();
    }
  };
}

module.exports = {
  createLiveSocketServer
};
