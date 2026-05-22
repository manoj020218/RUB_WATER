const { v4: uuidv4 } = require('uuid');
const { badRequest } = require('../utils/errors');
const { nowIso } = require('../utils/time');

const COMPLAINT_STATUS = {
  OPEN: 'OPEN',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  ASSIGNED: 'ASSIGNED',
  IN_PROGRESS: 'IN_PROGRESS',
  RESOLVED: 'RESOLVED',
  REJECTED: 'REJECTED',
  CLOSED: 'CLOSED'
};

const COMPLAINT_PRIORITY = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL'
};

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizePriority(value) {
  const next = normalizeText(value).toUpperCase();
  if (!next || !COMPLAINT_PRIORITY[next]) {
    return COMPLAINT_PRIORITY.MEDIUM;
  }
  return next;
}

function normalizeStatus(value) {
  const next = normalizeText(value).toUpperCase();
  if (!next || !COMPLAINT_STATUS[next]) {
    return COMPLAINT_STATUS.OPEN;
  }
  return next;
}

function normalizeType(value) {
  const type = normalizeText(value);
  return type || 'Other';
}

function normalizeAttachments(value, actor) {
  if (!Array.isArray(value)) {
    return [];
  }

  const now = nowIso();
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      type: normalizeText(item.type).toUpperCase() || 'IMAGE',
      url: normalizeText(item.url),
      uploaded_at: item.uploaded_at || now,
      uploaded_by_user_id: actor?.user?._id || null,
      uploaded_by_login_id: actor?.user?.login_id || null
    }))
    .filter((item) => item.url.length > 0);
}

function createComplaintRecord({ complaintNo, payload, actor }) {
  if (!payload || typeof payload !== 'object') {
    throw badRequest('Invalid complaint payload');
  }

  const locationId = normalizeText(payload.location_id);
  if (!locationId) {
    throw badRequest('location_id is required');
  }

  const title = normalizeText(payload.title);
  const description = normalizeText(payload.description || payload.remark || payload.note);
  if (!title && !description) {
    throw badRequest('title or description is required');
  }

  const createdAt = nowIso();
  const type = normalizeType(payload.type || payload.complaint_type);
  const priority = normalizePriority(payload.priority);
  const initialStatus = normalizeStatus(payload.status);

  const timeline = [
    {
      action: 'RAISED',
      note: description || title || type,
      status: initialStatus,
      performed_by_user_id: actor?.user?._id || null,
      performed_by_login_id: actor?.user?.login_id || null,
      performed_by_role: actor?.user?.role || null,
      timestamp: createdAt
    }
  ];

  return {
    _id: `cmp_${uuidv4().replace(/-/g, '').slice(0, 12)}`,
    complaint_no: complaintNo,
    location_id: locationId,
    device_id: normalizeText(payload.device_id) || null,
    type,
    priority,
    title: title || type,
    description: description || null,
    status: initialStatus,
    raised_by_user_id: actor?.user?._id || null,
    raised_by_login_id: actor?.user?.login_id || null,
    raised_by_role: actor?.user?.role || null,
    raised_from_session_id: actor?.session?._id || null,
    raised_from_device_name: actor?.session?.device_name || null,
    assigned_to_user_id: null,
    assigned_to_login_id: null,
    assigned_to_role: null,
    attachments: normalizeAttachments(payload.attachments, actor),
    timeline,
    created_at: createdAt,
    updated_at: createdAt,
    acknowledged_at: null,
    resolved_at: null,
    closed_at: null
  };
}

module.exports = {
  COMPLAINT_STATUS,
  COMPLAINT_PRIORITY,
  createComplaintRecord,
  normalizeStatus,
  normalizePriority,
  normalizeType
};
