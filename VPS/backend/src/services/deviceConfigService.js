const { v4: uuidv4 } = require('uuid');
const { createCommandRecord } = require('../models/commandModel');
const deviceRepository = require('../repositories/deviceRepository');
const locationRepository = require('../repositories/locationRepository');
const commandRepository = require('../repositories/commandRepository');
const deviceConfigRepository = require('../repositories/deviceConfigRepository');
const telemetryRepository = require('../repositories/telemetryRepository');
const { badRequest, forbidden, notFound } = require('../utils/errors');
const { assertPermission } = require('./rbacService');
const auditService = require('./auditService');
const { publishConfigUpdate } = require('../mqtt/outboundPublisher');

function assertUserLocationAccess(user, locationId) {
  if (!user) {
    throw forbidden('User context missing');
  }

  if (user.role === 'VENDOR_SUPER_ADMIN') {
    return;
  }

  if (!Array.isArray(user.assigned_location_ids) || !user.assigned_location_ids.includes(locationId)) {
    throw forbidden('Location access denied');
  }
}

function toInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

function toBool(value, fallback) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return fallback;
}

function validateConfig(cfg) {
  if (cfg.alert_level_mm <= 0) {
    throw badRequest('alert_level_mm must be greater than 0');
  }
  if (cfg.danger_level_mm <= cfg.alert_level_mm) {
    throw badRequest('danger_level_mm must be greater than alert_level_mm');
  }
  if (cfg.clear_level_mm >= cfg.danger_level_mm) {
    throw badRequest('clear_level_mm must be lower than danger_level_mm');
  }
  if (cfg.trigger_delay_seconds < 10 || cfg.trigger_delay_seconds > 600) {
    throw badRequest('trigger_delay_seconds must be between 10 and 600');
  }
  if (cfg.clear_delay_seconds < 30 || cfg.clear_delay_seconds > 1800) {
    throw badRequest('clear_delay_seconds must be between 30 and 1800');
  }
  if (!cfg.rs485_sensor_enabled && !cfg.switch_sensor_enabled) {
    throw badRequest('At least one sensor input must be enabled');
  }
  if (cfg.sensor_mount_height_mm <= cfg.danger_level_mm) {
    throw badRequest('sensor_mount_height_mm must be greater than danger_level_mm');
  }
}

function fallbackConfigFromLocation(device, location) {
  return {
    _id: `cfg_${device._id}`,
    device_id: device._id,
    location_id: device.location_id,
    alert_level_mm: Number(location.alert_level_mm ?? 200),
    danger_level_mm: Number(location.danger_level_mm ?? 500),
    clear_level_mm: Number(location.danger_clear_level_mm ?? 450),
    trigger_delay_seconds: 60,
    clear_delay_seconds: 300,
    rs485_sensor_enabled: true,
    switch_sensor_enabled: true,
    switch_level_1_mm: 300,
    switch_level_2_mm: 500,
    sensor_mount_height_mm: Number(location.sensor_mount_height_mm ?? 1200),
    mismatch_duration_seconds: 120,
    config_version: 1,
    state: 'ACTIVE',
    last_applied_at: null,
    last_applied_by: null,
    last_ack_at: null,
    last_ack_status: null,
    last_ack_message: null
  };
}

function normalizeConfig(input, base) {
  const src = input || {};
  return {
    alert_level_mm: toInt(src.alert_level_mm, base.alert_level_mm),
    danger_level_mm: toInt(src.danger_level_mm, base.danger_level_mm),
    clear_level_mm: toInt(src.clear_level_mm, base.clear_level_mm),
    trigger_delay_seconds: toInt(src.trigger_delay_seconds, base.trigger_delay_seconds),
    clear_delay_seconds: toInt(src.clear_delay_seconds, base.clear_delay_seconds),
    rs485_sensor_enabled: toBool(src.rs485_sensor_enabled, base.rs485_sensor_enabled),
    switch_sensor_enabled: toBool(src.switch_sensor_enabled, base.switch_sensor_enabled),
    switch_level_1_mm: toInt(src.switch_level_1_mm, base.switch_level_1_mm),
    switch_level_2_mm: toInt(src.switch_level_2_mm, base.switch_level_2_mm),
    sensor_mount_height_mm: toInt(src.sensor_mount_height_mm, base.sensor_mount_height_mm),
    mismatch_duration_seconds: toInt(src.mismatch_duration_seconds, base.mismatch_duration_seconds)
  };
}

function resolveCurrentConfig(deviceId) {
  const device = deviceRepository.findById(deviceId);
  if (!device) {
    throw notFound('Device not found');
  }
  const location = locationRepository.findById(device.location_id);
  if (!location) {
    throw notFound('Location not found');
  }

  const current = deviceConfigRepository.getCurrentByDevice(deviceId)
    || fallbackConfigFromLocation(device, location);
  return { device, location, current };
}

function getDeviceConfig({ deviceId, authContext }) {
  const { device, current } = resolveCurrentConfig(deviceId);
  if (authContext?.user) {
    assertUserLocationAccess(authContext.user, device.location_id);
  }

  const allTelemetry = telemetryRepository.listByDevice(deviceId);
  const latestTelemetry = allTelemetry.length > 0 ? allTelemetry[allTelemetry.length - 1] : null;
  const deviceReported = latestTelemetry?.config ?? null;
  const deviceReportedAt = deviceReported ? (latestTelemetry.timestamp || null) : null;

  return {
    ...current,
    device_reported: deviceReported,
    device_reported_at: deviceReportedAt
  };
}

function queueConfigPush({ device, current, config, requestedBy }) {
  const command = createCommandRecord({
    command: 'UPDATE_CONFIG',
    deviceId: device._id,
    locationId: device.location_id,
    issuedBy: requestedBy,
    payload: {
      command: 'UPDATE_CONFIG',
      config
    },
    expireInSeconds: 300
  });

  commandRepository.insert(command);
  return command;
}

function putDeviceConfig({ deviceId, configPayload, authContext, ipAddress }) {
  const { device, current } = resolveCurrentConfig(deviceId);
  assertPermission(authContext.user.role, 'MANAGE_DEVICE_CONFIG');
  assertUserLocationAccess(authContext.user, device.location_id);

  const nextConfig = normalizeConfig(configPayload, current);
  validateConfig(nextConfig);

  const nextVersion = Number(current.config_version || 0) + 1;
  const now = new Date().toISOString();
  const command = queueConfigPush({
    device,
    current,
    config: nextConfig,
    requestedBy: authContext.user.login_id
  });
  publishConfigUpdate(device._id, {
    command_id: command.command_id,
    command: 'UPDATE_CONFIG',
    issued_by: authContext.user.login_id,
    config: nextConfig
  });

  const mergedCurrent = {
    ...current,
    ...nextConfig,
    config_version: nextVersion,
    state: 'PENDING',
    pending_command_id: command.command_id,
    pending_requested_at: now,
    last_applied_by: authContext.user.login_id
  };
  deviceConfigRepository.upsertCurrent(deviceId, mergedCurrent);

  const historyEntry = {
    _id: `cfg_hist_${uuidv4().replace(/-/g, '').slice(0, 12)}`,
    device_id: device._id,
    location_id: device.location_id,
    command_id: command.command_id,
    config_version: nextVersion,
    state: 'PENDING',
    source: 'api_put',
    requested_by: authContext.user.login_id,
    requested_at: now,
    config: nextConfig,
    ack: null
  };
  deviceConfigRepository.appendHistory(historyEntry);

  auditService.writeAuditLog({
    locationId: device.location_id,
    eventType: 'CONFIG_UPDATED',
    performedBy: authContext.user._id,
    loginId: authContext.user.login_id,
    sessionId: authContext.session?._id || null,
    deviceName: device._id,
    ipAddress,
    details: {
      command_id: command.command_id,
      old_config: {
        alert_level_mm: current.alert_level_mm,
        danger_level_mm: current.danger_level_mm,
        clear_level_mm: current.clear_level_mm
      },
      new_config: nextConfig
    }
  });

  auditService.writeAuditLog({
    locationId: device.location_id,
    eventType: 'CONFIG_PENDING_DEVICE_OFFLINE',
    performedBy: authContext.user._id,
    loginId: authContext.user.login_id,
    sessionId: authContext.session?._id || null,
    deviceName: device._id,
    ipAddress,
    details: {
      command_id: command.command_id,
      reason: 'Awaiting MQTT/HTTP device ACK'
    }
  });

  return {
    device_id: device._id,
    location_id: device.location_id,
    command_id: command.command_id,
    status: 'PENDING',
    config_version: nextVersion,
    config: nextConfig
  };
}

function pushDeviceConfig({ deviceId, authContext, ipAddress }) {
  const { device, current } = resolveCurrentConfig(deviceId);
  assertPermission(authContext.user.role, 'MANAGE_DEVICE_CONFIG');
  assertUserLocationAccess(authContext.user, device.location_id);

  const config = normalizeConfig({}, current);
  validateConfig(config);
  const command = queueConfigPush({
    device,
    current,
    config,
    requestedBy: authContext.user.login_id
  });
  publishConfigUpdate(device._id, {
    command_id: command.command_id,
    command: 'UPDATE_CONFIG',
    issued_by: authContext.user.login_id,
    config
  });

  const now = new Date().toISOString();
  const next = {
    ...current,
    state: 'PENDING',
    pending_command_id: command.command_id,
    pending_requested_at: now
  };
  deviceConfigRepository.upsertCurrent(deviceId, next);

  const historyEntry = {
    _id: `cfg_hist_${uuidv4().replace(/-/g, '').slice(0, 12)}`,
    device_id: device._id,
    location_id: device.location_id,
    command_id: command.command_id,
    config_version: current.config_version,
    state: 'PENDING',
    source: 'api_push',
    requested_by: authContext.user.login_id,
    requested_at: now,
    config,
    ack: null
  };
  deviceConfigRepository.appendHistory(historyEntry);

  auditService.writeAuditLog({
    locationId: device.location_id,
    eventType: 'CONFIG_PENDING_DEVICE_OFFLINE',
    performedBy: authContext.user._id,
    loginId: authContext.user.login_id,
    sessionId: authContext.session?._id || null,
    deviceName: device._id,
    ipAddress,
    details: {
      command_id: command.command_id,
      reason: 'Re-push triggered'
    }
  });

  return {
    device_id: device._id,
    location_id: device.location_id,
    command_id: command.command_id,
    status: 'PENDING',
    config_version: current.config_version,
    config
  };
}

function listDeviceConfigHistory({ deviceId, authContext }) {
  const { device } = resolveCurrentConfig(deviceId);
  assertUserLocationAccess(authContext.user, device.location_id);
  return deviceConfigRepository.listHistoryByDevice(deviceId);
}

function ackDeviceConfig(payload = {}) {
  const commandId = payload.command_id;
  const deviceId = payload.device_id;
  const status = String(payload.status || '').toUpperCase();

  if (!commandId || !deviceId || !status) {
    throw badRequest('command_id, device_id and status are required for config_ack');
  }

  const history = deviceConfigRepository.findHistoryByCommandId(commandId);
  if (!history) {
    throw notFound('Config command not found');
  }

  const current = deviceConfigRepository.getCurrentByDevice(deviceId);
  if (!current) {
    throw notFound('Current device config not found');
  }

  const now = new Date().toISOString();
  const ackMessage = payload.reason || payload.message || null;
  const appliedVersion = Number(payload.applied_config_version || history.config_version || current.config_version);

  if (status === 'SUCCESS') {
    const updatedCurrent = {
      ...current,
      ...history.config,
      config_version: appliedVersion,
      state: 'ACTIVE',
      last_ack_at: now,
      last_ack_status: 'SUCCESS',
      last_ack_message: ackMessage,
      last_applied_at: now,
      pending_command_id: null,
      pending_requested_at: null
    };
    deviceConfigRepository.upsertCurrent(deviceId, updatedCurrent);
    deviceConfigRepository.updateHistoryEntry(history._id, {
      state: 'ACTIVE',
      ack: {
        status: 'SUCCESS',
        at: now,
        message: ackMessage
      }
    });
    commandRepository.updateStatus(commandId, 'SUCCESS', {
      command_id: commandId,
      device_id: deviceId,
      status: 'SUCCESS',
      executed_at: now
    });

    auditService.writeAuditLog({
      locationId: history.location_id,
      eventType: 'CONFIG_ACK_SUCCESS',
      performedBy: deviceId,
      loginId: deviceId,
      sessionId: null,
      deviceName: deviceId,
      ipAddress: null,
      details: {
        command_id: commandId,
        config_version: appliedVersion
      }
    });
  } else {
    const updatedCurrent = {
      ...current,
      state: 'FAILED',
      last_ack_at: now,
      last_ack_status: 'REJECTED',
      last_ack_message: ackMessage,
      pending_command_id: null,
      pending_requested_at: null
    };
    deviceConfigRepository.upsertCurrent(deviceId, updatedCurrent);
    deviceConfigRepository.updateHistoryEntry(history._id, {
      state: 'FAILED',
      ack: {
        status: 'REJECTED',
        at: now,
        message: ackMessage
      }
    });
    commandRepository.updateStatus(commandId, 'REJECTED', {
      command_id: commandId,
      device_id: deviceId,
      status: 'REJECTED',
      executed_at: now
    });

    auditService.writeAuditLog({
      locationId: history.location_id,
      eventType: 'CONFIG_REJECTED_BY_DEVICE',
      performedBy: deviceId,
      loginId: deviceId,
      sessionId: null,
      deviceName: deviceId,
      ipAddress: null,
      details: {
        command_id: commandId,
        reason: ackMessage || 'Rejected by device'
      }
    });
  }

  return {
    command_id: commandId,
    device_id: deviceId,
    status,
    applied_config_version: appliedVersion,
    reason: ackMessage
  };
}

module.exports = {
  getDeviceConfig,
  putDeviceConfig,
  pushDeviceConfig,
  listDeviceConfigHistory,
  ackDeviceConfig
};
