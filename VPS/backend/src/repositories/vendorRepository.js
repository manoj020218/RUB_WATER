const { dataStore } = require('../db/datastore');

function findAll() {
  return [...dataStore.vendors];
}

function findById(vendorId) {
  return dataStore.vendors.find((v) => v._id === vendorId) || null;
}

function findByAdminLoginId(loginId) {
  return dataStore.vendors.find((v) => v.admin_login_id === loginId) || null;
}

function create(data) {
  dataStore.vendors.push(data);
  return data;
}

function update(vendorId, patch) {
  const target = findById(vendorId);
  if (!target) {
    return null;
  }
  Object.assign(target, patch);
  return target;
}

module.exports = {
  findAll,
  findById,
  findByAdminLoginId,
  create,
  update
};
