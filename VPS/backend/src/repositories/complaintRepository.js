const { dataStore } = require('../db/datastore');

function insert(complaint) {
  dataStore.complaints.push(complaint);
  return complaint;
}

function findById(complaintId) {
  return dataStore.complaints.find((item) => item._id === complaintId) || null;
}

function list(filters = {}) {
  const locationId = String(filters.location_id || '').trim();
  const deviceId = String(filters.device_id || '').trim();
  const status = String(filters.status || '').trim().toUpperCase();
  const assignedToUserId = String(filters.assigned_to_user_id || '').trim();
  const raisedByUserId = String(filters.raised_by_user_id || '').trim();

  return dataStore.complaints.filter((item) => {
    if (locationId && item.location_id !== locationId) {
      return false;
    }
    if (deviceId && item.device_id !== deviceId) {
      return false;
    }
    if (status && item.status !== status) {
      return false;
    }
    if (assignedToUserId && item.assigned_to_user_id !== assignedToUserId) {
      return false;
    }
    if (raisedByUserId && item.raised_by_user_id !== raisedByUserId) {
      return false;
    }
    return true;
  });
}

function update(complaintId, patch) {
  const complaint = findById(complaintId);
  if (!complaint) {
    return null;
  }
  Object.assign(complaint, patch || {});
  return complaint;
}

function appendTimeline(complaintId, entry) {
  const complaint = findById(complaintId);
  if (!complaint) {
    return null;
  }

  if (!Array.isArray(complaint.timeline)) {
    complaint.timeline = [];
  }
  complaint.timeline.push(entry);
  return complaint;
}

function countOpenByLocation(locationId) {
  return dataStore.complaints.filter((item) => {
    if (item.location_id !== locationId) {
      return false;
    }
    return !['RESOLVED', 'CLOSED', 'REJECTED'].includes(String(item.status || '').toUpperCase());
  }).length;
}

function nextComplaintNo(now = new Date()) {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const datePart = `${yyyy}${mm}${dd}`;
  const prefix = `CMP-${datePart}-`;

  const sameDayCount = dataStore.complaints.filter((item) => String(item.complaint_no || '').startsWith(prefix)).length;
  const seq = String(sameDayCount + 1).padStart(4, '0');
  return `${prefix}${seq}`;
}

module.exports = {
  insert,
  findById,
  list,
  update,
  appendTimeline,
  countOpenByLocation,
  nextComplaintNo
};
