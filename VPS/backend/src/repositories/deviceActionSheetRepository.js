const { dataStore } = require('../db/datastore');

function getCurrentByDevice(deviceId) {
  return dataStore.deviceActionSheets.find((item) => item.device_id === deviceId) || null;
}

function upsertCurrent(deviceId, record) {
  const idx = dataStore.deviceActionSheets.findIndex((item) => item.device_id === deviceId);
  if (idx === -1) {
    dataStore.deviceActionSheets.push(record);
    return record;
  }
  dataStore.deviceActionSheets[idx] = record;
  return record;
}

function listHistoryByDevice(deviceId) {
  return dataStore.deviceActionSheetHistory
    .filter((item) => item.device_id === deviceId)
    .sort((a, b) => new Date(b.requested_at || b.updated_at || 0).getTime() - new Date(a.requested_at || a.updated_at || 0).getTime());
}

function appendHistory(entry) {
  dataStore.deviceActionSheetHistory.push(entry);
  return entry;
}

function findHistoryByUpdateId(updateId) {
  return dataStore.deviceActionSheetHistory.find((item) => item.update_id === updateId) || null;
}

function updateHistoryEntry(entryId, patch) {
  const idx = dataStore.deviceActionSheetHistory.findIndex((item) => item._id === entryId);
  if (idx === -1) {
    return null;
  }
  dataStore.deviceActionSheetHistory[idx] = {
    ...dataStore.deviceActionSheetHistory[idx],
    ...patch
  };
  return dataStore.deviceActionSheetHistory[idx];
}

module.exports = {
  getCurrentByDevice,
  upsertCurrent,
  listHistoryByDevice,
  appendHistory,
  findHistoryByUpdateId,
  updateHistoryEntry
};
