const { dataStore } = require('../db/datastore');

function findByLoginId(loginId) {
  return dataStore.users.find((user) => user.login_id === loginId) || null;
}

function findById(userId) {
  return dataStore.users.find((user) => user._id === userId) || null;
}

function listAll() {
  return [...dataStore.users];
}

function insert(user) {
  dataStore.users.push(user);
  return user;
}

function update(userId, patch) {
  const target = findById(userId);
  if (!target) {
    return null;
  }

  Object.assign(target, patch || {});
  return target;
}

module.exports = {
  findByLoginId,
  findById,
  listAll,
  insert,
  update
};
