const { v4: uuidv4 } = require('uuid');
const deviceRepository = require('../repositories/deviceRepository');
const locationRepository = require('../repositories/locationRepository');
const deviceActionSheetRepository = require('../repositories/deviceActionSheetRepository');
const { badRequest, forbidden, notFound } = require('../utils/errors');
const { assertPermission } = require('./rbacService');
const auditService = require('./auditService');
const { publishDeviceMessage } = require('../mqtt/outboundPublisher');
const { publishRealtime } = require('./realtimeBus');

const RELAY_NAMES = ['Siren', 'Flash', 'Voice Trigger'];
const LEVELS = ['ORANGE', 'RED'];
const MODES = new Set(['OFF', 'CONTINUOUS_ON', 'PULSE_REPEAT']);

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

function toInt(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : fallback;
}

function toBool(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1' || value === 1) return true;
  if (value === 'false' || value === '0' || value === 0) return false;
  return fallback;
}

function normalizeMode(value, fallback = 'OFF') {
  const normalized = String(value || fallback).trim().toUpperCase();
  return MODES.has(normalized) ? normalized : fallback;
}

function defaultActions() {
  return [
    { alert_level: 'ORANGE', relay_number: 1, relay_name: 'Siren', enabled: true, mode: 'PULSE_REPEAT', on_time_sec: 10, off_time_sec: 60, repeat_interval_sec: 0, pulse_duration_sec: 0 },
    { alert_level: 'ORANGE', relay_number: 2, relay_name: 'Flash', enabled: true, mode: 'PULSE_REPEAT', on_time_sec: 10, off_time_sec: 60, repeat_interval_sec: 0, pulse_duration_sec: 0 },
    { alert_level: 'ORANGE', relay_number: 3, relay_name: 'Voice Trigger', enabled: true, mode: 'PULSE_REPEAT', on_time_sec: 0, off_time_sec: 0, repeat_interval_sec: 60, pulse_duration_sec: 2 },
    { alert_level: 'RED', relay_number: 1, relay_name: 'Siren', enabled: true, mode: 'CONTINUOUS_ON', on_time_sec: 0, off_time_sec: 0, repeat_interval_sec: 0, pulse_duration_sec: 0 },
    { alert_level: 'RED', relay_number: 2, relay_name: 'Flash', enabled: true, mode: 'CONTINUOUS_ON', on_time_sec: 0, off_time_sec: 0, repeat_interval_sec: 0, pulse_duration_sec: 0 },
    { alert_level: 'RED', relay_number: 3, relay_name: 'Voice Trigger', enabled: true, mode: 'PULSE_REPEAT', on_time_sec: 0, off_time_sec: 0, repeat_interval_sec: 15, pulse_duration_sec: 2 }
  ];
}

function actionKey(alertLevel, relayNumber) {
  return `${String(alertLevel || '').trim().toUpperCase()}_${Number(relayNumber)}`;
}

function normalizeActions(input, baseActions = defaultActions()) {
  const map = new Map();
  baseActions.forEach((item) => {
    map.set(actionKey(item.alert_level, item.relay_number), {
      alert_level: String(item.alert_level).trim().toUpperCase(),
      relay_number: Number(item.relay_number),
      relay_name: item.relay_name || RELAY_NAMES[Number(item.relay_number) - 1] || 'Relay',
      enabled: Boolean(item.enabled),
      mode: normalizeMode(item.mode),
      on_time_sec: toInt(item.on_time_sec),
      off_time_sec: toInt(item.off_time_sec),
      repeat_interval_sec: toInt(item.repeat_interval_sec),
      pulse_duration_sec: toInt(item.pulse_duration_sec)
    });
  });

  const source = Array.isArray(input?.actions)
    ? input.actions
    : Array.isArray(input)
      ? input
      : [];

  source.forEach((raw) => {
    const alertLevel = String(raw?.alert_level || raw?.level || '').trim().toUpperCase();
    const relayNumber = Number(raw?.relay_number || raw?.relay || raw?.index || 0);
    if (!LEVELS.includes(alertLevel) || relayNumber < 1 || relayNumber > 3) {
      return;
    }
    map.set(actionKey(alertLevel, relayNumber), {
      alert_level: alertLevel,
      relay_number: relayNumber,
      relay_name: raw?.relay_name || RELAY_NAMES[relayNumber - 1],
      enabled: toBool(raw?.enabled, false),
      mode: normalizeMode(raw?.mode),
      on_time_sec: toInt(raw?.on_time_sec),
      off_time_sec: toInt(raw?.off_time_sec),
      repeat_interval_sec: toInt(raw?.repeat_interval_sec),
      pulse_duration_sec: toInt(raw?.pulse_duration_sec)
    });
  });

  return defaultActions()
    .map((item) => map.get(actionKey(item.alert_level, item.relay_number)))
    .filter(Boolean);
}

function stableSheetShape(sheet) {
  return {
    action_sheet_version: Number(sheet.action_sheet_version || sheet.current_action_sheet_version || 0) || 0,
    red_all_off_override: Boolean(sheet.red_all_off_override),
    actions: normalizeActions(sheet, sheet.actions || defaultActions())
  };
}

function sameSheet(left, right) {
  return JSON.stringify(stableSheetShape(left)) === JSON.stringify(stableSheetShape(right));
}

function validateSheet(sheet, { allowRedOverride = false } = {}) {
  const normalized = stableSheetShape(sheet);
  normalized.actions.forEach((action) => {
    if (!LEVELS.includes(action.alert_level)) {
      throw badRequest('Invalid alert_level in action sheet');
    }
    if (action.relay_number < 1 || action.relay_number > 3) {
      throw badRequest('Invalid relay_number in action sheet');
    }
    if (!MODES.has(action.mode)) {
      throw badRequest('Invalid mode in action sheet');
    }
    if (action.mode !== 'PULSE_REPEAT' || !action.enabled) {
      return;
    }
    const hasOnOffPattern = action.on_time_sec > 0 || action.off_time_sec > 0;
    if (hasOnOffPattern) {
      if (action.on_time_sec <= 0 || action.off_time_sec <= 0) {
        throw badRequest(`${action.alert_level} R${action.relay_number} requires both on_time_sec and off_time_sec for pulse-repeat mode`);
      }
      return;
    }
    if (action.pulse_duration_sec <= 0 || action.repeat_interval_sec <= action.pulse_duration_sec) {
      throw badRequest(`${action.alert_level} R${action.relay_number} requires repeat_interval_sec greater than pulse_duration_sec`);
    }
  });

  const redActions = normalized.actions.filter((item) => item.alert_level === 'RED');
  const redAllOff = redActions.every((item) => !item.enabled || item.mode === 'OFF');
  if (redAllOff && !(allowRedOverride && normalized.red_all_off_override)) {
    throw badRequest('RED danger action cannot disable all three relays unless vendor-super-admin override is enabled');
  }

  return normalized;
}

function shapeResponse(record) {
  const normalized = stableSheetShape(record);
  return {
    ...record,
    action_sheet_version: normalized.action_sheet_version,
    current_action_sheet_version: normalized.action_sheet_version,
    version: normalized.action_sheet_version,
    red_all_off_override: normalized.red_all_off_override,
    actions: normalized.actions,
    pending_sync: Boolean(record.pending_sync),
    last_sync_at: record.last_sync_at || null,
    last_sync_status: record.last_sync_status || null,
    last_sync_message: record.last_sync_message || null,
    last_sync_source: record.last_sync_source || null,
    last_reported_action_sheet_version: record.last_reported_action_sheet_version || null,
    device_reported_at: record.device_reported_at || null,
    device_reported: record.device_reported || null,
    pending_update_id: record.pending_update_id || null,
    state: record.state || 'SYNCED'
  };
}

function fallbackCurrent(device, location) {
  const now = new Date().toISOString();
  return {
    _id: `acts_${device._id}`,
    device_id: device._id,
    location_id: device.location_id,
    action_sheet_version: 1,
    red_all_off_override: false,
    actions: defaultActions(),
    updated_at: now,
    updated_by: null,
    pending_sync: false,
    pending_update_id: null,
    state: 'SYNCED',
    last_sync_at: null,
    last_sync_status: 'SYNCED',
    last_sync_message: 'Using saved/default action sheet',
    last_sync_source: 'FIRMWARE_DEFAULT',
    last_reported_action_sheet_version: null,
    device_reported_at: null,
    device_reported: null,
    location_name: location?.name || null
  };
}

function resolveCurrent(deviceId) {
  const device = deviceRepository.findById(deviceId);
  if (!device) {
    throw notFound('Device not found');
  }
  const location = locationRepository.findById(device.location_id);
  if (!location) {
    throw notFound('Location not found');
  }
  const current = deviceActionSheetRepository.getCurrentByDevice(device._id)
    || fallbackCurrent(device, location);
  return { device, location, current };
}

function buildDevicePayload(record, allowRedOverride) {
  return {
    action_sheet_version: Number(record.action_sheet_version || 0),
    current_action_sheet_version: Number(record.action_sheet_version || 0),
    red_all_off_override: Boolean(record.red_all_off_override),
    vendor_super_admin_override: Boolean(allowRedOverride && record.red_all_off_override),
    last_sync_at: record.updated_at || new Date().toISOString(),
    actions: normalizeActions(record, record.actions || defaultActions())
  };
}

function appendHistory({ device, updateId, version, source, requestedBy, requestedAt, oldConfig, newConfig, state = 'PENDING_SYNC' }) {
  return deviceActionSheetRepository.appendHistory({
    _id: `action_hist_${uuidv4().replace(/-/g, '').slice(0, 12)}`,
    device_id: device._id,
    location_id: device.location_id,
    update_id: updateId,
    action_sheet_version: version,
    source,
    requested_by: requestedBy,
    requested_at: requestedAt,
    old_config: oldConfig,
    new_config: newConfig,
    state,
    sync: null
  });
}

function auditActionSheetChange({ device, user, updateId, oldConfig, newConfig, source, ipAddress }) {
  auditService.writeAuditLog({
    locationId: device.location_id,
    eventType: 'DEVICE_ACTION_SHEET_UPDATED',
    performedBy: user?._id || device._id,
    loginId: user?.login_id || device._id,
    sessionId: null,
    deviceName: device._id,
    ipAddress: ipAddress || null,
    details: {
      update_id: updateId,
      source,
      user_id: user?._id || null,
      old_config: stableSheetShape(oldConfig),
      new_config: stableSheetShape(newConfig)
    }
  });
}

function getDeviceActionSheet({ deviceId, authContext }) {
  const { device, current } = resolveCurrent(deviceId);
  if (authContext?.user) {
    assertUserLocationAccess(authContext.user, device.location_id);
  }
  return shapeResponse(current);
}

function putDeviceActionSheet({ deviceId, payload, authContext, ipAddress }) {
  const { device, current } = resolveCurrent(deviceId);
  assertPermission(authContext.user.role, 'MANAGE_DEVICE_CONFIG');
  assertUserLocationAccess(authContext.user, device.location_id);

  const allowRedOverride = authContext.user.role === 'VENDOR_SUPER_ADMIN';
  const nextShape = validateSheet({
    ...current,
    ...payload,
    actions: normalizeActions(payload, current.actions || defaultActions()),
    red_all_off_override: payload.red_all_off_override !== undefined
      ? toBool(payload.red_all_off_override, false)
      : Boolean(current.red_all_off_override)
  }, { allowRedOverride });

  const now = new Date().toISOString();
  const version = Number(current.action_sheet_version || 0) + 1;
  const updateId = `actupd_${uuidv4().replace(/-/g, '').slice(0, 12)}`;
  const next = {
    ...current,
    action_sheet_version: version,
    red_all_off_override: nextShape.red_all_off_override,
    actions: nextShape.actions,
    updated_at: now,
    updated_by: authContext.user.login_id,
    pending_sync: true,
    pending_update_id: updateId,
    state: 'PENDING_SYNC',
    last_sync_at: current.last_sync_at || null,
    last_sync_status: 'PENDING',
    last_sync_message: 'Awaiting MCU sync confirmation',
    last_sync_source: 'APK',
    device_reported: current.device_reported || null,
    device_reported_at: current.device_reported_at || null
  };

  deviceActionSheetRepository.upsertCurrent(device._id, next);
  appendHistory({
    device,
    updateId,
    version,
    source: 'APK',
    requestedBy: authContext.user.login_id,
    requestedAt: now,
    oldConfig: current,
    newConfig: next,
    state: 'PENDING_SYNC'
  });
  auditActionSheetChange({
    device,
    user: authContext.user,
    updateId,
    oldConfig: current,
    newConfig: next,
    source: 'APK',
    ipAddress
  });

  publishDeviceMessage(device._id, 'config', {
    cmd: 'action_sheet_update',
    source: 'APK',
    update_id: updateId,
    updated_at: now,
    action_sheet: buildDevicePayload(next, allowRedOverride)
  });

  publishRealtime('DEVICE_ACTION_SHEET_UPDATED', {
    device_id: device._id,
    location_id: device.location_id,
    action_sheet_version: version,
    pending_sync: true
  });

  return shapeResponse(next);
}

function pushDeviceActionSheet({ deviceId, authContext, ipAddress }) {
  const { device, current } = resolveCurrent(deviceId);
  assertPermission(authContext.user.role, 'MANAGE_DEVICE_CONFIG');
  assertUserLocationAccess(authContext.user, device.location_id);

  const allowRedOverride = authContext.user.role === 'VENDOR_SUPER_ADMIN';
  const now = new Date().toISOString();
  const updateId = `actupd_${uuidv4().replace(/-/g, '').slice(0, 12)}`;
  const next = {
    ...current,
    pending_sync: true,
    pending_update_id: updateId,
    state: 'PENDING_SYNC',
    updated_at: now,
    updated_by: authContext.user.login_id,
    last_sync_status: 'PENDING',
    last_sync_message: 'Awaiting MCU sync confirmation',
    last_sync_source: 'APK'
  };
  deviceActionSheetRepository.upsertCurrent(device._id, next);
  appendHistory({
    device,
    updateId,
    version: current.action_sheet_version,
    source: 'APK',
    requestedBy: authContext.user.login_id,
    requestedAt: now,
    oldConfig: current,
    newConfig: next,
    state: 'PENDING_SYNC'
  });
  auditActionSheetChange({
    device,
    user: authContext.user,
    updateId,
    oldConfig: current,
    newConfig: next,
    source: 'APK_REPUSH',
    ipAddress
  });

  publishDeviceMessage(device._id, 'config', {
    cmd: 'action_sheet_update',
    source: 'APK',
    update_id: updateId,
    updated_at: now,
    action_sheet: buildDevicePayload(next, allowRedOverride)
  });

  return shapeResponse(next);
}

function listDeviceActionSheetHistory({ deviceId, authContext }) {
  const { device } = resolveCurrent(deviceId);
  assertUserLocationAccess(authContext.user, device.location_id);
  return deviceActionSheetRepository.listHistoryByDevice(device._id).map((entry) => ({
    ...entry,
    version: entry.action_sheet_version,
    action_sheet_version: entry.action_sheet_version,
    current_action_sheet_version: entry.action_sheet_version
  }));
}

function syncReportedActionSheet({
  deviceId,
  locationId,
  reportedSheet = null,
  reportedVersion = null,
  reportedAt = null,
  source = 'device',
  status = 'SUCCESS',
  reason = null,
  updateId = null
}) {
  const device = deviceRepository.findById(deviceId);
  if (!device || !locationId) {
    return null;
  }

  const current = deviceActionSheetRepository.getCurrentByDevice(device._id)
    || fallbackCurrent(device, locationRepository.findById(locationId));
  const now = reportedAt || new Date().toISOString();
  const version = Number(reportedVersion || reportedSheet?.action_sheet_version || reportedSheet?.current_action_sheet_version || 0);
  const normalizedReported = reportedSheet ? validateSheet({
    ...current,
    ...reportedSheet,
    actions: normalizeActions(reportedSheet, current.actions || defaultActions()),
    red_all_off_override: reportedSheet.red_all_off_override !== undefined
      ? toBool(reportedSheet.red_all_off_override, false)
      : Boolean(current.red_all_off_override)
  }, { allowRedOverride: true }) : null;

  if (String(status || 'SUCCESS').toUpperCase() !== 'SUCCESS') {
    const failed = {
      ...current,
      pending_sync: false,
      state: 'FAILED',
      last_sync_at: now,
      last_sync_status: 'FAILED',
      last_sync_message: reason || 'Device rejected action sheet update',
      last_sync_source: source,
      pending_update_id: null
    };
    deviceActionSheetRepository.upsertCurrent(device._id, failed);
    const history = updateId
      ? deviceActionSheetRepository.findHistoryByUpdateId(updateId)
      : (current.pending_update_id ? deviceActionSheetRepository.findHistoryByUpdateId(current.pending_update_id) : null);
    if (history) {
      deviceActionSheetRepository.updateHistoryEntry(history._id, {
        state: 'FAILED',
        sync: { status: 'FAILED', at: now, source, reason }
      });
    }
    return failed;
  }

  if (current.pending_sync && version >= Number(current.action_sheet_version || 0)) {
    if (normalizedReported && !sameSheet(current, { ...current, actions: normalizedReported.actions, red_all_off_override: normalizedReported.red_all_off_override })) {
      const failed = {
        ...current,
        pending_sync: false,
        state: 'FAILED',
        last_sync_at: now,
        last_sync_status: 'FAILED',
        last_sync_message: 'Reported action sheet does not match the requested sheet',
        last_sync_source: source,
        pending_update_id: null,
        device_reported: reportedSheet,
        device_reported_at: now,
        last_reported_action_sheet_version: version || null
      };
      deviceActionSheetRepository.upsertCurrent(device._id, failed);
      const history = current.pending_update_id
        ? deviceActionSheetRepository.findHistoryByUpdateId(current.pending_update_id)
        : null;
      if (history) {
        deviceActionSheetRepository.updateHistoryEntry(history._id, {
          state: 'FAILED',
          sync: { status: 'FAILED', at: now, source, reason: failed.last_sync_message, reported_version: version || null }
        });
      }
      return failed;
    }

    const synced = {
      ...current,
      actions: normalizedReported ? normalizedReported.actions : current.actions,
      red_all_off_override: normalizedReported ? normalizedReported.red_all_off_override : current.red_all_off_override,
      pending_sync: false,
      state: 'SYNCED',
      last_sync_at: now,
      last_sync_status: 'SYNCED',
      last_sync_message: `MCU synced action sheet from ${source}`,
      last_sync_source: source,
      pending_update_id: null,
      device_reported: reportedSheet || current.device_reported || null,
      device_reported_at: reportedSheet ? now : current.device_reported_at,
      last_reported_action_sheet_version: version || current.last_reported_action_sheet_version || null
    };
    deviceActionSheetRepository.upsertCurrent(device._id, synced);
    const history = updateId
      ? deviceActionSheetRepository.findHistoryByUpdateId(updateId)
      : (current.pending_update_id ? deviceActionSheetRepository.findHistoryByUpdateId(current.pending_update_id) : null);
    if (history) {
      deviceActionSheetRepository.updateHistoryEntry(history._id, {
        state: 'SYNCED',
        sync: { status: 'SYNCED', at: now, source, reported_version: version || null }
      });
    }
    return synced;
  }

  if (normalizedReported && version >= Number(current.action_sheet_version || 0) && !sameSheet(current, {
    ...current,
    action_sheet_version: version || current.action_sheet_version,
    actions: normalizedReported.actions,
    red_all_off_override: normalizedReported.red_all_off_override
  })) {
    const adopted = {
      ...current,
      action_sheet_version: version || Number(current.action_sheet_version || 0) + 1,
      actions: normalizedReported.actions,
      red_all_off_override: normalizedReported.red_all_off_override,
      pending_sync: false,
      pending_update_id: null,
      state: 'SYNCED',
      updated_at: now,
      updated_by: source,
      last_sync_at: now,
      last_sync_status: 'SYNCED',
      last_sync_message: `MCU updated action sheet locally from ${source}`,
      last_sync_source: source,
      device_reported: reportedSheet,
      device_reported_at: now,
      last_reported_action_sheet_version: version || null
    };
    deviceActionSheetRepository.upsertCurrent(device._id, adopted);
    appendHistory({
      device,
      updateId: updateId || `local_${uuidv4().replace(/-/g, '').slice(0, 12)}`,
      version: adopted.action_sheet_version,
      source,
      requestedBy: source,
      requestedAt: now,
      oldConfig: current,
      newConfig: adopted,
      state: 'SYNCED'
    });
    auditService.writeAuditLog({
      locationId: device.location_id,
      eventType: 'DEVICE_ACTION_SHEET_UPDATED_LOCAL',
      performedBy: device._id,
      loginId: device._id,
      sessionId: null,
      deviceName: device._id,
      ipAddress: null,
      details: {
        source,
        old_config: stableSheetShape(current),
        new_config: stableSheetShape(adopted)
      }
    });
    return adopted;
  }

  const heartbeatOnly = {
    ...current,
    last_sync_at: current.last_sync_at || null,
    last_sync_status: current.last_sync_status || 'SYNCED',
    last_sync_source: current.last_sync_source || source,
    last_reported_action_sheet_version: version || current.last_reported_action_sheet_version || null,
    device_reported_at: reportedSheet ? now : current.device_reported_at,
    device_reported: reportedSheet || current.device_reported || null
  };
  deviceActionSheetRepository.upsertCurrent(device._id, heartbeatOnly);
  return heartbeatOnly;
}

function getDeviceActionSheetForSync({ deviceId, currentVersion = 0 }) {
  const { current } = resolveCurrent(deviceId);
  return {
    pending: Number(current.action_sheet_version || 0) > Number(currentVersion || 0),
    action_sheet_version: Number(current.action_sheet_version || 0),
    updated_at: current.updated_at || null,
    action_sheet: buildDevicePayload(current, true)
  };
}

function reportDeviceActionSheet({ deviceId, payload }) {
  const device = deviceRepository.resolveByIdentity({
    deviceId: payload.device_id || deviceId,
    hardwareId: payload.hardware_id || null,
    routeId: deviceId
  });
  if (!device) {
    throw notFound('Device not found');
  }
  const updated = syncReportedActionSheet({
    deviceId: device._id,
    locationId: device.location_id,
    reportedSheet: payload.action_sheet || null,
    reportedVersion: payload.action_sheet_version || payload.current_action_sheet_version || null,
    reportedAt: new Date().toISOString(),
    source: payload.source || 'device_report',
    status: payload.status || 'SUCCESS',
    reason: payload.reason || null,
    updateId: payload.update_id || null
  });
  return shapeResponse(updated || deviceActionSheetRepository.getCurrentByDevice(device._id));
}

module.exports = {
  getDeviceActionSheet,
  putDeviceActionSheet,
  pushDeviceActionSheet,
  listDeviceActionSheetHistory,
  syncReportedActionSheet,
  getDeviceActionSheetForSync,
  reportDeviceActionSheet
};
