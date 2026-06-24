const { dataStore } = require('../db/datastore');

function insert(entry) {
  dataStore.alertActionLogs.push(entry);
  return entry;
}

function listByLocation(locationId) {
  if (!locationId) {
    return [...dataStore.alertActionLogs];
  }
  return dataStore.alertActionLogs.filter((item) => item.location_id === locationId);
}

module.exports = {
  insert,
  listByLocation
};
