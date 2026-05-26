const authService = require('../services/authService');
const sessionRepository = require('../repositories/sessionRepository');
const auditService = require('../services/auditService');

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

function refresh(req, res, next) {
  try {
    const authHeader = String(req.headers.authorization || '');
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) {
      res.status(401).json({ ok: false, error: 'No token provided' });
      return;
    }
    const result = authService.refresh(token);
    res.json({ ok: true, data: result });
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

async function changePassword(req, res, next) {
  try {
    const data = await authService.changeOwnPassword({
      authContext: req.auth,
      currentPassword: req.body?.current_password,
      newPassword: req.body?.new_password
    });

    auditService.writeAuditLog({
      locationId: null,
      eventType: 'PASSWORD_CHANGED',
      performedBy: req.auth.user._id,
      loginId: req.auth.user.login_id,
      sessionId: req.auth.session?._id || null,
      deviceName: req.auth.session?.device_name || null,
      ipAddress: req.ip,
      details: {
        user_id: req.auth.user._id,
        deactivated_sessions: data.deactivated_sessions
      }
    });

    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

async function resetPassword(req, res, next) {
  try {
    const data = await authService.resetUserPassword({
      authContext: req.auth,
      targetUserId: req.body?.user_id,
      targetLoginId: req.body?.login_id,
      newPassword: req.body?.new_password
    });

    auditService.writeAuditLog({
      locationId: null,
      eventType: 'PASSWORD_RESET',
      performedBy: req.auth.user._id,
      loginId: req.auth.user.login_id,
      sessionId: req.auth.session?._id || null,
      deviceName: req.auth.session?.device_name || null,
      ipAddress: req.ip,
      details: {
        target_user_id: data.user_id,
        target_login_id: data.login_id,
        default_password_applied: data.default_password_applied,
        deactivated_sessions: data.deactivated_sessions
      }
    });

    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

function updateFcmToken(req, res, next) {
  try {
    const fcmToken = String(req.body?.fcm_token || '').trim();
    sessionRepository.updateFcmToken(req.auth.session._id, fcmToken || null);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  login,
  refresh,
  logout,
  me,
  changePassword,
  resetPassword,
  updateFcmToken
};
