const dataStore = {
  users: [],
  userSessions: [],
  locations: [],
  devices: [],
  telemetry: [],
  incidents: [],
  auditLogs: [],
  firmwareVersions: [],
  appVersions: [],
  commands: []
};

function resetStore() {
  Object.keys(dataStore).forEach((key) => {
    dataStore[key] = [];
  });
}

module.exports = {
  dataStore,
  resetStore
};
