const { dataStore } = require('../db/datastore');

function findActiveByLocation(locationId) {
  return dataStore.incidents.find((incident) => incident.location_id === locationId && incident.status === 'ACTIVE') || null;
}

function insert(incident) {
  dataStore.incidents.push(incident);
  return incident;
}

function update(incidentId, patch) {
  const incident = dataStore.incidents.find((item) => item._id === incidentId);
  if (!incident) {
    return null;
  }
  Object.assign(incident, patch);
  return incident;
}

function listByLocation(locationId) {
  if (!locationId) {
    return [...dataStore.incidents];
  }
  return dataStore.incidents.filter((incident) => incident.location_id === locationId);
}

module.exports = {
  findActiveByLocation,
  insert,
  update,
  listByLocation
};
