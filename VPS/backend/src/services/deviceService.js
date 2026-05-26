const { v4: uuidv4 } = require('uuid');
const telemetryRepository = require('../repositories/telemetryRepository');
const deviceRepository = require('../repositories/deviceRepository');
const locationRepository = require('../repositories/locationRepository');
const commandRepository = require('../repositories/commandRepository');
const deviceConfigRepository = require('../repositories/deviceConfigRepository');
const { createTelemetryRecord } = require('../models/telemetryModel');
const { createEventRecord } = require('../models/eventModel');
const incidentService = require('./incidentService');
const notificationService = require('./notificationService');
const auditService = require('./auditService');
const { publishRealtime } = require('./realtimeBus');
const { notFound } = require('../utils/errors');
const { toIso } = require('../utils/time');

function ingestTelemetry(payload) {
  const device = deviceRepository.findById(payload.device_id);
  if (!device) {
    throw notFound('Device not found');
  }

  // Resolve location from device record when payload omits it (e.g. freshly registered device)
  const resolvedPayload = (!payload.location_id && device.location_id)
    ? { ...payload, location_id: device.location_id }
    : payload;

  const record = createTelemetryRecord(resolvedPayload);

  telemetryRepository.insert(record);
  deviceRepository.updateRuntime(record.device_id, {
    status: record.status === 'DANGER' ? 'DANGER' : 'ONLINE',
    last_seen: record.timestamp,
    firmware_version: record.firmware_version,
    last_water_level_mm: record.water_level_mm,
    last_primary_sensor_status: record.primary_sensor_status
  });

  if (record.location_id && (record.status === 'DANGER' || record.switch_500mm || record.water_level_mm >= 500)) {
    incidentService.openOrUpdateDangerIncident({
      locationId: record.location_id,
      deviceId: record.device_id,
      waterLevel: record.water_level_mm,
      reason: 'Danger threshold from telemetry',
      source: 'telemetry'
    });
  }

  publishRealtime('TELEMETRY_UPDATED', {
    location_id: record.location_id,
    device_id: record.device_id,
    status: record.status,
    water_level_mm: record.water_level_mm,
    timestamp: record.timestamp,
    payload: record
  });

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

  if (event.event_type === 'LOCAL_CONFIG_CHANGED') {
    auditService.writeAuditLog({
      locationId: event.location_id,
      eventType: 'LOCAL_CONFIG_CHANGED_ON_DEVICE',
      performedBy: event.device_id,
      loginId: event.device_id,
      sessionId: null,
      deviceName: event.device_id,
      ipAddress: null,
      details: {
        source: event.reason || event.source || 'device_local_page',
        event
      }
    });
  }

  publishRealtime('DEVICE_EVENT', {
    location_id: event.location_id,
    device_id: event.device_id,
    event_type: event.event_type,
    timestamp: event.timestamp,
    payload: event
  });

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
  publishRealtime('DEVICE_HEARTBEAT', {
    location_id: heartbeatRecord.location_id,
    device_id: heartbeatRecord.device_id,
    status: heartbeatRecord.status,
    timestamp: heartbeatRecord.timestamp,
    payload: heartbeatRecord
  });
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

  const saved = deviceConfigRepository.getCurrentByDevice(deviceId);
  const config = saved ? {
    alert_level_mm: saved.alert_level_mm,
    danger_level_mm: saved.danger_level_mm,
    clear_level_mm: saved.clear_level_mm,
    trigger_delay_seconds: saved.trigger_delay_seconds,
    clear_delay_seconds: saved.clear_delay_seconds,
    rs485_sensor_enabled: saved.rs485_sensor_enabled,
    switch_sensor_enabled: saved.switch_sensor_enabled,
    switch_level_1_mm: saved.switch_level_1_mm,
    switch_level_2_mm: saved.switch_level_2_mm,
    sensor_mount_height_mm: saved.sensor_mount_height_mm,
    mismatch_duration_seconds: saved.mismatch_duration_seconds,
    config_version: saved.config_version,
    last_ack_status: saved.last_ack_status
  } : {
    sensor_mount_height_mm: location.sensor_mount_height_mm,
    alert_level_mm: location.alert_level_mm,
    danger_level_mm: location.danger_level_mm,
    clear_level_mm: location.danger_clear_level_mm
  };

  return {
    device_id: device._id,
    location_id: device.location_id,
    config: {
      daily_reboot_enabled: device.config.daily_reboot_enabled,
      daily_reboot_time: device.config.daily_reboot_time,
      timezone: device.config.timezone,
      reporting_profile: device.config.reporting_profile,
      ...config
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
