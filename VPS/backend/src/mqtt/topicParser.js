function normalizeTopicBases(topicBases) {
  if (Array.isArray(topicBases)) {
    return [...new Set(topicBases.map((item) => String(item || '').trim()).filter(Boolean))];
  }
  const single = String(topicBases || '').trim();
  return single ? [single] : ['floodguard'];
}

function parseTopic(topic, topicBases = 'floodguard') {
  if (!topic || typeof topic !== 'string') {
    return null;
  }

  const parts = topic.split('/');
  if (parts.length !== 3) {
    return null;
  }

  const [base, routeId, channel] = parts;
  const allowedBases = normalizeTopicBases(topicBases);
  if (!allowedBases.includes(base) || !routeId || !channel) {
    return null;
  }

  return {
    base,
    routeId,
    channel
  };
}

module.exports = {
  parseTopic,
  normalizeTopicBases
};
