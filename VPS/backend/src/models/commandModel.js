const { v4: uuidv4 } = require('uuid');
const { badRequest } = require('../utils/errors');
const { nowIso } = require('../utils/time');

function createCommandRecord({ command, deviceId, locationId, issuedBy, payload, expireInSeconds = 60 }) {
  if (!command || !deviceId || !locationId) {
    throw badRequest('command, deviceId and locationId are required');
  }

  const issuedAt = nowIso();
  return {
    _id: uuidv4(),
    command_id: `cmd_${uuidv4().replace(/-/g, '').slice(0, 12)}`,
    command,
    device_id: deviceId,
    location_id: locationId,
    status: 'PENDING',
    issued_by: issuedBy,
    payload: payload || {},
    issued_at: issuedAt,
    expires_at: new Date(Date.now() + expireInSeconds * 1000).toISOString(),
    ack: null
  };
}

module.exports = {
  createCommandRecord
};
