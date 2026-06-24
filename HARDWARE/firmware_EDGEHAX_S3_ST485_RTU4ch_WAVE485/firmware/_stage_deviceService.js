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
const {
  syncDeviceReportedConfig,
  sensorLogicModeFromConfig,
  sensorModeFromConfig
} = require('./deviceConfigService');

function shapeConfig(config = {}) {
  return {
    ...config,
    trigger_delay_s: config.trigger_delay_seconds,
    clear_delay_s: config.clear_delay_seconds,
    rs485_enabled: config.rs485_sensor_enabled,
    switch_enabled: config.switch_sensor_enabled,
    version: config.config_version,
    current_config_version: config.config_version,
    sensor_logic_mode: sensorLogicModeFromConfig(config),
    sensor_mode: sensorModeFromConfig(config),
    sensor_confirmation_wait_sec: config.mismatch_duration_seconds,
    last_ack_at: config.last_ack_at || null,
    reported_at: config.device_reported_at || null,
    last_verification_status: config.last_verification_status || null,
    last_verification_message: config.last_verification_message || null,
    verified_at: config.verified_at || null,
    state: config.state || 'ACTIVE'
  };
}

function shapeTelemetry(record) {
  if (!record) {
    return null;
  }
  return {
    ...record,
    rssi: record.rssi ?? record.wifi_rssi ?? 0,
    battery_v: record.battery_v ?? record.battery_voltage ?? 0,
    battery_ma: record.battery_ma ?? record.battery_current_ma ?? 0,
    battery_mw: record.battery_mw ?? record.battery_power_mw ?? 0,
    relay_siren: record.relay_status?.siren ?? false,
    relay_flash: record.relay_status?.flash ?? record.relay_status?.beacon ?? false,
    received_at: record.received_at || record.timestamp,
    sensor_logic_mode: record.sensor_logic_mode || 'DUAL',
    sensor_mode: record.sensor_mode || 'BOTH_ACTIVE',
    sensor_confirmation_wait_sec: record.sensor_confirmation_wait_sec ?? record.mismatch_duration_seconds ?? null,
    current_config_version: record.current_config_version ?? null,
    alert_level: record.alert_level || 'NORMAL',
    alert_status: record.alert_status || 'IDLE',
    alert_source: record.alert_source || 'NONE',
    alert_reason: record.alert_reason || null,
    pending_alert_level: record.pending_alert_level || 'NORMAL'
  };
}

function eventAlertSnapshot(event) {
  const eventType = String(event.event_type || '').toUpperCase();
  const derivedLevel = eventType.includes('DANGER')
    ? 'DANGER'
    : ((eventType.includes('ORANGE') || eventType.includes('ALERT')) ? 'ORANGE' : 'NORMAL');
  const derivedStatus = eventType.includes('UNCONFIRMED') || eventType.includes('SUSPECTED') || eventType.includes('MISMATCH')
    ? 'SUSPECTED'
    : (eventType.includes('WAITING')
        ? 'WAITING_CONFIRMATION'
        : ((eventType.includes('DYP_ONLY') || eventType.includes('SWITCH_ONLY'))
            ? 'CONFIRMED_BY_SINGLE_SENSOR'
            : (eventType.includes('NO_SENSOR') ? 'DISABLED' : (derivedLevel === 'NORMAL' ? 'IDLE' : 'CONFIRMED'))));
  return {
    alertLevel: String(event.alert_level || event.details?.alert_level || derivedLevel).toUpperCase(),
    alertStatus: String(event.alert_status || event.details?.alert_status || derivedStatus).toUpperCase(),
    alertSource: String(event.alert_source || event.details?.alert_source || 'NONE').toUpperCase(),
    reason: event.reason || event.details?.reason || null
  };
}

function notifyForAlert(event, alert) {
  if (alert.alertLevel === 'DANGER') {
    notificationService.publishNotification(
      alert.alertStatus === 'SUSPECTED' ? 'DANGER_SUSPECTED' : 'DANGER_CONFIRMED',
      event
    );
    return;
  }
  if (alert.alertLevel === 'ORANGE') {
    notificationService.publishNotification(
      alert.alertStatus === 'SUSPECTED' ? 'ALERT_ORANGE_SUSPECTED' : 'ALERT_ORANGE',
      event
    );
  }
}

function writeSensorModeAudit({ locationId, deviceId, oldMode, newMode, source, currentConfigVersion }) {
  if (!oldMode || !newMode || oldMode === newMode) {
    return;
  }
  auditService.writeAuditLog({
    locationId,
    eventType: 'SENSOR_MODE_CHANGED',
    performedBy: deviceId,
    loginId: deviceId,
    sessionId: null,
    deviceName: deviceId,
    ipAddress: null,
    details: {
      old_mode: oldMode,
      new_mode: newMode,
      source,
      current_config_version: currentConfigVersion || null,
      timestamp: new Date().toISOString()
    }
  });
}

function syncReportedConfigAndAudit({ deviceId, locationId, reportedConfig, reportedVersion, reportedAt, source }) {
  const previous = deviceConfigRepository.getCurrentByDevice(deviceId);
  const previousMode = previous ? sensorModeFromConfig(previous) : null;
  const updated = syncDeviceReportedConfig({
    deviceId,
    locationId,
    reportedConfig,
    reportedVersion,
    reportedAt,
    source
  });
  if (updated) {
    writeSensorModeAudit({
      locationId,
      deviceId,
      oldMode: previousMode,
      newMode: sensorModeFromConfig(updated),
      source,
      currentConfigVersion: updated.config_version
    });
  }
  return updated;
}

function ingestTelemetry(payload) {
  const device = deviceRepository.findById(payload.device_id);
  if (!device) {
    throw notFound('Device not found');
  }

  const resolvedPayload = (!payload.location_id && device.location_id)
    ? { ...payload, location_id: device.location_id }
    : payload;

  const record = createTelemetryRecord(resolvedPayload);

  telemetryRepository.insert(record);
  deviceRepository.updateRuntime(record.device_id, {
    status: record.alert_level === 'DANGER' || record.status === 'DANGER' ? 'DANGER' : 'ONLINE',
    last_seen: record.timestamp,
    last_heartbeat: record.timestamp,
    firmware_version: record.firmware_version,
    last_water_level_mm: record.water_level_mm,
    last_flood_state: record.flood_state,
    last_primary_sensor_status: record.primary_sensor_status,
    last_sensor_logic_mode: record.sensor_logic_mode,
    last_sensor_mode: record.sensor_mode,
    last_sensor_valid: record.sensor_valid,
    last_sensor_detected: record.sensor_detected,
    last_local_ip: record.local_ip,
    last_api_server: record.api_server,
    last_mqtt_server: record.mqtt_server,
    last_mqtt_connected: record.mqtt_connected,
    last_wifi_connected: record.wifi_connected,
    last_wifi_rssi: record.wifi_rssi,
    last_ssid: record.ssid,
    last_ina_status: record.ina_status,
    last_battery_voltage: record.battery_voltage,
    last_battery_ma: record.battery_current_ma,
    last_battery_mw: record.battery_power_mw,
    last_uptime_s: record.uptime_s,
    last_zero_dist_mm: record.zero_dist_mm,
    last_vmon_cal_factor: record.vmon_cal_factor,
    last_remote_left: record.remote_left,
    last_remote_right: record.remote_right,
    last_alert_level: record.alert_level,
    last_alert_status: record.alert_status,
    last_alert_source: record.alert_source,
    last_alert_reason: record.alert_reason,
    last_pending_alert_level: record.pending_alert_level,
    last_current_config_version: record.current_config_version,
    mqtt_topic_base: record.mqtt_topic_base || device.mqtt_topic_base
  });

  if (record.config) {
    syncReportedConfigAndAudit({
      deviceId: record.device_id,
      locationId: record.location_id,
      reportedConfig: record.config,
      reportedVersion: record.current_config_version,
      reportedAt: record.timestamp,
      source: 'telemetry'
    });
  }

  if (record.location_id && (record.alert_level === 'DANGER' || record.status === 'DANGER')) {
    incidentService.openOrUpdateDangerIncident({
      locationId: record.location_id,
      deviceId: record.device_id,
      waterLevel: record.water_level_mm,
      reason: record.alert_reason || 'Danger threshold from telemetry',
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
  const alert = eventAlertSnapshot(event);
  deviceRepository.updateRuntime(event.device_id, {
    last_seen: event.timestamp,
    status: event.event_type === 'DEVICE_OFFLINE' ? 'OFFLINE' : 'ONLINE',
    last_alert_level: alert.alertLevel,
    last_alert_status: alert.alertStatus,
    last_alert_source: alert.alertSource,
    last_alert_reason: alert.reason
  });

  let incident = null;
  if (alert.alertLevel === 'DANGER') {
    incident = incidentService.openOrUpdateDangerIncident({
      locationId: event.location_id,
      deviceId: event.device_id,
      waterLevel: event.water_level_mm,
      reason: alert.reason,
      source: 'event'
    });
    notifyForAlert(event, alert);
  } else if (alert.alertLevel === 'ORANGE') {
    notifyForAlert(event, alert);
  }

  if (event.event_type === 'DANGER_AUTO_CLEARED') {
    incident = incidentService.closeIncidentAuto({
      locationId: event.location_id,
      reason: alert.reason
    });
    notificationService.publishNotification('DANGER_AUTO_CLEARED', event);
  }

  if (event.event_type === 'DEVICE_BOOTED_CONFIG_REPORT' && event.details?.current_config) {
    syncReportedConfigAndAudit({
      deviceId: event.device_id,
      locationId: event.location_id,
      reportedConfig: event.details.current_config,
      reportedVersion: event.current_config_version || event.details.current_config_version || null,
      reportedAt: event.timestamp,
      source: 'boot_report'
    });
    auditService.writeAuditLog({
      locationId: event.location_id,
      eventType: 'DEVICE_BOOTED_CONFIG_REPORT',
      performedBy: event.device_id,
      loginId: event.device_id,
      sessionId: null,
      deviceName: event.device_id,
      ipAddress: null,
      details: {
        current_config_version: event.current_config_version || event.details.current_config_version || null,
        boot_status: event.details.boot_status || event.boot_status || 'BOOTED'
      }
    });
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
        source: alert.reason || event.source || 'device_local_page',
        event
      }
    });
  }

  if (event.event_type === 'NO_SENSOR_MODE_ACTIVE') {
    auditService.writeAuditLog({
      locationId: event.location_id,
      eventType: 'NO_SENSOR_MODE_ACTIVE',
      performedBy: event.device_id,
      loginId: event.device_id,
      sessionId: null,
      deviceName: event.device_id,
      ipAddress: null,
      details: {
        message: alert.reason || 'Automatic alert trigger disabled because no sensor is configured.'
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
    last_mqtt_connected: Boolean(payload.mqtt_connected),
    last_wifi_rssi: Number(payload.wifi_rssi ?? 0),
    last_local_ip: payload.local_ip || null,
    firmware_version: payload.firmware_version || device.firmware_version,
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
      mqtt_connected: payload.mqtt_connected ?? null,
      wifi_rssi: payload.wifi_rssi ?? null,
      local_ip: payload.local_ip || null,
      firmware_version: payload.firmware_version || null,
      internet_available: payload.internet_available ?? null,
      sim_registered: payload.sim_registered ?? null,
      current_config_version: payload.current_config_version ?? null
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
  const config = saved ? shapeConfig(saved) : shapeConfig({
    sensor_mount_height_mm: location.sensor_mount_height_mm,
    alert_level_mm: location.alert_level_mm,
    danger_level_mm: location.danger_level_mm,
    clear_level_mm: location.danger_clear_level_mm,
    rs485_sensor_enabled: true,
    switch_sensor_enabled: true,
    switch_level_1_mm: 300,
    switch_level_2_mm: 500,
    trigger_delay_seconds: 60,
    clear_delay_seconds: 300,
    mismatch_duration_seconds: 300,
    config_version: 1,
    state: 'ACTIVE'
  });

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

  const device = deviceRepository.findByLocation(locationId);
  const telemetryItems = telemetryRepository
    .listByLocation(locationId)
    .filter((item) => item.type === 'TELEMETRY')
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  const heartbeatItems = telemetryRepository
    .listByLocation(locationId)
    .filter((item) => item.type === 'HEARTBEAT')
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  const latest = shapeTelemetry(telemetryItems[0] || null);
  const heartbeat = heartbeatItems[0] || null;
  const savedConfig = device ? deviceConfigRepository.getCurrentByDevice(device._id) : null;
  const config = savedConfig
    ? shapeConfig(savedConfig)
    : shapeConfig({
        alert_level_mm: location.alert_level_mm,
        danger_level_mm: location.danger_level_mm,
        clear_level_mm: location.danger_clear_level_mm,
        sensor_mount_height_mm: location.sensor_mount_height_mm,
        rs485_sensor_enabled: true,
        switch_sensor_enabled: true,
        switch_level_1_mm: 300,
        switch_level_2_mm: 500,
        trigger_delay_seconds: 60,
        clear_delay_seconds: 300,
        mismatch_duration_seconds: 300,
        config_version: 1,
        state: 'ACTIVE'
      });
  const incident = incidentService.getActiveIncident(locationId);
  const deviceStatus = device
    ? ((device.status === 'OFFLINE')
      ? 'OFFLINE'
      : (device.last_seen && (Date.now() - new Date(device.last_seen).getTime()) <= (3 * 60 * 1000) ? device.status || 'ONLINE' : 'OFFLINE'))
    : 'UNMAPPED';

  return {
    location: {
      id: location._id,
      location_id: location._id,
      location_name: location.name,
      description: location.description || '',
      mount_height_mm: location.sensor_mount_height_mm || null,
      device_id: device ? device._id : null,
      device_status: deviceStatus,
      lifecycle_status: device ? (device.operational_status || 'ACTIVE') : 'UNMAPPED',
      lifecycle_note: device ? (device.lifecycle_note || null) : null,
      lifecycle_updated_at: device ? (device.lifecycle_updated_at || null) : null
    },
    device: device ? {
      id: device._id,
      status: deviceStatus,
      lifecycle_status: device.operational_status || 'ACTIVE',
      lifecycle_note: device.lifecycle_note || null,
      lifecycle_updated_at: device.lifecycle_updated_at || null,
      local_ip: device.last_local_ip || null,
      mqtt_connected: device.last_mqtt_connected ?? null,
      wifi_connected: device.last_wifi_connected ?? null,
      wifi_rssi: device.last_wifi_rssi ?? null,
      api_server: device.last_api_server || null,
      mqtt_server: device.last_mqtt_server || null,
      last_seen: device.last_seen || null,
      alert_level: device.last_alert_level || null,
      alert_status: device.last_alert_status || null,
      alert_reason: device.last_alert_reason || null,
      sensor_mode: device.last_sensor_mode || null,
      current_config_version: device.last_current_config_version || null
    } : null,
    latest,
    heartbeat: heartbeat ? {
      received_at: heartbeat.timestamp,
      status: heartbeat.status,
      online: heartbeat.online,
      details: heartbeat.details
    } : null,
    config,
    incident,
    sample_count: telemetryItems.length
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
