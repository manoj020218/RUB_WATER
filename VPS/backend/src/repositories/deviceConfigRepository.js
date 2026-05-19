const { dataStore } = require('../db/datastore');

function getCurrentByDevice(deviceId) {
  return dataStore.deviceConfigs.find((item) => item.device_id === deviceId) || null;
}

function upsertCurrent(deviceId, record) {
  const idx = dataStore.deviceConfigs.findIndex((item) => item.device_id === deviceId);
  if (idx === -1) {
    dataStore.deviceConfigs.push(record);
    return record;
  }
  dataStore.deviceConfigs[idx] = record;
  return record;
}

function appendHistory(entry) {
  dataStore.deviceConfigHistory.push(entry);
  return entry;
}

function listHistoryByDevice(deviceId) {
  return dataStore.deviceConfigHistory
    .filter((item) => item.device_id === deviceId)
    .sort((a, b) => new Date(b.requested_at).getTime() - new Date(a.requested_at).getTime());
}

function findHistoryByCommandId(commandId) {
  return dataStore.deviceConfigHistory.find((item) => item.command_id === commandId) || null;
}

function updateHistoryEntry(entryId, patch) {
  const idx = dataStore.deviceConfigHistory.findIndex((item) => item._id === entryId);
  if (idx === -1) {
    return null;
  }
  dataStore.deviceConfigHistory[idx] = {
    ...dataStore.deviceConfigHistory[idx],
    ...patch
  };
  return dataStore.deviceConfigHistory[idx];
}

module.exports = {
  getCurrentByDevice,
  upsertCurrent,
  appendHistory,
  listHistoryByDevice,
  findHistoryByCommandId,
  updateHistoryEntry
};
