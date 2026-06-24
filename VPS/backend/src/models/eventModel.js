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

  const derivedLevel = String(eventType).toUpperCase().includes('DANGER')
    ? 'DANGER'
    : (String(eventType).toUpperCase().includes('ORANGE') || String(eventType).toUpperCase().includes('ALERT')
        ? 'ORANGE'
        : 'NORMAL');
  const derivedStatus = String(eventType).toUpperCase().includes('UNCONFIRMED')
    || String(eventType).toUpperCase().includes('SUSPECTED')
    || String(eventType).toUpperCase().includes('MISMATCH')
    ? 'SUSPECTED'
    : (String(eventType).toUpperCase().includes('WAITING')
        ? 'WAITING_CONFIRMATION'
        : (derivedLevel === 'NORMAL' ? 'IDLE' : 'CONFIRMED'));

  const details = {
    ...(payload.details && typeof payload.details === 'object' ? payload.details : {}),
    ...(payload.current_config && typeof payload.current_config === 'object'
      ? { current_config: payload.current_config }
      : {}),
    ...(payload.boot_status ? { boot_status: payload.boot_status } : {}),
    ...(payload.current_config_version ? { current_config_version: payload.current_config_version } : {})
  };

  return {
    _id: uuidv4(),
    type: 'EVENT',
    event_type: eventType,
    timestamp: toIso(payload.timestamp),
    location_id: payload.location_id,
    device_id: payload.device_id,
    hardware_id: payload.hardware_id ? String(payload.hardware_id).trim().toUpperCase() : null,
    mqtt_route_id: payload.mqtt_route_id ? String(payload.mqtt_route_id).trim().toUpperCase() : null,
    water_level_mm: Number(payload.water_level_mm ?? 0),
    reason: payload.reason || details.reason || null,
    source: payload.source || 'device',
    alert_level: String(payload.alert_level || details.alert_level || derivedLevel).toUpperCase(),
    alert_status: String(payload.alert_status || details.alert_status || derivedStatus).toUpperCase(),
    alert_source: String(payload.alert_source || details.alert_source || 'NONE').toUpperCase(),
    current_config_version: Number(payload.current_config_version || details.current_config_version || 0),
    details
  };
}

module.exports = {
  createEventRecord
};
