const { dataStore } = require('../db/datastore');

function listAll() {
  return [...dataStore.locations];
}

function create(data) {
  const locationId = String(data.location_id || '').trim().toUpperCase();
  if (!locationId) throw new Error('Location ID is required');
  if (dataStore.locations.find((l) => l._id === locationId)) {
    throw new Error(`Location ${locationId} already exists`);
  }
  const now = new Date().toISOString();
  const loc = {
    _id: locationId,
    name: String(data.location_name || data.name || locationId).trim(),
    description: String(data.description || '').trim(),
    department_id: String(data.department_id || 'dept_001').trim(),
    sensor_mount_height_mm: Number(data.sensor_mount_height_mm) || 1200,
    alert_level_mm: Number(data.alert_level_mm) || 200,
    danger_level_mm: Number(data.danger_level_mm) || 500,
    danger_clear_level_mm: Number(data.danger_clear_level_mm) || 450,
    maintenance_status: 'OK',
    operational_status: 'ACTIVE',
    lifecycle_note: null,
    lifecycle_updated_at: now,
    is_active: true,
    created_at: now,
    updated_at: now
  };
  dataStore.locations.push(loc);
  return loc;
}

function listByIds(ids) {
  return dataStore.locations.filter((location) => ids.includes(location._id));
}

function findById(locationId) {
  return dataStore.locations.find((location) => location._id === locationId) || null;
}

function update(locationId, patch) {
  const target = findById(locationId);
  if (!target) {
    return null;
  }
  Object.assign(target, patch || {});
  return target;
}

function remove(locationId) {
  const idx = dataStore.locations.findIndex((l) => l._id === locationId);
  if (idx === -1) return false;
  dataStore.locations.splice(idx, 1);
  return true;
}

module.exports = {
  listAll,
  listByIds,
  findById,
  update,
  create,
  remove
};
