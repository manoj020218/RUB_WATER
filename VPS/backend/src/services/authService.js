const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const env = require('../config/env');
const userRepository = require('../repositories/userRepository');
const sessionRepository = require('../repositories/sessionRepository');
const { badRequest, unauthorized } = require('../utils/errors');

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
    session
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

module.exports = {
  login,
  authenticateToken,
  logout
};
