const deviceProvisionService = require('../services/deviceProvisionService');

function claimDevice(req, res, next) {
  try {
    const data = deviceProvisionService.claimDevice({
      deviceId: req.params.deviceId,
      authContext: req.auth,
      ipAddress: req.ip
    });
    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

function createProvisionProfile(req, res, next) {
  try {
    const data = deviceProvisionService.createProvisionProfile({
      deviceId: req.params.deviceId,
      authContext: req.auth,
      ipAddress: req.ip
    });
    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  claimDevice,
  createProvisionProfile
};
