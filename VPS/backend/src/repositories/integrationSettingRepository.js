const crypto = require('crypto');
const { dataStore } = require('../db/datastore');

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

function findByDepartmentId(departmentId) {
  return dataStore.integrationSettings.find((item) => item.department_id === departmentId) || null;
}

function listAll() {
  return [...dataStore.integrationSettings];
}

function upsertByDepartmentId(departmentId, patch) {
  const existing = findByDepartmentId(departmentId);
  if (existing) {
    Object.assign(existing, patch || {});
    return existing;
  }
  const created = {
    _id: `int_${crypto.randomBytes(6).toString('hex')}`,
    department_id: departmentId,
    ...patch
  };
  dataStore.integrationSettings.push(created);
  return created;
}

function findByInboundToken(inboundToken) {
  const hash = hashToken(inboundToken);
  return dataStore.integrationSettings.find((item) => item.inbound_token_hash === hash && item.enabled) || null;
}

function insertDeliveryLog(entry) {
  dataStore.integrationDeliveryLogs.push(entry);
  return entry;
}

function listDeliveryLogs(filters = {}) {
  const departmentId = String(filters.department_id || '').trim();
  return dataStore.integrationDeliveryLogs.filter((item) => {
    if (departmentId && item.department_id !== departmentId) {
      return false;
    }
    return true;
  });
}

module.exports = {
  hashToken,
  findByDepartmentId,
  listAll,
  upsertByDepartmentId,
  findByInboundToken,
  insertDeliveryLog,
  listDeliveryLogs
};
