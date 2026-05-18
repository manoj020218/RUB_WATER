const commandService = require('../services/commandService');

function muteAlarm(req, res, next) {
  try {
    const command = commandService.issueMuteAlarm({
      locationId: req.body.location_id,
      deviceId: req.body.device_id,
      authContext: req.auth,
      ipAddress: req.ip
    });

    res.status(201).json({ ok: true, data: command });
  } catch (error) {
    next(error);
  }
}

function dryRun(req, res, next) {
  try {
    const command = commandService.issueDryRun({
      locationId: req.body.location_id,
      deviceId: req.body.device_id,
      outputs: req.body.outputs,
      authContext: req.auth,
      ipAddress: req.ip
    });

    res.status(201).json({ ok: true, data: command });
  } catch (error) {
    next(error);
  }
}

function forceClear(req, res, next) {
  try {
    const result = commandService.issueForceClear({
      locationId: req.body.location_id,
      deviceId: req.body.device_id,
      reason: req.body.reason,
      authContext: req.auth,
      ipAddress: req.ip
    });

    res.status(201).json({ ok: true, data: result });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  muteAlarm,
  dryRun,
  forceClear
};
