const { v4: uuidv4 } = require('uuid');
const auditRepository = require('../repositories/auditRepository');
const { nowIso } = require('../utils/time');

function writeAuditLog({
  locationId,
  eventType,
  performedBy,
  loginId,
  sessionId,
  deviceName,
  details,
  ipAddress
}) {
  const log = {
    _id: `audit_${uuidv4().replace(/-/g, '').slice(0, 12)}`,
    location_id: locationId || null,
    event_type: eventType,
    performed_by: performedBy || null,
    login_id: loginId || null,
    session_id: sessionId || null,
    device_name: deviceName || null,
    ip_address: ipAddress || null,
    details: details || {},
    timestamp: nowIso()
  };

  return auditRepository.insert(log);
}

function listAuditLogs(locationId) {
  return auditRepository
    .listByLocation(locationId)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

module.exports = {
  writeAuditLog,
  listAuditLogs
};
