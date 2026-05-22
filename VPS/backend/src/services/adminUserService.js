const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { ROLE } = require('../config/permissions');
const userRepository = require('../repositories/userRepository');
const sessionRepository = require('../repositories/sessionRepository');
const auditService = require('./auditService');
const { assertPermission } = require('./rbacService');
const { badRequest, forbidden, notFound } = require('../utils/errors');
const { nowIso } = require('../utils/time');

const ROLE_SET = new Set(Object.values(ROLE));

function normalizeRole(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'THIRD_PARTY_MONITORING') {
    return ROLE.THIRD_PARTY_MONITORING_USER;
  }
  return normalized;
}

function normalizeString(value) {
  return String(value || '').trim();
}

function sanitizeAdminUser(user, activeSessionCount = null) {
  const payload = {
    user_id: user._id,
    login_id: user.login_id,
    name: user.name,
    role: user.role,
    vendor_id: user.vendor_id || null,
    department_id: user.department_id || null,
    assigned_location_ids: Array.isArray(user.assigned_location_ids) ? [...user.assigned_location_ids] : [],
    is_active: Boolean(user.is_active),
    created_at: user.created_at || null,
    updated_at: user.updated_at || null
  };

  if (activeSessionCount !== null) {
    payload.active_session_count = activeSessionCount;
  }

  return payload;
}

function canManageUser(authUser, targetUser) {
  if (!authUser || !targetUser) {
    return false;
  }

  if (authUser.role === ROLE.VENDOR_SUPER_ADMIN) {
    return true;
  }

  return (
    authUser.role === ROLE.DEPARTMENT_SUPER_ADMIN &&
    authUser.department_id &&
    authUser.department_id === targetUser.department_id
  );
}

function assertRoleCanAssign(authUser, targetRole) {
  if (authUser.role === ROLE.VENDOR_SUPER_ADMIN) {
    return;
  }

  if (authUser.role === ROLE.DEPARTMENT_SUPER_ADMIN && targetRole !== ROLE.VENDOR_SUPER_ADMIN) {
    return;
  }

  throw forbidden('You are not allowed to assign this role');
}

function listManagedUsers(authContext) {
  assertPermission(authContext.user.role, 'MANAGE_USER_ACCESS');

  const users = userRepository.listAll().filter((user) => canManageUser(authContext.user, user));
  return users.map((user) => sanitizeAdminUser(user, sessionRepository.listActiveByUserId(user._id).length));
}

async function createManagedUser({
  loginId,
  password,
  name,
  role,
  assignedLocationIds,
  vendorId,
  departmentId,
  isActive,
  authContext,
  ipAddress
}) {
  assertPermission(authContext.user.role, 'MANAGE_USER_ACCESS');

  const nextLoginId = normalizeString(loginId);
  const nextName = normalizeString(name);
  const nextRole = normalizeRole(role);

  if (!nextLoginId) {
    throw badRequest('login_id is required');
  }
  if (!nextName) {
    throw badRequest('name is required');
  }
  if (!password || String(password).length < 6) {
    throw badRequest('password is required (minimum 6 characters)');
  }
  if (!ROLE_SET.has(nextRole)) {
    throw badRequest('Invalid role');
  }

  assertRoleCanAssign(authContext.user, nextRole);

  if (userRepository.findByLoginId(nextLoginId)) {
    throw badRequest('login_id already exists');
  }

  const actor = authContext.user;
  const nextVendorId = actor.role === ROLE.VENDOR_SUPER_ADMIN ? normalizeString(vendorId || actor.vendor_id) : actor.vendor_id;
  const nextDepartmentId = actor.role === ROLE.VENDOR_SUPER_ADMIN
    ? normalizeString(departmentId || actor.department_id)
    : actor.department_id;

  const locations = Array.isArray(assignedLocationIds)
    ? assignedLocationIds.map((item) => normalizeString(item)).filter(Boolean)
    : [];

  const timestamp = nowIso();
  const passwordHash = await bcrypt.hash(String(password), 10);
  const user = {
    _id: `user_${uuidv4().replace(/-/g, '').slice(0, 12)}`,
    login_id: nextLoginId,
    password_hash: passwordHash,
    name: nextName,
    role: nextRole,
    vendor_id: nextVendorId || null,
    department_id: nextDepartmentId || null,
    assigned_location_ids: [...new Set(locations)],
    is_active: isActive !== false,
    created_at: timestamp,
    updated_at: timestamp
  };

  userRepository.insert(user);

  auditService.writeAuditLog({
    locationId: null,
    eventType: 'USER_ACCESS_CREATED',
    performedBy: actor._id,
    loginId: actor.login_id,
    sessionId: authContext.session._id,
    deviceName: authContext.session.device_name,
    ipAddress,
    details: {
      target_user_id: user._id,
      target_login_id: user.login_id,
      target_role: user.role,
      target_active: user.is_active
    }
  });

  return sanitizeAdminUser(user, 0);
}

function setManagedUserAccess({
  userId,
  isActive,
  reason,
  authContext,
  ipAddress
}) {
  assertPermission(authContext.user.role, 'MANAGE_USER_ACCESS');

  if (typeof isActive !== 'boolean') {
    throw badRequest('is_active boolean is required');
  }

  const actor = authContext.user;
  const target = userRepository.findById(userId);
  if (!target) {
    throw notFound('User not found');
  }

  if (!canManageUser(actor, target)) {
    throw forbidden('You cannot manage this user');
  }

  if (target._id === actor._id && isActive === false) {
    throw badRequest('You cannot revoke your own access');
  }

  if (!isActive && normalizeString(reason).length < 5) {
    throw badRequest('Reason is required to revoke access (minimum 5 characters)');
  }

  const updated = userRepository.update(target._id, {
    is_active: isActive,
    updated_at: nowIso()
  });

  let deactivatedSessions = 0;
  if (!isActive) {
    deactivatedSessions = sessionRepository.deactivateByUserId(target._id);
  }

  auditService.writeAuditLog({
    locationId: null,
    eventType: isActive ? 'USER_ACCESS_GRANTED' : 'USER_ACCESS_REVOKED',
    performedBy: actor._id,
    loginId: actor.login_id,
    sessionId: authContext.session._id,
    deviceName: authContext.session.device_name,
    ipAddress,
    details: {
      target_user_id: updated._id,
      target_login_id: updated.login_id,
      reason: normalizeString(reason) || null,
      deactivated_sessions: deactivatedSessions
    }
  });

  const activeSessionCount = sessionRepository.listActiveByUserId(target._id).length;
  return {
    user: sanitizeAdminUser(updated, activeSessionCount),
    deactivated_sessions: deactivatedSessions
  };
}

module.exports = {
  listManagedUsers,
  createManagedUser,
  setManagedUserAccess
};
