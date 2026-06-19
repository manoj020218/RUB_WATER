const complaintRepository = require('../repositories/complaintRepository');
const locationRepository = require('../repositories/locationRepository');
const deviceRepository = require('../repositories/deviceRepository');
const userRepository = require('../repositories/userRepository');
const auditService = require('./auditService');
const notificationService = require('./notificationService');
const { publishRealtime } = require('./realtimeBus');
const { assertPermission } = require('./rbacService');
const { assertUserLocationAccess } = require('./accessService');
const { badRequest, notFound } = require('../utils/errors');
const {
  COMPLAINT_STATUS,
  createComplaintRecord,
  normalizeStatus
} = require('../models/complaintModel');
const { ROLE } = require('../config/permissions');

const NOTIFICATION_ROLES = [
  ROLE.VENDOR_SUPER_ADMIN,
  ROLE.DEMO_SUPER_ADMIN,
  ROLE.VENDOR_MONITORING_USER,
  ROLE.DEPARTMENT_SUPER_ADMIN,
  ROLE.DEPARTMENT_ADMIN,
  ROLE.LOCATION_ADMIN
];

function nowIso() {
  return new Date().toISOString();
}

function compareByUpdatedDesc(left, right) {
  return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
}

function normalizeNote(value) {
  return String(value || '').trim();
}

function addTimeline(complaint, action, note, authContext, status = null) {
  const entry = {
    action,
    note: normalizeNote(note) || null,
    status: status || complaint.status || null,
    performed_by_user_id: authContext?.user?._id || null,
    performed_by_login_id: authContext?.user?.login_id || null,
    performed_by_role: authContext?.user?.role || null,
    timestamp: nowIso()
  };
  complaintRepository.appendTimeline(complaint._id, entry);
  return entry;
}

function syncLocationMaintenanceStatus(locationId) {
  const openCount = complaintRepository.countOpenByLocation(locationId);
  const status = openCount > 0 ? 'COMPLAINT_OPEN' : 'OK';
  locationRepository.update(locationId, {
    maintenance_status: status,
    updated_at: nowIso()
  });
}

function assertComplaintAccess(complaint, authContext) {
  if (!complaint) {
    throw notFound('Complaint not found');
  }
  assertUserLocationAccess(authContext.user, complaint.location_id);
}

function sanitizeComplaint(complaint) {
  return {
    ...complaint,
    timeline: Array.isArray(complaint.timeline) ? [...complaint.timeline] : [],
    attachments: Array.isArray(complaint.attachments) ? [...complaint.attachments] : []
  };
}

function raiseComplaint({ payload, authContext, ipAddress }) {
  assertPermission(authContext.user.role, 'RAISE_COMPLAINT');

  const locationId = String(payload?.location_id || '').trim();
  const location = locationRepository.findById(locationId);
  if (!location) {
    throw notFound('Location not found');
  }
  assertUserLocationAccess(authContext.user, locationId);

  const deviceId = String(payload?.device_id || '').trim();
  if (deviceId) {
    const device = deviceRepository.findById(deviceId);
    if (!device) {
      throw notFound('Device not found');
    }
    if (device.location_id !== locationId) {
      throw badRequest('device_id does not belong to location_id');
    }
  }

  const complaintNo = complaintRepository.nextComplaintNo();
  const complaint = createComplaintRecord({
    complaintNo,
    payload,
    actor: authContext
  });
  complaintRepository.insert(complaint);
  syncLocationMaintenanceStatus(locationId);

  auditService.writeAuditLog({
    locationId: complaint.location_id,
    eventType: 'COMPLAINT_RAISED',
    performedBy: authContext.user._id,
    loginId: authContext.user.login_id,
    sessionId: authContext.session?._id || null,
    deviceName: authContext.session?.device_name || null,
    ipAddress,
    details: {
      complaint_id: complaint._id,
      complaint_no: complaint.complaint_no,
      complaint_type: complaint.type,
      priority: complaint.priority,
      title: complaint.title,
      status: complaint.status
    }
  });

  notificationService.publishNotification(
    'COMPLAINT_RAISED',
    {
      complaint_id: complaint._id,
      complaint_no: complaint.complaint_no,
      location_id: complaint.location_id,
      device_id: complaint.device_id,
      type: complaint.type,
      priority: complaint.priority,
      title: complaint.title,
      status: complaint.status,
      raised_by: authContext.user.login_id
    },
    {
      locationId: complaint.location_id,
      recipientRoles: NOTIFICATION_ROLES
    }
  );

  publishRealtime('COMPLAINT_UPDATED', {
    location_id: complaint.location_id,
    device_id: complaint.device_id,
    complaint_id: complaint._id,
    complaint_no: complaint.complaint_no,
    status: complaint.status,
    action: 'RAISED'
  });

  return sanitizeComplaint(complaint);
}

function listComplaints({ filters, authContext }) {
  assertPermission(authContext.user.role, 'VIEW_COMPLAINT');

  return complaintRepository
    .list(filters || {})
    .filter((item) => {
      try {
        assertUserLocationAccess(authContext.user, item.location_id);
        return true;
      } catch (error) {
        return false;
      }
    })
    .sort(compareByUpdatedDesc)
    .map((item) => sanitizeComplaint(item));
}

function getComplaint({ complaintId, authContext }) {
  assertPermission(authContext.user.role, 'VIEW_COMPLAINT');
  const complaint = complaintRepository.findById(complaintId);
  assertComplaintAccess(complaint, authContext);
  return sanitizeComplaint(complaint);
}

function acknowledgeComplaint({ complaintId, note, authContext, ipAddress }) {
  assertPermission(authContext.user.role, 'ACKNOWLEDGE_COMPLAINT');
  const complaint = complaintRepository.findById(complaintId);
  assertComplaintAccess(complaint, authContext);

  complaintRepository.update(complaintId, {
    status: COMPLAINT_STATUS.ACKNOWLEDGED,
    acknowledged_at: nowIso(),
    updated_at: nowIso()
  });
  const updated = complaintRepository.findById(complaintId);
  addTimeline(updated, 'ACKNOWLEDGED', note, authContext, COMPLAINT_STATUS.ACKNOWLEDGED);

  auditService.writeAuditLog({
    locationId: updated.location_id,
    eventType: 'COMPLAINT_ACKNOWLEDGED',
    performedBy: authContext.user._id,
    loginId: authContext.user.login_id,
    sessionId: authContext.session?._id || null,
    deviceName: authContext.session?.device_name || null,
    ipAddress,
    details: {
      complaint_id: updated._id,
      complaint_no: updated.complaint_no,
      note: normalizeNote(note) || null
    }
  });

  publishRealtime('COMPLAINT_UPDATED', {
    location_id: updated.location_id,
    device_id: updated.device_id,
    complaint_id: updated._id,
    complaint_no: updated.complaint_no,
    status: updated.status,
    action: 'ACKNOWLEDGED'
  });

  return sanitizeComplaint(updated);
}

function assignComplaint({ complaintId, assignedToUserId, note, authContext, ipAddress }) {
  assertPermission(authContext.user.role, 'ASSIGN_COMPLAINT');
  const complaint = complaintRepository.findById(complaintId);
  assertComplaintAccess(complaint, authContext);

  const assignee = userRepository.findById(String(assignedToUserId || '').trim());
  if (!assignee) {
    throw notFound('Assignee user not found');
  }
  assertUserLocationAccess(assignee, complaint.location_id);

  complaintRepository.update(complaintId, {
    status: COMPLAINT_STATUS.ASSIGNED,
    assigned_to_user_id: assignee._id,
    assigned_to_login_id: assignee.login_id,
    assigned_to_role: assignee.role,
    updated_at: nowIso()
  });
  const updated = complaintRepository.findById(complaintId);
  addTimeline(
    updated,
    'ASSIGNED',
    normalizeNote(note) || `Assigned to ${assignee.login_id}`,
    authContext,
    COMPLAINT_STATUS.ASSIGNED
  );

  auditService.writeAuditLog({
    locationId: updated.location_id,
    eventType: 'COMPLAINT_ASSIGNED',
    performedBy: authContext.user._id,
    loginId: authContext.user.login_id,
    sessionId: authContext.session?._id || null,
    deviceName: authContext.session?.device_name || null,
    ipAddress,
    details: {
      complaint_id: updated._id,
      complaint_no: updated.complaint_no,
      assigned_to_user_id: assignee._id,
      assigned_to_login_id: assignee.login_id,
      note: normalizeNote(note) || null
    }
  });

  notificationService.publishNotification(
    'COMPLAINT_ASSIGNED',
    {
      complaint_id: updated._id,
      complaint_no: updated.complaint_no,
      location_id: updated.location_id,
      assigned_to_user_id: assignee._id,
      assigned_to_login_id: assignee.login_id
    },
    {
      locationId: updated.location_id,
      recipientUserIds: [assignee._id]
    }
  );

  publishRealtime('COMPLAINT_UPDATED', {
    location_id: updated.location_id,
    device_id: updated.device_id,
    complaint_id: updated._id,
    complaint_no: updated.complaint_no,
    status: updated.status,
    action: 'ASSIGNED'
  });

  return sanitizeComplaint(updated);
}

function addComplaintComment({ complaintId, note, authContext, ipAddress }) {
  assertPermission(authContext.user.role, 'UPDATE_COMPLAINT');
  const complaint = complaintRepository.findById(complaintId);
  assertComplaintAccess(complaint, authContext);

  const nextNote = normalizeNote(note);
  if (!nextNote) {
    throw badRequest('note is required');
  }

  const nextStatus = complaint.status === COMPLAINT_STATUS.OPEN
    ? COMPLAINT_STATUS.IN_PROGRESS
    : complaint.status;
  complaintRepository.update(complaintId, {
    status: nextStatus,
    updated_at: nowIso()
  });
  const updated = complaintRepository.findById(complaintId);
  addTimeline(updated, 'COMMENT_ADDED', nextNote, authContext, nextStatus);

  auditService.writeAuditLog({
    locationId: updated.location_id,
    eventType: 'COMPLAINT_COMMENT_ADDED',
    performedBy: authContext.user._id,
    loginId: authContext.user.login_id,
    sessionId: authContext.session?._id || null,
    deviceName: authContext.session?.device_name || null,
    ipAddress,
    details: {
      complaint_id: updated._id,
      complaint_no: updated.complaint_no,
      note: nextNote
    }
  });

  publishRealtime('COMPLAINT_UPDATED', {
    location_id: updated.location_id,
    device_id: updated.device_id,
    complaint_id: updated._id,
    complaint_no: updated.complaint_no,
    status: updated.status,
    action: 'COMMENT_ADDED'
  });

  return sanitizeComplaint(updated);
}

function resolveComplaint({ complaintId, note, authContext, ipAddress }) {
  assertPermission(authContext.user.role, 'RESOLVE_COMPLAINT');
  const complaint = complaintRepository.findById(complaintId);
  assertComplaintAccess(complaint, authContext);

  complaintRepository.update(complaintId, {
    status: COMPLAINT_STATUS.RESOLVED,
    resolved_at: nowIso(),
    updated_at: nowIso()
  });
  const updated = complaintRepository.findById(complaintId);
  addTimeline(
    updated,
    'RESOLVED',
    normalizeNote(note) || 'Marked as resolved',
    authContext,
    COMPLAINT_STATUS.RESOLVED
  );
  syncLocationMaintenanceStatus(updated.location_id);

  auditService.writeAuditLog({
    locationId: updated.location_id,
    eventType: 'COMPLAINT_RESOLVED',
    performedBy: authContext.user._id,
    loginId: authContext.user.login_id,
    sessionId: authContext.session?._id || null,
    deviceName: authContext.session?.device_name || null,
    ipAddress,
    details: {
      complaint_id: updated._id,
      complaint_no: updated.complaint_no,
      note: normalizeNote(note) || null
    }
  });

  notificationService.publishNotification(
    'COMPLAINT_RESOLVED',
    {
      complaint_id: updated._id,
      complaint_no: updated.complaint_no,
      location_id: updated.location_id,
      status: updated.status
    },
    {
      locationId: updated.location_id,
      recipientRoles: NOTIFICATION_ROLES
    }
  );

  publishRealtime('COMPLAINT_UPDATED', {
    location_id: updated.location_id,
    device_id: updated.device_id,
    complaint_id: updated._id,
    complaint_no: updated.complaint_no,
    status: updated.status,
    action: 'RESOLVED'
  });

  return sanitizeComplaint(updated);
}

function closeComplaint({ complaintId, note, authContext, ipAddress }) {
  assertPermission(authContext.user.role, 'CLOSE_COMPLAINT');
  const complaint = complaintRepository.findById(complaintId);
  assertComplaintAccess(complaint, authContext);

  complaintRepository.update(complaintId, {
    status: COMPLAINT_STATUS.CLOSED,
    closed_at: nowIso(),
    updated_at: nowIso()
  });
  const updated = complaintRepository.findById(complaintId);
  addTimeline(
    updated,
    'CLOSED',
    normalizeNote(note) || 'Marked as closed',
    authContext,
    COMPLAINT_STATUS.CLOSED
  );
  syncLocationMaintenanceStatus(updated.location_id);

  auditService.writeAuditLog({
    locationId: updated.location_id,
    eventType: 'COMPLAINT_CLOSED',
    performedBy: authContext.user._id,
    loginId: authContext.user.login_id,
    sessionId: authContext.session?._id || null,
    deviceName: authContext.session?.device_name || null,
    ipAddress,
    details: {
      complaint_id: updated._id,
      complaint_no: updated.complaint_no,
      note: normalizeNote(note) || null
    }
  });

  publishRealtime('COMPLAINT_UPDATED', {
    location_id: updated.location_id,
    device_id: updated.device_id,
    complaint_id: updated._id,
    complaint_no: updated.complaint_no,
    status: updated.status,
    action: 'CLOSED'
  });

  return sanitizeComplaint(updated);
}

module.exports = {
  raiseComplaint,
  listComplaints,
  getComplaint,
  acknowledgeComplaint,
  assignComplaint,
  addComplaintComment,
  resolveComplaint,
  closeComplaint
};
