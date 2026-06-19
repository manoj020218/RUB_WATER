const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const env = require('../config/env');
const userRepository = require('../repositories/userRepository');
const sessionRepository = require('../repositories/sessionRepository');
const { badRequest, unauthorized, notFound, forbidden } = require('../utils/errors');
const { assertPermission } = require('./rbacService');

function sanitizeUser(user) {
  return {
    user_id: user._id,
    login_id: user.login_id,
    name: user.name,
    role: user.role,
    assigned_location_ids: user.assigned_location_ids
  };
}

async function login({ loginId, password, deviceName, appType, fcmToken, ipAddress }) {
  if (!loginId || !password) {
    throw badRequest('login_id and password are required');
  }

  const user = userRepository.findByLoginId(loginId);
  if (!user || !user.is_active) {
    throw unauthorized('Invalid credentials');
  }

  const validPassword = await bcrypt.compare(password, user.password_hash);
  if (!validPassword) {
    throw unauthorized('Invalid credentials');
  }

  const sessionId = `session_${uuidv4().replace(/-/g, '').slice(0, 12)}`;
  const issuedAt = new Date().toISOString();

  const session = {
    _id: sessionId,
    user_id: user._id,
    login_id: user.login_id,
    device_name: deviceName || 'Unknown device',
    app_type: appType || 'PWA',
    fcm_token: fcmToken || null,
    ip_address: ipAddress || null,
    created_at: issuedAt,
    last_seen: issuedAt,
    is_active: true
  };
  sessionRepository.create(session);

  const token = jwt.sign(
    {
      sub: user._id,
      login_id: user.login_id,
      role: user.role,
      session_id: sessionId
    },
    env.jwtSecret,
    { expiresIn: env.jwtTtl }
  );

  return {
    token,
    token_type: 'Bearer',
    expires_in: env.jwtTtl,
    user: sanitizeUser(user),
    session,
    force_password_change: user.force_password_change === true
  };
}

function verifyToken(token) {
  try {
    return jwt.verify(token, env.jwtSecret);
  } catch (error) {
    throw unauthorized('Invalid or expired token');
  }
}

function authenticateToken(token) {
  const claims = verifyToken(token);
  const user = userRepository.findById(claims.sub);
  const session = sessionRepository.findActiveById(claims.session_id);

  if (!user || !user.is_active || !session) {
    throw unauthorized('Session is invalid or expired');
  }

  return {
    user,
    session,
    claims,
    role: user.role
  };
}

function refresh(token) {
  let claims;
  try {
    claims = jwt.verify(token, env.jwtSecret);
  } catch (error) {
    throw unauthorized('Invalid or expired token');
  }
  const user = userRepository.findById(claims.sub);
  if (!user || !user.is_active) {
    throw unauthorized('User not found or deactivated');
  }
  const sessionId = `session_${uuidv4().replace(/-/g, '').slice(0, 12)}`;
  const issuedAt = new Date().toISOString();
  const session = {
    _id: sessionId,
    user_id: user._id,
    login_id: user.login_id,
    device_name: 'Auto-refresh',
    app_type: 'PWA',
    fcm_token: null,
    ip_address: null,
    created_at: issuedAt,
    last_seen: issuedAt,
    is_active: true
  };
  sessionRepository.create(session);
  const newToken = jwt.sign(
    { sub: user._id, login_id: user.login_id, role: user.role, session_id: sessionId },
    env.jwtSecret,
    { expiresIn: env.jwtTtl }
  );
  return { token: newToken, token_type: 'Bearer', expires_in: env.jwtTtl, user: sanitizeUser(user), session };
}

function logout(sessionId) {
  if (!sessionId) {
    throw badRequest('session id is required');
  }
  const session = sessionRepository.deactivate(sessionId);
  if (!session) {
    throw unauthorized('Session not found');
  }
  return session;
}

async function changeOwnPassword({ authContext, currentPassword, newPassword }) {
  assertPermission(authContext.user.role, 'CHANGE_OWN_PASSWORD');
  if (!currentPassword || !newPassword) {
    throw badRequest('current_password and new_password are required');
  }
  if (String(newPassword).length < 6) {
    throw badRequest('new_password must be at least 6 characters');
  }

  const user = userRepository.findById(authContext.user._id);
  if (!user || !user.is_active) {
    throw unauthorized('Invalid session user');
  }

  const ok = await bcrypt.compare(String(currentPassword), user.password_hash);
  if (!ok) {
    throw unauthorized('Current password is incorrect');
  }

  const same = await bcrypt.compare(String(newPassword), user.password_hash);
  if (same) {
    throw badRequest('new_password must be different from current_password');
  }

  const newHash = await bcrypt.hash(String(newPassword), 10);
  userRepository.update(user._id, {
    password_hash: newHash,
    force_password_change: false,
    updated_at: new Date().toISOString()
  });
  const deactivatedSessions = sessionRepository.deactivateOtherSessions(user._id, authContext.session._id);

  return {
    user_id: user._id,
    login_id: user.login_id,
    changed_at: new Date().toISOString(),
    deactivated_sessions: deactivatedSessions
  };
}

function canResetPassword(actor, target) {
  if (!actor || !target) {
    return false;
  }
  if (actor.role === 'VENDOR_SUPER_ADMIN') {
    return true;
  }
  if (actor.role === 'DEMO_SUPER_ADMIN') {
    return target.created_by === actor._id;
  }
  if (!actor.department_id || actor.department_id !== target.department_id) {
    return false;
  }
  if (actor.role === 'DEPARTMENT_SUPER_ADMIN' || actor.role === 'DEPARTMENT_ADMIN' || actor.role === 'LOCATION_ADMIN') {
    return true;
  }
  return false;
}

async function resetUserPassword({ authContext, targetUserId, targetLoginId, newPassword }) {
  assertPermission(authContext.user.role, 'RESET_USER_PASSWORD');

  let target = null;
  if (targetUserId) {
    target = userRepository.findById(String(targetUserId).trim());
  } else if (targetLoginId) {
    target = userRepository.findByLoginId(String(targetLoginId).trim());
  } else {
    throw badRequest('user_id or login_id is required');
  }

  if (!target) {
    throw notFound('Target user not found');
  }
  if (!canResetPassword(authContext.user, target)) {
    throw forbidden('You cannot reset password for this user');
  }

  const nextPassword = String(newPassword || env.defaultResetPassword || '123456');
  if (nextPassword.length < 6) {
    throw badRequest('reset password must be at least 6 characters');
  }

  const nextHash = await bcrypt.hash(nextPassword, 10);
  userRepository.update(target._id, {
    password_hash: nextHash,
    updated_at: new Date().toISOString(),
    is_active: true
  });
  const deactivatedSessions = sessionRepository.deactivateByUserId(target._id);

  return {
    user_id: target._id,
    login_id: target.login_id,
    reset_at: new Date().toISOString(),
    deactivated_sessions: deactivatedSessions,
    default_password_applied: !newPassword,
    temporary_password: nextPassword
  };
}

module.exports = {
  login,
  authenticateToken,
  refresh,
  logout,
  changeOwnPassword,
  resetUserPassword
};
