const { dataStore } = require('../db/datastore');

function findAll() {
  return [...dataStore.projects];
}

function findById(projectId) {
  return dataStore.projects.find((p) => p._id === projectId) || null;
}

function create(data) {
  dataStore.projects.push(data);
  return data;
}

module.exports = {
  findAll,
  findById,
  create
};
