const { EventEmitter } = require('events');

const realtimeBus = new EventEmitter();
realtimeBus.setMaxListeners(50);

function publishRealtime(eventName, payload) {
  realtimeBus.emit('message', {
    event: eventName,
    payload: payload || {},
    timestamp: new Date().toISOString()
  });
}

function onRealtime(listener) {
  realtimeBus.on('message', listener);
  return () => realtimeBus.off('message', listener);
}

module.exports = {
  publishRealtime,
  onRealtime
};
