const commandRepository = require('../repositories/commandRepository');
const deviceRepository = require('../repositories/deviceRepository');
const locationRepository = require('../repositories/locationRepository');
const { createCommandRecord } = require('../models/commandModel');
const { badRequest, forbidden, notFound } = require('../utils/errors');
const { assertPermission } = require('./rbacService');
const auditService = require('./auditService');
const incidentService = require('./incidentService');
const notificationService = require('./notificationService');

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

function resolveDevice(locationId, deviceId) {
  if (deviceId) {
    const device = deviceRepository.findById(deviceId);
    if (!device) {
      throw notFound('Device not found');
    }
    return device;
  }

  const byLocation = deviceRepository.findByLocation(locationId);
  if (!byLocation) {
    throw notFound('No device mapped to location');
  }

  return byLocation;
}

function issueCommand({ command, permissionName, locationId, deviceId, payload, reason, authContext, ipAddress }) {
  if (!locationId) {
    throw badRequest('location_id is required');
  }

  const location = locationRepository.findById(locationId);
  if (!location) {
    throw notFound('Location not found');
  }

  assertPermission(authContext.user.role, permissionName);
  assertUserLocationAccess(authContext.user, locationId);

  const device = resolveDevice(locationId, deviceId);
  const issued = createCommandRecord({
    command,
    deviceId: device._id,
    locationId,
    issuedBy: authContext.user.login_id,
    payload
  });

  commandRepository.insert(issued);

  auditService.writeAuditLog({
    locationId,
    eventType: `${command}_REQUESTED`,
    performedBy: authContext.user._id,
    loginId: authContext.user.login_id,
    sessionId: authContext.session._id,
    deviceName: authContext.session.device_name,
    ipAddress,
    details: {
      command_id: issued.command_id,
      device_id: issued.device_id,
      reason: reason || null,
      payload: payload || {}
    }
  });

  notificationService.publishNotification(`${command}_REQUESTED`, {
    location_id: locationId,
    command_id: issued.command_id,
    by: authContext.user.login_id
  });

  return issued;
}

function issueMuteAlarm({ locationId, deviceId, authContext, ipAddress }) {
  return issueCommand({
    command: 'MUTE_ALARM',
    permissionName: 'MUTE_ALARM',
    locationId,
    deviceId,
    payload: {},
    authContext,
    ipAddress
  });
}

function issueDryRun({ locationId, deviceId, outputs, authContext, ipAddress }) {
  const payload = {
    outputs: Array.isArray(outputs) && outputs.length > 0 ? outputs : ['siren', 'beacon', 'voice']
  };

  return issueCommand({
    command: 'DRY_RUN',
    permissionName: 'DRY_RUN',
    locationId,
    deviceId,
    payload,
    authContext,
    ipAddress
  });
}

function issueForceClear({ locationId, deviceId, reason, authContext, ipAddress }) {
  if (!reason || String(reason).trim().length < 5) {
    throw badRequest('force clear reason is required (minimum 5 characters)');
  }

  const issued = issueCommand({
    command: 'FORCE_CLEAR',
    permissionName: 'FORCE_CLEAR',
    locationId,
    deviceId,
    payload: { reason },
    reason,
    authContext,
    ipAddress
  });

  const incident = incidentService.forceClearIncident({
    locationId,
    reason,
    userId: authContext.user._id
  });

  return {
    command: issued,
    incident
  };
}

function ackCommand({ commandId, payload }) {
  if (!commandId || String(commandId).trim() === '') {
    throw badRequest('command_id is required for command ACK');
  }

  if (!payload || !payload.device_id || !payload.status) {
    throw badRequest('device_id and status are required for command ACK');
  }

  const command = commandRepository.findByCommandId(commandId);
  if (!command) {
    throw notFound('Command not found');
  }

  const ack = {
    command_id: commandId,
    device_id: payload.device_id,
    status: payload.status,
    executed_at: payload.executed_at || new Date().toISOString()
  };

  commandRepository.updateStatus(commandId, payload.status, ack);

  auditService.writeAuditLog({
    locationId: command.location_id,
    eventType: `${command.command}_ACK`,
    performedBy: command.issued_by,
    loginId: command.issued_by,
    sessionId: null,
    deviceName: payload.device_id,
    ipAddress: null,
    details: ack
  });

  return ack;
}

module.exports = {
  issueMuteAlarm,
  issueDryRun,
  issueForceClear,
  ackCommand
};
