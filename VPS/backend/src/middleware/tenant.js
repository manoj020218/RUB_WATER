const env = require('../config/env');
const deviceRepository = require('../repositories/deviceRepository');
const { unauthorized } = require('../utils/errors');

function hasValidApiKey(req) {
  const apiKey = req.headers['x-api-key'];
  return Boolean(apiKey && apiKey === env.apiKey);
}

function resolveDeviceId(req) {
  return req.body?.device_id || req.params?.deviceId || req.query?.device_id || null;
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

  const deviceId = resolveDeviceId(req);
  const deviceToken = String(req.headers['x-device-token'] || req.headers['x-provision-token'] || '').trim();
  if (deviceId && deviceToken && deviceRepository.verifyDeviceToken(deviceId, deviceToken)) {
    req.deviceAuth = {
      mode: 'device_token',
      device_id: deviceId
    };
    return next();
  }

  if (env.allowDeviceIdAuth && deviceId && deviceRepository.findById(deviceId)) {
    req.deviceAuth = {
      mode: 'device_id',
      device_id: deviceId
    };
    return next();
  }

  return next(unauthorized('Valid x-api-key, x-device-token, or known device_id is required'));
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
