const { dataStore } = require('../db/datastore');

function findLatestByHardware(hardwareCode) {
  const filtered = dataStore.firmwareVersions.filter((item) => item.hardware_code === hardwareCode);
  if (filtered.length === 0) {
    return null;
  }
  return filtered
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
}

module.exports = {
  findLatestByHardware
};
