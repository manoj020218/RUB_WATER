const deviceLifecycleService = require('../services/deviceLifecycleService');

function getLifecycleState(req, res, next) {
  try {
    const data = deviceLifecycleService.getLifecycleState({
      deviceId: req.params.deviceId,
      authContext: req.auth
    });
    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

function transitionLifecycle(req, res, next) {
  try {
    const data = deviceLifecycleService.transitionLifecycle({
      deviceId: req.params.deviceId,
      nextStatus: req.body?.next_status,
      reason: req.body?.reason,
      verificationResult: req.body?.verification_result,
      authContext: req.auth,
      ipAddress: req.ip
    });
    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

function listLifecycleHistory(req, res, next) {
  try {
    const data = deviceLifecycleService.listLifecycleHistory({
      deviceId: req.params.deviceId,
      authContext: req.auth
    });
    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getLifecycleState,
  transitionLifecycle,
  listLifecycleHistory
};
