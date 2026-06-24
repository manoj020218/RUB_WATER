const deviceActionSheetService = require('../services/deviceActionSheetService');

function getDeviceActionSheet(req, res, next) {
  try {
    const data = deviceActionSheetService.getDeviceActionSheet({
      deviceId: req.params.deviceId,
      authContext: req.auth
    });
    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

function putDeviceActionSheet(req, res, next) {
  try {
    const data = deviceActionSheetService.putDeviceActionSheet({
      deviceId: req.params.deviceId,
      payload: req.body,
      authContext: req.auth,
      ipAddress: req.ip
    });
    res.status(202).json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

function pushDeviceActionSheet(req, res, next) {
  try {
    const data = deviceActionSheetService.pushDeviceActionSheet({
      deviceId: req.params.deviceId,
      authContext: req.auth,
      ipAddress: req.ip
    });
    res.status(202).json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

function getDeviceActionSheetHistory(req, res, next) {
  try {
    const data = deviceActionSheetService.listDeviceActionSheetHistory({
      deviceId: req.params.deviceId,
      authContext: req.auth
    });
    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getDeviceActionSheet,
  putDeviceActionSheet,
  pushDeviceActionSheet,
  getDeviceActionSheetHistory
};
