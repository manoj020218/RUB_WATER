const authService = require('../services/authService');

async function login(req, res, next) {
  try {
    const result = await authService.login({
      loginId: req.body.login_id,
      password: req.body.password,
      deviceName: req.body.device_name,
      appType: req.body.app_type,
      fcmToken: req.body.fcm_token,
      ipAddress: req.ip
    });

    res.json({
      ok: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
}

function logout(req, res, next) {
  try {
    const result = authService.logout(req.auth.session._id);
    res.json({
      ok: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
}

function me(req, res) {
  res.json({
    ok: true,
    data: {
      user: {
        user_id: req.auth.user._id,
        login_id: req.auth.user.login_id,
        name: req.auth.user.name,
        role: req.auth.user.role,
        assigned_location_ids: req.auth.user.assigned_location_ids
      },
      session: req.auth.session
    }
  });
}

module.exports = {
  login,
  logout,
  me
};
