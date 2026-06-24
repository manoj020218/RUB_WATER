const env = require('../config/env');
const deviceRepository = require('../repositories/deviceRepository');
const { unauthorized } = require('../utils/errors');

function hasValidApiKey(req) {
  const apiKey = req.headers['x-api-key'];
  return Boolean(apiKey && apiKey === env.apiKey);
}

function resolveDeviceIdentity(req) {
  return {
    deviceId: req.body?.device_id || req.params?.deviceId || req.query?.device_id || null,
    hardwareId: req.body?.hardware_id
      || req.params?.hardwareId
      || req.query?.hardware_id
      || req.headers['x-hardware-id']
      || null
  };
}

function requireApiKey(req, res, next) {
  if (!hasValidApiKey(req)) {
    return next(unauthorized('Valid x-api-key header is required'));
  }
  return next();
}

function requireApiKeyOrKnownDevice(req, res, next) {
  if (hasValidApiKey(req)) {
    req.deviceAuth = { mode: 'api_key' };
    return next();
  }

  const { deviceId, hardwareId } = resolveDeviceIdentity(req);
  const resolvedDevice = deviceRepository.resolveByIdentity({
    deviceId,
    hardwareId,
    routeId: req.params?.deviceId || req.params?.hardwareId || null
  });
  const deviceToken = String(
    req.headers['x-device-key']
      || req.headers['x-device-token']
      || req.headers['x-provision-token']
      || ''
  ).trim();
  if (resolvedDevice && deviceToken && deviceRepository.verifyDeviceToken(resolvedDevice._id, deviceToken)) {
    req.deviceAuth = {
      mode: 'device_key',
      device_id: resolvedDevice._id,
      hardware_id: resolvedDevice.hardware_id || null
    };
    return next();
  }

  if (env.allowDeviceIdAuth && resolvedDevice) {
    req.deviceAuth = {
      mode: resolvedDevice.hardware_id ? 'device_identity' : 'device_id',
      device_id: resolvedDevice._id,
      hardware_id: resolvedDevice.hardware_id || null
    };
    return next();
  }

  return next(unauthorized('Valid x-api-key, x-device-key, x-device-token, or known device identity is required'));
}

function attachProxyActor(req, res, next) {
  req.proxyActor = {
    user_id: req.headers['x-user-id'] || null,
    user_name: req.headers['x-user-name'] || null
  };
  next();
}

module.exports = {
  requireApiKey,
  requireApiKeyOrKnownDevice,
  attachProxyActor
};
