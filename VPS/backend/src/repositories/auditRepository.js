const { dataStore } = require('../db/datastore');

function insert(log) {
  dataStore.auditLogs.push(log);
  return log;
}

function listByLocation(locationId) {
  if (!locationId) {
    return [...dataStore.auditLogs];
  }
  return dataStore.auditLogs.filter((item) => item.location_id === locationId);
}

module.exports = {
  insert,
  listByLocation
};
