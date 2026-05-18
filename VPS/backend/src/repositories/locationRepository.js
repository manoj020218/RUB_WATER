const { dataStore } = require('../db/datastore');

function listByIds(ids) {
  return dataStore.locations.filter((location) => ids.includes(location._id));
}

function findById(locationId) {
  return dataStore.locations.find((location) => location._id === locationId) || null;
}

module.exports = {
  listByIds,
  findById
};
