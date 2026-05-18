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
    return next();
  }

  if (env.allowDeviceIdAuth) {
    const deviceId = resolveDeviceId(req);
    if (deviceId && deviceRepository.findById(deviceId)) {
      return next();
    }
  }

  return next(unauthorized('Valid x-api-key header or known device_id is required'));
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
