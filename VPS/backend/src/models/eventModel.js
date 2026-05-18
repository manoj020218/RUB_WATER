const { v4: uuidv4 } = require('uuid');
const { badRequest } = require('../utils/errors');
const { toIso } = require('../utils/time');

function createEventRecord(payload) {
  if (!payload || typeof payload !== 'object') {
    throw badRequest('Invalid event payload');
  }

  const eventType = payload.event_type;
  if (!eventType) {
    throw badRequest('event_type is required');
  }

  if (!payload.device_id || !payload.location_id) {
    throw badRequest('device_id and location_id are required');
  }

  return {
    _id: uuidv4(),
    type: 'EVENT',
    event_type: eventType,
    timestamp: toIso(payload.timestamp),
    location_id: payload.location_id,
    device_id: payload.device_id,
    water_level_mm: Number(payload.water_level_mm ?? 0),
    reason: payload.reason || null,
    source: payload.source || 'device',
    details: payload.details || {}
  };
}

module.exports = {
  createEventRecord
};
