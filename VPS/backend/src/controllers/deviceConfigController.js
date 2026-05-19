const deviceConfigService = require('../services/deviceConfigService');

function getDeviceConfig(req, res, next) {
  try {
    const data = deviceConfigService.getDeviceConfig({
      deviceId: req.params.deviceId,
      authContext: req.auth
    });
    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

function putDeviceConfig(req, res, next) {
  try {
    const data = deviceConfigService.putDeviceConfig({
      deviceId: req.params.deviceId,
      configPayload: req.body,
      authContext: req.auth,
      ipAddress: req.ip
    });
    res.status(202).json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

function pushDeviceConfig(req, res, next) {
  try {
    const data = deviceConfigService.pushDeviceConfig({
      deviceId: req.params.deviceId,
      authContext: req.auth,
      ipAddress: req.ip
    });
    res.status(202).json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

function getDeviceConfigHistory(req, res, next) {
  try {
    const data = deviceConfigService.listDeviceConfigHistory({
      deviceId: req.params.deviceId,
      authContext: req.auth
    });
    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getDeviceConfig,
  putDeviceConfig,
  pushDeviceConfig,
  getDeviceConfigHistory
};
