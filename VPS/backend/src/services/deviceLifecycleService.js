const { v4: uuidv4 } = require('uuid');
const deviceRepository = require('../repositories/deviceRepository');
const locationRepository = require('../repositories/locationRepository');
const complaintRepository = require('../repositories/complaintRepository');
const deviceLifecycleRepository = require('../repositories/deviceLifecycleRepository');
const { assertPermission } = require('./rbacService');
const { assertUserLocationAccess } = require('./accessService');
const auditService = require('./auditService');
const notificationService = require('./notificationService');
const { publishRealtime } = require('./realtimeBus');
const { badRequest, notFound } = require('../utils/errors');

const DEVICE_OPERATIONAL_STATUS = {
  ACTIVE: 'ACTIVE',
  FAULTY: 'FAULTY',
  UNDER_REPLACEMENT: 'UNDER_REPLACEMENT',
  PENDING_VERIFICATION: 'PENDING_VERIFICATION',
  REPLACED: 'REPLACED',
  DECOMMISSIONED: 'DECOMMISSIONED'
};

const TRANSITIONS = {
  ACTIVE: new Set(['FAULTY', 'UNDER_REPLACEMENT', 'DECOMMISSIONED']),
  FAULTY: new Set(['UNDER_REPLACEMENT', 'PENDING_VERIFICATION', 'ACTIVE', 'DECOMMISSIONED']),
  UNDER_REPLACEMENT: new Set(['PENDING_VERIFICATION', 'REPLACED', 'ACTIVE', 'FAULTY']),
  PENDING_VERIFICATION: new Set(['ACTIVE', 'FAULTY', 'UNDER_REPLACEMENT']),
  REPLACED: new Set(['PENDING_VERIFICATION', 'ACTIVE', 'DECOMMISSIONED']),
  DECOMMISSIONED: new Set(['ACTIVE'])
};

function normalizeStatus(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeReason(value) {
  return String(value || '').trim();
}

function canTransition(fromStatus, toStatus) {
  if (fromStatus === toStatus) {
    return true;
  }
  const allowed = TRANSITIONS[fromStatus];
  if (!allowed) {
    return false;
  }
  return allowed.has(toStatus);
}

function syncLocationMaintenanceFromDevice(locationId, deviceStatus) {
  const activeLifecycleStates = new Set([
    DEVICE_OPERATIONAL_STATUS.FAULTY,
    DEVICE_OPERATIONAL_STATUS.UNDER_REPLACEMENT,
    DEVICE_OPERATIONAL_STATUS.PENDING_VERIFICATION,
    DEVICE_OPERATIONAL_STATUS.REPLACED,
    DEVICE_OPERATIONAL_STATUS.DECOMMISSIONED
  ]);

  if (activeLifecycleStates.has(deviceStatus)) {
    locationRepository.update(locationId, {
      maintenance_status: 'DEVICE_FAULTY',
      updated_at: new Date().toISOString()
    });
    return;
  }

  const openComplaintCount = complaintRepository.countOpenByLocation(locationId);
  locationRepository.update(locationId, {
    maintenance_status: openComplaintCount > 0 ? 'COMPLAINT_OPEN' : 'OK',
    updated_at: new Date().toISOString()
  });
}

function getLifecycleState({ deviceId, authContext }) {
  assertPermission(authContext.user.role, 'VIEW_DASHBOARD');
  const device = deviceRepository.findById(deviceId);
  if (!device) {
    throw notFound('Device not found');
  }
  assertUserLocationAccess(authContext.user, device.location_id);

  return {
    device_id: device._id,
    location_id: device.location_id,
    operational_status: device.operational_status || DEVICE_OPERATIONAL_STATUS.ACTIVE,
    lifecycle_note: device.lifecycle_note || null,
    lifecycle_updated_at: device.lifecycle_updated_at || null
  };
}

function transitionLifecycle({
  deviceId,
  nextStatus,
  reason,
  verificationResult,
  authContext,
  ipAddress
}) {
  assertPermission(authContext.user.role, 'MANAGE_DEVICE_LIFECYCLE');

  const device = deviceRepository.findById(deviceId);
  if (!device) {
    throw notFound('Device not found');
  }
  assertUserLocationAccess(authContext.user, device.location_id);

  const toStatus = normalizeStatus(nextStatus);
  if (!DEVICE_OPERATIONAL_STATUS[toStatus]) {
    throw badRequest('Invalid lifecycle status');
  }
  const fromStatus = normalizeStatus(device.operational_status || DEVICE_OPERATIONAL_STATUS.ACTIVE);
  if (!canTransition(fromStatus, toStatus)) {
    throw badRequest(`Invalid lifecycle transition: ${fromStatus} -> ${toStatus}`);
  }

  const reasonText = normalizeReason(reason);
  if (reasonText.length < 5) {
    throw badRequest('reason is required (minimum 5 characters)');
  }

  const updated = deviceRepository.updateOperationalStatus(device._id, toStatus, reasonText);
  syncLocationMaintenanceFromDevice(device.location_id, toStatus);

  const history = deviceLifecycleRepository.insert({
    _id: `dlh_${uuidv4().replace(/-/g, '').slice(0, 12)}`,
    device_id: device._id,
    location_id: device.location_id,
    previous_status: fromStatus,
    next_status: toStatus,
    reason: reasonText,
    verification_result: verificationResult && typeof verificationResult === 'object' ? verificationResult : null,
    performed_by_user_id: authContext.user._id,
    performed_by_login_id: authContext.user.login_id,
    performed_by_role: authContext.user.role,
    session_id: authContext.session?._id || null,
    timestamp: new Date().toISOString()
  });

  auditService.writeAuditLog({
    locationId: device.location_id,
    eventType: 'DEVICE_LIFECYCLE_CHANGED',
    performedBy: authContext.user._id,
    loginId: authContext.user.login_id,
    sessionId: authContext.session?._id || null,
    deviceName: authContext.session?.device_name || null,
    ipAddress,
    details: {
      device_id: device._id,
      previous_status: fromStatus,
      next_status: toStatus,
      reason: reasonText,
      verification_result: verificationResult && typeof verificationResult === 'object' ? verificationResult : null
    }
  });

  notificationService.publishNotification(
    `DEVICE_${toStatus}`,
    {
      device_id: device._id,
      location_id: device.location_id,
      previous_status: fromStatus,
      next_status: toStatus,
      reason: reasonText
    },
    {
      locationId: device.location_id
    }
  );

  publishRealtime('DEVICE_LIFECYCLE_CHANGED', {
    device_id: device._id,
    location_id: device.location_id,
    previous_status: fromStatus,
    next_status: toStatus,
    reason: reasonText
  });

  return {
    device_id: updated._id,
    location_id: updated.location_id,
    operational_status: updated.operational_status,
    lifecycle_note: updated.lifecycle_note || null,
    lifecycle_updated_at: updated.lifecycle_updated_at || null,
    history
  };
}

function listLifecycleHistory({ deviceId, authContext }) {
  assertPermission(authContext.user.role, 'VIEW_DASHBOARD');
  const device = deviceRepository.findById(deviceId);
  if (!device) {
    throw notFound('Device not found');
  }
  assertUserLocationAccess(authContext.user, device.location_id);

  return deviceLifecycleRepository
    .listByDevice(deviceId)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

module.exports = {
  DEVICE_OPERATIONAL_STATUS,
  getLifecycleState,
  transitionLifecycle,
  listLifecycleHistory
};
