const { dataStore } = require('../db/datastore');

function insert(command) {
  dataStore.commands.push(command);
  return command;
}

function listPendingByDevice(deviceId, nowIso = new Date().toISOString()) {
  const now = new Date(nowIso).getTime();
  return dataStore.commands.filter((command) => {
    if (command.device_id !== deviceId) {
      return false;
    }
    if (command.status !== 'PENDING') {
      return false;
    }
    return new Date(command.expires_at).getTime() >= now;
  });
}

function findByCommandId(commandId) {
  return dataStore.commands.find((command) => command.command_id === commandId) || null;
}

function updateStatus(commandId, status, ack) {
  const command = findByCommandId(commandId);
  if (!command) {
    return null;
  }
  command.status = status;
  if (ack) {
    command.ack = ack;
  }
  return command;
}

module.exports = {
  insert,
  listPendingByDevice,
  findByCommandId,
  updateStatus
};
