const { dataStore } = require('../db/datastore');

function findById(deviceId) {
  return dataStore.devices.find((device) => device._id === deviceId) || null;
}

function findByLocation(locationId) {
  return dataStore.devices.find((device) => device.location_id === locationId) || null;
}

function updateRuntime(deviceId, patch) {
  const device = findById(deviceId);
  if (!device) {
    return null;
  }
  Object.assign(device, patch);
  return device;
}

module.exports = {
  findById,
  findByLocation,
  updateRuntime
};
