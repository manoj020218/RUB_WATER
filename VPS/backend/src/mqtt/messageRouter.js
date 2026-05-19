const deviceRepository = require('../repositories/deviceRepository');
const deviceService = require('../services/deviceService');
const commandService = require('../services/commandService');
const deviceConfigService = require('../services/deviceConfigService');
const { parseTopic } = require('./topicParser');

function parsePayload(payload) {
  if (payload === null || payload === undefined) {
    return {};
  }

  if (Buffer.isBuffer(payload)) {
    const text = payload.toString('utf8').trim();
    return text.length > 0 ? JSON.parse(text) : {};
  }

  if (typeof payload === 'string') {
    const text = payload.trim();
    return text.length > 0 ? JSON.parse(text) : {};
  }

  if (typeof payload === 'object') {
    return payload;
  }

  return {};
}

function resolveLocationId(payload, deviceIdFromTopic) {
  if (payload.location_id) {
    return payload.location_id;
  }
  const device = deviceRepository.findById(deviceIdFromTopic);
  return device ? device.location_id : null;
}

function normalizeCommandAckPayload(payload) {
  const normalized = { ...payload };
  if (!normalized.status) {
    normalized.status = 'SUCCESS';
  }
  if (!normalized.executed_at && normalized.executed_at_ms !== undefined) {
    normalized.executed_at = new Date().toISOString();
  }
  return normalized;
}

function handleIncomingMqttMessage(topic, payload, options = {}) {
  const parsedTopic = parseTopic(topic, options.topicBase || 'rub');
  if (!parsedTopic) {
    return {
      handled: false,
      reason: 'unsupported_topic',
      topic
    };
  }

  let message;
  try {
    message = parsePayload(payload);
  } catch (error) {
    return {
      handled: false,
      reason: 'invalid_json',
      topic,
      error: error.message
    };
  }

  const deviceId = message.device_id || parsedTopic.deviceId;
  const locationId = resolveLocationId(message, parsedTopic.deviceId);
  const enriched = {
    ...message,
    device_id: deviceId,
    location_id: locationId
  };

  if (parsedTopic.channel === 'telemetry') {
    const record = deviceService.ingestTelemetry(enriched);
    return {
      handled: true,
      channel: 'telemetry',
      result: record
    };
  }

  if (parsedTopic.channel === 'event') {
    const result = deviceService.ingestEvent(enriched);
    return {
      handled: true,
      channel: 'event',
      result
    };
  }

  if (parsedTopic.channel === 'heartbeat') {
    const result = deviceService.ingestHeartbeat(enriched, parsedTopic.deviceId);
    return {
      handled: true,
      channel: 'heartbeat',
      result
    };
  }

  if (parsedTopic.channel === 'command_ack') {
    const ackPayload = normalizeCommandAckPayload(enriched);
    const commandId = ackPayload.command_id;
    const ack = commandService.ackCommand({ commandId, payload: ackPayload });
    return {
      handled: true,
      channel: 'command_ack',
      result: ack
    };
  }

  if (parsedTopic.channel === 'config_ack') {
    const ack = deviceConfigService.ackDeviceConfig(enriched);
    return {
      handled: true,
      channel: 'config_ack',
      result: ack
    };
  }

  return {
    handled: false,
    reason: 'channel_not_mapped',
    topic,
    channel: parsedTopic.channel
  };
}

module.exports = {
  handleIncomingMqttMessage
};
