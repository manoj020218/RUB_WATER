function parseTopic(topic, topicBase = 'rub') {
  if (!topic || typeof topic !== 'string') {
    return null;
  }

  const parts = topic.split('/');
  if (parts.length !== 3) {
    return null;
  }

  const [base, deviceId, channel] = parts;
  if (base !== topicBase || !deviceId || !channel) {
    return null;
  }

  return {
    base,
    deviceId,
    channel
  };
}

module.exports = {
  parseTopic
};
