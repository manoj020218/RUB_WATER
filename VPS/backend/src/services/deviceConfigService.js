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
const { publishRealtime } = require('./realtimeBus');

const VERIFIABLE_STATES = new Set(['PENDING', 'ACKED', 'REBOOT_PENDING', 'VERIFY_PENDING']);
const CONFIG_COMPARE_KEYS = [
  'alert_level_mm',
  'danger_level_mm',
  'clear_level_mm',
  'trigger_delay_seconds',
  'clear_delay_seconds',
  'rs485_sensor_enabled',
  'switch_sensor_enabled',
  'switch_level_1_mm',
  'switch_level_2_mm',
  'sensor_mount_height_mm',
  'mismatch_duration_seconds',
  'left_remote_enabled',
  'right_remote_enabled',
  'daily_reboot_enabled',
  'daily_reboot_hour',
  'daily_reboot_minute',
  'daily_reboot_time',
  'vmon_cal_factor',
  'left_rtu_slave_id',
  'right_rtu_slave_id',
  'telemetry_idle_interval_seconds'
];

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

function toFloat(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBool(value, fallback) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 'true' || value === '1' || value === 1) {
    return true;
  }
  if (value === 'false' || value === '0' || value === 0) {
    return false;
  }
  return fallback;
}

function toIsoString(value, fallback = null) {
  if (!value) {
    return fallback;
  }
  const asDate = new Date(value);
  return Number.isNaN(asDate.getTime()) ? fallback : asDate.toISOString();
}

function pad2(value) {
  return String(Math.max(0, Number(value || 0))).padStart(2, '0');
}

function sensorLogicModeFromConfig(cfg = {}) {
  if (cfg.rs485_sensor_enabled && cfg.switch_sensor_enabled) return 'DUAL';
  if (cfg.rs485_sensor_enabled) return 'RS485_ONLY';
  if (cfg.switch_sensor_enabled) return 'SWITCH_ONLY';
  return 'NO_SENSOR';
}

function sensorModeFromConfig(cfg = {}) {
  const mode = sensorLogicModeFromConfig(cfg);
  if (mode === 'DUAL') return 'BOTH_ACTIVE';
  if (mode === 'RS485_ONLY') return 'DYP_ONLY';
  return mode;
}

function applySensorLogicMode(next, mode) {
  const normalized = String(mode || '').trim().toUpperCase();
  if (!normalized) {
    return;
  }
  if (normalized === 'DUAL' || normalized === 'BOTH_ACTIVE') {
    next.rs485_sensor_enabled = true;
    next.switch_sensor_enabled = true;
    return;
  }
  if (normalized === 'RS485_ONLY' || normalized === 'DYP_ONLY') {
    next.rs485_sensor_enabled = true;
    next.switch_sensor_enabled = false;
    return;
  }
  if (normalized === 'SWITCH_ONLY') {
    next.rs485_sensor_enabled = false;
    next.switch_sensor_enabled = true;
    return;
  }
  if (normalized === 'NO_SENSOR') {
    next.rs485_sensor_enabled = false;
    next.switch_sensor_enabled = false;
  }
}

function normalizeDailyRebootTime(hour, minute, fallback = '01:00') {
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return fallback;
  }
  return `${pad2(hour)}:${pad2(minute)}`;
}

function normalizeConfigForCompare(input = {}, base = {}) {
  const next = {
    alert_level_mm: toInt(input.alert_level_mm, base.alert_level_mm),
    danger_level_mm: toInt(input.danger_level_mm, base.danger_level_mm),
    clear_level_mm: toInt(input.clear_level_mm ?? input.danger_clear_level_mm, base.clear_level_mm),
    trigger_delay_seconds: toInt(input.trigger_delay_seconds ?? input.trigger_delay_s, base.trigger_delay_seconds),
    clear_delay_seconds: toInt(
      input.clear_delay_seconds ?? input.alarm_clear_delay_seconds ?? input.clear_delay_s,
      base.clear_delay_seconds
    ),
    rs485_sensor_enabled: toBool(input.rs485_sensor_enabled ?? input.rs485_enabled, base.rs485_sensor_enabled),
    switch_sensor_enabled: toBool(input.switch_sensor_enabled ?? input.switch_enabled, base.switch_sensor_enabled),
    switch_level_1_mm: toInt(input.switch_level_1_mm, base.switch_level_1_mm),
    switch_level_2_mm: toInt(input.switch_level_2_mm, base.switch_level_2_mm),
    sensor_mount_height_mm: toInt(
      input.sensor_mount_height_mm ?? input.zero_distance_mm ?? input.zero_dist_mm,
      base.sensor_mount_height_mm
    ),
    mismatch_duration_seconds: toInt(
      input.mismatch_duration_seconds ?? input.sensor_confirmation_wait_sec,
      base.mismatch_duration_seconds
    ),
    left_remote_enabled: toBool(input.left_remote_enabled, base.left_remote_enabled),
    right_remote_enabled: toBool(input.right_remote_enabled, base.right_remote_enabled),
    daily_reboot_enabled: toBool(input.daily_reboot_enabled, base.daily_reboot_enabled),
    daily_reboot_hour: toInt(input.daily_reboot_hour, base.daily_reboot_hour),
    daily_reboot_minute: toInt(input.daily_reboot_minute, base.daily_reboot_minute),
    daily_reboot_time: String(input.daily_reboot_time || base.daily_reboot_time || '01:00'),
    vmon_cal_factor: toFloat(input.vmon_cal_factor, base.vmon_cal_factor),
    left_rtu_slave_id: toInt(input.left_rtu_slave_id, base.left_rtu_slave_id),
    right_rtu_slave_id: toInt(input.right_rtu_slave_id, base.right_rtu_slave_id),
    telemetry_idle_interval_seconds: toInt(
      input.telemetry_idle_interval_seconds,
      base.telemetry_idle_interval_seconds
    )
  };

  applySensorLogicMode(next, input.sensor_mode || input.sensor_logic_mode || input.logic_mode);

  if (input.daily_reboot_time) {
    const [hh, mm] = String(input.daily_reboot_time).split(':').map((part) => Number(part));
    if (Number.isFinite(hh)) next.daily_reboot_hour = hh;
    if (Number.isFinite(mm)) next.daily_reboot_minute = mm;
  }

  next.daily_reboot_time = normalizeDailyRebootTime(
    next.daily_reboot_hour,
    next.daily_reboot_minute,
    next.daily_reboot_time
  );

  return next;
}

function configDiff(expected, actual) {
  return CONFIG_COMPARE_KEYS
    .filter((key) => expected[key] !== actual[key])
    .map((key) => ({
      key,
      expected: expected[key],
      actual: actual[key]
    }));
}

function maybeActivateReplacementHardware({ deviceId, locationId, reportedConfig, source, now }) {
  const device = deviceRepository.findById(deviceId);
  if (!device || !locationId || !reportedConfig || typeof reportedConfig !== 'object') {
    return;
  }

  const currentStatus = String(device.operational_status || 'ACTIVE').toUpperCase();
  if (!['PENDING_VERIFICATION', 'UNDER_REPLACEMENT', 'REPLACED'].includes(currentStatus)) {
    return;
  }

  const currentConfig = deviceConfigRepository.getCurrentByDevice(deviceId);
  if (!currentConfig) {
    return;
  }

  const expected = normalizeConfigForCompare(currentConfig, currentConfig);
  const actual = normalizeConfigForCompare(reportedConfig, currentConfig);
  const diff = configDiff(expected, actual);
  if (diff.length !== 0) {
    return;
  }

  const note = `Replacement hardware verified from ${source}`;
  const updated = deviceRepository.updateOperationalStatus(deviceId, 'ACTIVE', note);
  auditService.writeAuditLog({
    locationId,
    eventType: 'DEVICE_REPLACEMENT_VERIFIED',
    performedBy: deviceId,
    loginId: deviceId,
    sessionId: null,
    deviceName: deviceId,
    ipAddress: null,
    details: {
      previous_status: currentStatus,
      next_status: 'ACTIVE',
      source,
      hardware_id: updated?.hardware_id || device.hardware_id || null,
      verified_at: now
    }
  });
  publishRealtime('DEVICE_LIFECYCLE_CHANGED', {
    device_id: deviceId,
    location_id: locationId,
    previous_status: currentStatus,
    next_status: 'ACTIVE',
    reason: note
  });
}

function shapeConfigResponse(current, deviceReported = null, deviceReportedAt = null) {
  const config = current || {};
  const reported = deviceReported || config.device_reported || null;
  const reportedAt = deviceReportedAt || config.device_reported_at || null;
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
    device_reported: reported,
    device_reported_at: reportedAt,
    reported_at: reportedAt,
    last_ack_at: config.last_ack_at || null,
    last_ack_status: config.last_ack_status || null,
    last_ack_message: config.last_ack_message || null,
    last_verification_status: config.last_verification_status || null,
    last_verification_message: config.last_verification_message || null,
    verified_at: config.verified_at || null,
    pending_command_id: config.pending_command_id || null,
    pending_requested_at: config.pending_requested_at || null,
    last_reported_config_version: config.last_reported_config_version || null,
    reboot_scheduled: Boolean(config.reboot_scheduled),
    state: config.state || 'ACTIVE'
  };
}

function buildDeviceConfigPayload(config, options = {}) {
  return {
    alert_level_mm: config.alert_level_mm,
    danger_level_mm: config.danger_level_mm,
    clear_level_mm: config.clear_level_mm,
    danger_clear_level_mm: config.clear_level_mm,
    trigger_delay_seconds: config.trigger_delay_seconds,
    trigger_delay_s: config.trigger_delay_seconds,
    clear_delay_seconds: config.clear_delay_seconds,
    alarm_clear_delay_seconds: config.clear_delay_seconds,
    clear_delay_s: config.clear_delay_seconds,
    rs485_sensor_enabled: config.rs485_sensor_enabled,
    rs485_enabled: config.rs485_sensor_enabled,
    switch_sensor_enabled: config.switch_sensor_enabled,
    switch_enabled: config.switch_sensor_enabled,
    switch_level_1_mm: config.switch_level_1_mm,
    switch_level_2_mm: config.switch_level_2_mm,
    sensor_mount_height_mm: config.sensor_mount_height_mm,
    zero_distance_mm: config.sensor_mount_height_mm,
    zero_dist_mm: config.sensor_mount_height_mm,
    mismatch_duration_seconds: config.mismatch_duration_seconds,
    sensor_confirmation_wait_sec: config.mismatch_duration_seconds,
    sensor_logic_mode: sensorLogicModeFromConfig(config),
    sensor_mode: sensorModeFromConfig(config),
    left_remote_enabled: config.left_remote_enabled,
    right_remote_enabled: config.right_remote_enabled,
    daily_reboot_enabled: config.daily_reboot_enabled,
    daily_reboot_hour: config.daily_reboot_hour,
    daily_reboot_minute: config.daily_reboot_minute,
    daily_reboot_time: config.daily_reboot_time,
    vmon_cal_factor: config.vmon_cal_factor,
    left_rtu_slave_id: config.left_rtu_slave_id,
    right_rtu_slave_id: config.right_rtu_slave_id,
    telemetry_idle_interval_seconds: config.telemetry_idle_interval_seconds,
    reboot_after_config_update: Boolean(options.rebootAfterConfigUpdate)
  };
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
  if (cfg.rs485_sensor_enabled && cfg.sensor_mount_height_mm <= cfg.danger_level_mm) {
    throw badRequest('sensor_mount_height_mm must be greater than danger_level_mm');
  }
  if (cfg.switch_sensor_enabled && cfg.switch_level_1_mm <= 0) {
    throw badRequest('switch_level_1_mm must be greater than 0');
  }
  if (cfg.switch_sensor_enabled && cfg.switch_level_2_mm <= cfg.switch_level_1_mm) {
    throw badRequest('switch_level_2_mm must be greater than switch_level_1_mm');
  }
  if (cfg.mismatch_duration_seconds < 30 || cfg.mismatch_duration_seconds > 1800) {
    throw badRequest('sensor_confirmation_wait_sec must be between 30 and 1800');
  }
}

function fallbackConfigFromLocation(device, location) {
  return {
    _id: `cfg_${device._id}`,
    device_id: device._id,
    location_id: device.location_id,
    alert_level_mm: Number(location.alert_level_mm ?? 200),
    danger_level_mm: Number(location.danger_level_mm ?? 400),
    clear_level_mm: Number(location.danger_clear_level_mm ?? 350),
    trigger_delay_seconds: 60,
    clear_delay_seconds: 300,
    rs485_sensor_enabled: true,
    switch_sensor_enabled: true,
    switch_level_1_mm: 300,
    switch_level_2_mm: 500,
    sensor_mount_height_mm: Number(location.sensor_mount_height_mm ?? 1200),
    mismatch_duration_seconds: 300,
    left_remote_enabled: true,
    right_remote_enabled: true,
    daily_reboot_enabled: true,
    daily_reboot_hour: 1,
    daily_reboot_minute: 0,
    daily_reboot_time: '01:00',
    vmon_cal_factor: 1,
    left_rtu_slave_id: 1,
    right_rtu_slave_id: 2,
    telemetry_idle_interval_seconds: 180,
    config_version: 1,
    state: 'ACTIVE',
    last_applied_at: null,
    last_applied_by: null,
    last_ack_at: null,
    last_ack_status: null,
    last_ack_message: null,
    last_verification_status: 'VERIFIED',
    last_verification_message: 'Using current saved configuration',
    verified_at: null,
    device_reported: null,
    device_reported_at: null,
    last_reported_config_version: null,
    pending_command_id: null,
    pending_requested_at: null,
    reboot_scheduled: false
  };
}

function normalizeConfig(input, base) {
  return normalizeConfigForCompare(input, base);
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

function latestTelemetryReportedConfig(deviceId) {
  const allTelemetry = telemetryRepository
    .listByDevice(deviceId)
    .filter((item) => item.type === 'TELEMETRY' && item.config);
  const latestTelemetry = allTelemetry.length > 0 ? allTelemetry[allTelemetry.length - 1] : null;
  return latestTelemetry
    ? {
        config: latestTelemetry.config,
        at: latestTelemetry.timestamp || null,
        version: Number(latestTelemetry.current_config_version || latestTelemetry.config?.config_version || 0) || null
      }
    : null;
}

function getDeviceConfig({ deviceId, authContext }) {
  const { device, current } = resolveCurrentConfig(deviceId);
  if (authContext?.user) {
    assertUserLocationAccess(authContext.user, device.location_id);
  }

  const telemetryReported = latestTelemetryReportedConfig(deviceId);
  const deviceReported = current.device_reported || telemetryReported?.config || null;
  const deviceReportedAt = current.device_reported_at || telemetryReported?.at || null;

  return shapeConfigResponse(current, deviceReported, deviceReportedAt);
}

function queueConfigPush({ device, config, requestedBy }) {
  const command = createCommandRecord({
    command: 'UPDATE_CONFIG',
    deviceId: device._id,
    locationId: device.location_id,
    issuedBy: requestedBy,
    payload: {
      command: 'UPDATE_CONFIG',
      cmd: 'config_update',
      config
    },
    expireInSeconds: 300
  });

  commandRepository.insert(command);
  return command;
}

function createHistoryEntry({ device, commandId, version, source, requestedBy, requestedAt, config }) {
  return {
    _id: `cfg_hist_${uuidv4().replace(/-/g, '').slice(0, 12)}`,
    device_id: device._id,
    location_id: device.location_id,
    command_id: commandId,
    config_version: version,
    state: 'PENDING',
    source,
    requested_by: requestedBy,
    requested_at: requestedAt,
    config,
    ack: null,
    verification: null
  };
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
    config: nextConfig,
    requestedBy: authContext.user.login_id
  });
  const devicePayload = buildDeviceConfigPayload(nextConfig, { rebootAfterConfigUpdate: true });
  publishConfigUpdate(device._id, {
    command_id: command.command_id,
    cmd: 'config_update',
    command: 'UPDATE_CONFIG',
    issued_by: authContext.user.login_id,
    source: 'VPS_HTTP',
    config: devicePayload
  });

  const mergedCurrent = {
    ...current,
    ...nextConfig,
    config_version: nextVersion,
    state: 'PENDING',
    pending_command_id: command.command_id,
    pending_requested_at: now,
    last_applied_by: authContext.user.login_id,
    reboot_scheduled: true,
    last_verification_status: 'PENDING',
    last_verification_message: 'Awaiting device ACK for configuration update'
  };
  deviceConfigRepository.upsertCurrent(deviceId, mergedCurrent);

  deviceConfigRepository.appendHistory(createHistoryEntry({
    device,
    commandId: command.command_id,
    version: nextVersion,
    source: 'VPS_HTTP',
    requestedBy: authContext.user.login_id,
    requestedAt: now,
    config: nextConfig
  }));

  auditService.writeAuditLog({
    locationId: device.location_id,
    eventType: 'DEVICE_CONFIG_UPDATE_REQUESTED',
    performedBy: authContext.user._id,
    loginId: authContext.user.login_id,
    sessionId: authContext.session?._id || null,
    deviceName: device._id,
    ipAddress,
    details: {
      command_id: command.command_id,
      requested_config: nextConfig,
      requested_config_version: nextVersion,
      source: 'VPS_HTTP'
    }
  });

  return {
    device_id: device._id,
    location_id: device.location_id,
    command_id: command.command_id,
    status: 'PENDING',
    config_version: nextVersion,
    config: shapeConfigResponse(mergedCurrent)
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
    config,
    requestedBy: authContext.user.login_id
  });
  const devicePayload = buildDeviceConfigPayload(config, { rebootAfterConfigUpdate: true });
  publishConfigUpdate(device._id, {
    command_id: command.command_id,
    cmd: 'config_update',
    command: 'UPDATE_CONFIG',
    issued_by: authContext.user.login_id,
    source: 'VPS_HTTP',
    config: devicePayload
  });

  const now = new Date().toISOString();
  const next = {
    ...current,
    state: 'PENDING',
    pending_command_id: command.command_id,
    pending_requested_at: now,
    reboot_scheduled: true,
    last_verification_status: 'PENDING',
    last_verification_message: 'Awaiting device ACK for configuration re-push'
  };
  deviceConfigRepository.upsertCurrent(deviceId, next);

  deviceConfigRepository.appendHistory(createHistoryEntry({
    device,
    commandId: command.command_id,
    version: current.config_version,
    source: 'VPS_HTTP',
    requestedBy: authContext.user.login_id,
    requestedAt: now,
    config
  }));

  auditService.writeAuditLog({
    locationId: device.location_id,
    eventType: 'DEVICE_CONFIG_UPDATE_REQUESTED',
    performedBy: authContext.user._id,
    loginId: authContext.user.login_id,
    sessionId: authContext.session?._id || null,
    deviceName: device._id,
    ipAddress,
    details: {
      command_id: command.command_id,
      requested_config: config,
      requested_config_version: current.config_version,
      source: 'VPS_HTTP',
      mode: 'repush'
    }
  });

  return {
    device_id: device._id,
    location_id: device.location_id,
    command_id: command.command_id,
    status: 'PENDING',
    config_version: current.config_version,
    config: shapeConfigResponse(next)
  };
}

function listDeviceConfigHistory({ deviceId, authContext }) {
  const { device } = resolveCurrentConfig(deviceId);
  assertUserLocationAccess(authContext.user, device.location_id);
  return deviceConfigRepository.listHistoryByDevice(deviceId).map((entry) => {
    const shaped = shapeConfigResponse({
      device_id: entry.device_id,
      location_id: entry.location_id,
      ...entry.config,
      config_version: entry.config_version,
      state: entry.state,
      last_ack_at: entry.ack?.at || null,
      last_ack_status: entry.ack?.status || null,
      last_ack_message: entry.ack?.message || null,
      last_verification_status: entry.verification?.status || null,
      last_verification_message: entry.verification?.message || null,
      verified_at: entry.verification?.at || null,
      last_reported_config_version: entry.verification?.reported_config_version || null,
      device_reported: entry.verification?.actual_config || null,
      device_reported_at: entry.verification?.at || null
    });
    return {
      ...shaped,
      version: entry.config_version,
      reported_at: entry.verification?.at || entry.ack?.at || entry.requested_at || null,
      state: entry.state,
      command_id: entry.command_id,
      ack: entry.ack || null,
      verification: entry.verification || null
    };
  });
}

function markVerificationFailure({ current, history, deviceId, locationId, now, source, reportedVersion, expected, actual, diff, message }) {
  const updatedCurrent = {
    ...current,
    state: 'FAILED',
    pending_command_id: null,
    pending_requested_at: null,
    reboot_scheduled: false,
    last_verification_status: 'FAILED',
    last_verification_message: message,
    verified_at: now
  };
  deviceConfigRepository.upsertCurrent(deviceId, updatedCurrent);
  deviceConfigRepository.updateHistoryEntry(history._id, {
    state: 'FAILED',
    verification: {
      status: 'FAILED',
      at: now,
      source,
      reported_config_version: reportedVersion || null,
      message,
      expected_config: expected,
      actual_config: actual,
      diff
    }
  });
  commandRepository.updateStatus(history.command_id, 'FAILED', {
    command_id: history.command_id,
    device_id: deviceId,
    status: 'FAILED',
    verified_at: now,
    source
  });
  auditService.writeAuditLog({
    locationId,
    eventType: 'DEVICE_CONFIG_UPDATE_FAILED',
    performedBy: deviceId,
    loginId: deviceId,
    sessionId: null,
    deviceName: deviceId,
    ipAddress: null,
    details: {
      command_id: history.command_id,
      source,
      requested_config: expected,
      actual_config_after_reboot: actual,
      diff,
      reported_config_version: reportedVersion || null
    }
  });
  return updatedCurrent;
}

function markVerificationSuccess({ current, history, deviceId, locationId, now, source, reportedVersion, applied }) {
  const updatedCurrent = {
    ...current,
    ...history.config,
    config_version: history.config_version,
    state: 'VERIFIED',
    pending_command_id: null,
    pending_requested_at: null,
    reboot_scheduled: false,
    last_verification_status: 'VERIFIED',
    last_verification_message: `Configuration verified from ${source}`,
    verified_at: now,
    last_applied_at: now
  };
  deviceConfigRepository.upsertCurrent(deviceId, updatedCurrent);
  deviceConfigRepository.updateHistoryEntry(history._id, {
    state: 'VERIFIED',
    verification: {
      status: 'VERIFIED',
      at: now,
      source,
      reported_config_version: reportedVersion || null,
      message: `Configuration verified from ${source}`,
      actual_config: applied
    }
  });
  commandRepository.updateStatus(history.command_id, 'SUCCESS', {
    command_id: history.command_id,
    device_id: deviceId,
    status: 'SUCCESS',
    verified_at: now,
    source
  });
  auditService.writeAuditLog({
    locationId,
    eventType: 'DEVICE_CONFIG_UPDATE_VERIFIED',
    performedBy: deviceId,
    loginId: deviceId,
    sessionId: null,
    deviceName: deviceId,
    ipAddress: null,
    details: {
      command_id: history.command_id,
      source,
      applied_config: applied,
      reported_config_version: reportedVersion || null
    }
  });
  return updatedCurrent;
}

function syncDeviceReportedConfig({
  deviceId,
  locationId,
  reportedConfig,
  reportedVersion,
  reportedAt,
  source = 'telemetry'
}) {
  if (!deviceId || !reportedConfig || typeof reportedConfig !== 'object') {
    return null;
  }

  const current = deviceConfigRepository.getCurrentByDevice(deviceId);
  if (!current) {
    return null;
  }

  const now = toIsoString(reportedAt, new Date().toISOString()) || new Date().toISOString();
  const normalizedReported = normalizeConfigForCompare(reportedConfig, current);
  const version = Number.isFinite(Number(reportedVersion)) ? Number(reportedVersion) : null;
  const updatedBase = {
    ...current,
    device_reported: reportedConfig,
    device_reported_at: now,
    last_reported_config_version: version,
    last_report_source: source
  };
  deviceConfigRepository.upsertCurrent(deviceId, updatedBase);

  const history = current.pending_command_id
    ? deviceConfigRepository.findHistoryByCommandId(current.pending_command_id)
    : null;

  if (!history || !VERIFIABLE_STATES.has(String(current.state || '').toUpperCase())) {
    maybeActivateReplacementHardware({
      deviceId,
      locationId,
      reportedConfig,
      source,
      now
    });
    return updatedBase;
  }

  const expected = normalizeConfigForCompare(history.config, current);
  const diff = configDiff(expected, normalizedReported);
  const expectedVersion = Number(history.config_version || current.config_version || 0);
  const versionReady = expectedVersion <= 0 || (version !== null && version >= expectedVersion);

  if (diff.length === 0 && versionReady) {
    const verified = markVerificationSuccess({
      current: updatedBase,
      history,
      deviceId,
      locationId,
      now,
      source,
      reportedVersion: version,
      applied: normalizedReported
    });
    maybeActivateReplacementHardware({
      deviceId,
      locationId,
      reportedConfig,
      source,
      now
    });
    return verified;
  }

  if (versionReady) {
    return markVerificationFailure({
      current: updatedBase,
      history,
      deviceId,
      locationId,
      now,
      source,
      reportedVersion: version,
      expected,
      actual: normalizedReported,
      diff,
      message: 'Configuration update not verified. Device reported values differ from the requested configuration.'
    });
  }

  const waitingCurrent = {
    ...updatedBase,
    state: 'VERIFY_PENDING',
    last_verification_status: 'VERIFY_PENDING',
    last_verification_message: 'Awaiting rebooted device configuration report for verification'
  };
  deviceConfigRepository.upsertCurrent(deviceId, waitingCurrent);
  deviceConfigRepository.updateHistoryEntry(history._id, {
    state: 'VERIFY_PENDING',
    verification: {
      status: 'VERIFY_PENDING',
      at: now,
      source,
      reported_config_version: version || null,
      message: 'Awaiting rebooted device configuration report for verification'
    }
  });
  return waitingCurrent;
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
  const appliedVersion = Number(
    payload.applied_config_version
    || payload.current_config_version
    || history.config_version
    || current.config_version
  );
  const rebootScheduled = Boolean(payload.reboot_scheduled || payload.reboot_after_config_update);

  if (status === 'SUCCESS') {
    const updatedCurrent = {
      ...current,
      ...history.config,
      config_version: appliedVersion,
      state: rebootScheduled ? 'REBOOT_PENDING' : 'ACTIVE',
      last_ack_at: now,
      last_ack_status: 'SUCCESS',
      last_ack_message: ackMessage,
      last_applied_at: now,
      pending_command_id: rebootScheduled ? commandId : null,
      pending_requested_at: rebootScheduled ? current.pending_requested_at : null,
      reboot_scheduled: rebootScheduled,
      last_verification_status: rebootScheduled ? 'WAITING_FOR_REBOOT' : 'VERIFIED',
      last_verification_message: rebootScheduled
        ? 'Device acknowledged config update and scheduled reboot'
        : 'Device acknowledged config update'
    };
    deviceConfigRepository.upsertCurrent(deviceId, updatedCurrent);
    deviceConfigRepository.updateHistoryEntry(history._id, {
      state: rebootScheduled ? 'REBOOT_PENDING' : 'ACTIVE',
      ack: {
        status: 'SUCCESS',
        at: now,
        message: ackMessage,
        reboot_scheduled: rebootScheduled,
        current_config_version: appliedVersion
      }
    });
    commandRepository.updateStatus(commandId, 'SUCCESS', {
      command_id: commandId,
      device_id: deviceId,
      status: 'SUCCESS',
      executed_at: now,
      reboot_scheduled: rebootScheduled
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
        config_version: appliedVersion,
        reboot_scheduled: rebootScheduled
      }
    });

    if (!rebootScheduled && payload.current_config && typeof payload.current_config === 'object') {
      syncDeviceReportedConfig({
        deviceId,
        locationId: history.location_id,
        reportedConfig: payload.current_config,
        reportedVersion: payload.current_config_version || appliedVersion,
        reportedAt: now,
        source: 'config_ack'
      });
    }
  } else {
    const updatedCurrent = {
      ...current,
      state: 'FAILED',
      last_ack_at: now,
      last_ack_status: 'REJECTED',
      last_ack_message: ackMessage,
      pending_command_id: null,
      pending_requested_at: null,
      reboot_scheduled: false,
      last_verification_status: 'FAILED',
      last_verification_message: ackMessage || 'Rejected by device'
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
    reboot_scheduled: rebootScheduled,
    reason: ackMessage
  };
}

module.exports = {
  getDeviceConfig,
  putDeviceConfig,
  pushDeviceConfig,
  listDeviceConfigHistory,
  ackDeviceConfig,
  syncDeviceReportedConfig,
  normalizeConfigForCompare,
  sensorLogicModeFromConfig,
  sensorModeFromConfig
};
