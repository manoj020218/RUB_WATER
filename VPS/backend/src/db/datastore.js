const dataStore = {
  users: [],
  userSessions: [],
  locations: [],
  devices: [],
  telemetry: [],
  incidents: [],
  auditLogs: [],
  complaints: [],
  notifications: [],
  deviceLifecycleHistory: [],
  integrationSettings: [],
  integrationDeliveryLogs: [],
  firmwareVersions: [],
  appVersions: [],
  commands: [],
  deviceConfigs: [],
  deviceConfigHistory: [],
  deviceActionSheets: [],
  deviceActionSheetHistory: [],
  alertActionLogs: [],
  vendors: [],
  projects: []
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
