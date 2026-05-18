const { dataStore } = require('../db/datastore');

function insert(record) {
  dataStore.telemetry.push(record);
  return record;
}

function listAll() {
  return [...dataStore.telemetry];
}

function listByDevice(deviceId) {
  return dataStore.telemetry.filter((item) => item.device_id === deviceId);
}

function listByLocation(locationId) {
  return dataStore.telemetry.filter((item) => item.location_id === locationId);
}

function listSince(sinceIso) {
  const sinceMs = new Date(sinceIso).getTime();
  return dataStore.telemetry.filter((item) => new Date(item.timestamp).getTime() >= sinceMs);
}

function replaceAll(nextRecords) {
  dataStore.telemetry = nextRecords;
}

function count() {
  return dataStore.telemetry.length;
}

module.exports = {
  insert,
  listAll,
  listByDevice,
  listByLocation,
  listSince,
  replaceAll,
  count
};
