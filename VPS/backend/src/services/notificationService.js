function publishNotification(eventName, payload) {
  return {
    sent: true,
    channel: 'stub-fcm',
    event_name: eventName,
    payload,
    timestamp: new Date().toISOString()
  };
}

module.exports = {
  publishNotification
};
