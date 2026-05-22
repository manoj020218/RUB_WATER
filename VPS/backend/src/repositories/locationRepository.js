const { dataStore } = require('../db/datastore');

function listAll() {
  return [...dataStore.locations];
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

module.exports = {
  listAll,
  listByIds,
  findById,
  update
};
