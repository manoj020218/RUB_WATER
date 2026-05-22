const { dataStore } = require('../db/datastore');

function insert(entry) {
  dataStore.deviceLifecycleHistory.push(entry);
  return entry;
}

function listByDevice(deviceId) {
  if (!deviceId) {
    return [...dataStore.deviceLifecycleHistory];
  }
  return dataStore.deviceLifecycleHistory.filter((item) => item.device_id === deviceId);
}

module.exports = {
  insert,
  listByDevice
};
