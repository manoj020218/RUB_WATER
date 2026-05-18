const { v4: uuidv4 } = require('uuid');
const telemetryRepository = require('../repositories/telemetryRepository');
const deviceRepository = require('../repositories/deviceRepository');
const locationRepository = require('../repositories/locationRepository');
const commandRepository = require('../repositories/commandRepository');
const { createTelemetryRecord } = require('../models/telemetryModel');
const { createEventRecord } = require('../models/eventModel');
const incidentService = require('./incidentService');
const notificationService = require('./notificationService');
const { notFound } = require('../utils/errors');
const { toIso } = require('../utils/time');

function ingestTelemetry(payload) {
  const record = createTelemetryRecord(payload);
  const device = deviceRepository.findById(record.device_id);
  if (!device) {
    throw notFound('Device not found');
  }

  telemetryRepository.insert(record);
  deviceRepository.updateRuntime(record.device_id, {
    status: record.status === 'DANGER' ? 'DANGER' : 'ONLINE',
    last_seen: record.timestamp,
    firmware_version: record.firmware_version,
    last_water_level_mm: record.water_level_mm,
    last_primary_sensor_status: record.primary_sensor_status
  });

  if (record.status === 'DANGER' || record.switch_500mm || record.water_level_mm >= 500) {
    incidentService.openOrUpdateDangerIncident({
      locationId: record.location_id,
      deviceId: record.device_id,
      waterLevel: record.water_level_mm,
      reason: 'Danger threshold from telemetry',
      source: 'telemetry'
    });
  }

  return record;
}

function ingestEvent(payload) {
  const event = createEventRecord(payload);
  const device = deviceRepository.findById(event.device_id);
  if (!device) {
    throw notFound('Device not found');
  }

  telemetryRepository.insert(event);
  deviceRepository.updateRuntime(event.device_id, {
    last_seen: event.timestamp,
    status: event.event_type === 'DEVICE_OFFLINE' ? 'OFFLINE' : 'ONLINE'
  });

  let incident = null;
  if (event.event_type === 'DANGER_CONFIRMED') {
    incident = incidentService.openOrUpdateDangerIncident({
      locationId: event.location_id,
      deviceId: event.device_id,
      waterLevel: event.water_level_mm,
      reason: event.reason,
      source: 'event'
    });
    notificationService.publishNotification('DANGER_CONFIRMED', event);
  }

  if (event.event_type === 'DANGER_AUTO_CLEARED') {
    incident = incidentService.closeIncidentAuto({
      locationId: event.location_id,
      reason: event.reason
    });
    notificationService.publishNotification('DANGER_AUTO_CLEARED', event);
  }

  return {
    event,
    incident
  };
}

function ingestHeartbeat(payload = {}, topicDeviceId = null) {
  const deviceId = payload.device_id || topicDeviceId;
  if (!deviceId) {
    throw notFound('Device not found');
  }

  const device = deviceRepository.findById(deviceId);
  if (!device) {
    throw notFound('Device not found');
  }

  const timestamp = toIso(payload.timestamp || payload.timestamp_iso || null);
  const online = payload.online !== false;
  const status = online ? 'ONLINE' : 'OFFLINE';

  deviceRepository.updateRuntime(deviceId, {
    status,
    last_seen: timestamp,
    last_heartbeat: timestamp,
    last_wifi_connected: Boolean(payload.wifi_connected),
    last_internet_available: Boolean(payload.internet_available),
    last_sim_registered: Boolean(payload.sim_registered)
  });

  const heartbeatRecord = {
    _id: `hb_${uuidv4().replace(/-/g, '').slice(0, 12)}`,
    type: 'HEARTBEAT',
    device_id: deviceId,
    location_id: device.location_id,
    timestamp,
    status,
    online,
    source: payload.source || 'mqtt',
    details: {
      product_pid: payload.product_pid || null,
      hardware_code: payload.hardware_code || null,
      timestamp_ms: payload.timestamp_ms || null,
      wifi_connected: payload.wifi_connected ?? null,
      internet_available: payload.internet_available ?? null,
      sim_registered: payload.sim_registered ?? null
    }
  };

  telemetryRepository.insert(heartbeatRecord);
  return heartbeatRecord;
}

function getPendingCommands(deviceId) {
  const device = deviceRepository.findById(deviceId);
  if (!device) {
    throw notFound('Device not found');
  }

  return commandRepository.listPendingByDevice(deviceId).map((command) => ({
    command_id: command.command_id,
    command: command.command,
    issued_by: command.issued_by,
    location_id: command.location_id,
    payload: command.payload,
    issued_at: command.issued_at,
    expires_at: command.expires_at
  }));
}

function getDeviceConfig(deviceId) {
  const device = deviceRepository.findById(deviceId);
  if (!device) {
    throw notFound('Device not found');
  }

  const location = locationRepository.findById(device.location_id);
  if (!location) {
    throw notFound('Location not found');
  }

  return {
    device_id: device._id,
    location_id: device.location_id,
    config: {
      daily_reboot_enabled: device.config.daily_reboot_enabled,
      daily_reboot_time: device.config.daily_reboot_time,
      timezone: device.config.timezone,
      reporting_profile: device.config.reporting_profile,
      sensor_mount_height_mm: location.sensor_mount_height_mm,
      alert_level_mm: location.alert_level_mm,
      danger_level_mm: location.danger_level_mm,
      danger_clear_level_mm: location.danger_clear_level_mm
    }
  };
}

function getLocationDashboard(locationId) {
  const location = locationRepository.findById(locationId);
  if (!location) {
    throw notFound('Location not found');
  }

  const items = telemetryRepository
    .listByLocation(locationId)
    .filter((item) => item.type === 'TELEMETRY')
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const latest = items[0] || null;
  return {
    location,
    latest,
    sample_count: items.length
  };
}

module.exports = {
  ingestTelemetry,
  ingestEvent,
  ingestHeartbeat,
  getPendingCommands,
  getDeviceConfig,
  getLocationDashboard
};
