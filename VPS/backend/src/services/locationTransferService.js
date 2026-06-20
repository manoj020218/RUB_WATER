const adminUserService = require('./adminUserService');
const auditService = require('./auditService');
const { ROLE } = require('../config/permissions');
const { assertUserLocationAccess } = require('./accessService');
const locationRepository = require('../repositories/locationRepository');
const deviceRepository = require('../repositories/deviceRepository');
const userRepository = require('../repositories/userRepository');
const { badRequest, forbidden, notFound } = require('../utils/errors');

const RIGHTS_PRESETS = Object.freeze({
  MOVE: { grant_receiver: true, revoke_sender: true },
  SHARE: { grant_receiver: true, revoke_sender: false },
  GRANT_RECEIVER: { grant_receiver: true, revoke_sender: false },
  REVOKE_SENDER: { grant_receiver: false, revoke_sender: true }
});

function normalizeString(value) {
  return String(value || '').trim();
}

function normalizeRights(value) {
  if (typeof value === 'string' || value == null) {
    const mode = String(value || 'MOVE').trim().toUpperCase();
    const preset = RIGHTS_PRESETS[mode];
    if (!preset) {
      throw badRequest('Invalid rights mode. Use MOVE, SHARE, GRANT_RECEIVER, or REVOKE_SENDER');
    }
    return { mode, ...preset };
  }

  const mode = String(value.mode || value.rights || 'CUSTOM').trim().toUpperCase() || 'CUSTOM';
  const grantReceiver = value.grant_receiver !== false;
  const revokeSender = value.revoke_sender === true;
  if (!grantReceiver && !revokeSender) {
    throw badRequest('Transfer rights must grant receiver access, revoke sender access, or both');
  }
  return {
    mode,
    grant_receiver: grantReceiver,
    revoke_sender: revokeSender
  };
}

function sanitizeUser(user) {
  if (!user) {
    return null;
  }
  return {
    user_id: user._id,
    login_id: user.login_id,
    name: user.name,
    role: user.role,
    assigned_location_ids: Array.isArray(user.assigned_location_ids) ? [...user.assigned_location_ids] : [],
    is_active: Boolean(user.is_active)
  };
}

function resolveUserRef({ userId, loginId, label, required = true }) {
  const nextUserId = normalizeString(userId);
  const nextLoginId = normalizeString(loginId);
  let user = null;
  if (nextUserId) {
    user = userRepository.findById(nextUserId);
  } else if (nextLoginId) {
    user = userRepository.findByLoginId(nextLoginId);
  }
  if (!user && required) {
    throw notFound(`${label} user not found`);
  }
  return user;
}

function ensureDemoTransferRules({ actor, sender, receiver }) {
  if (actor.role !== ROLE.DEMO_SUPER_ADMIN) {
    return;
  }
  if (!sender || sender._id !== actor._id) {
    throw forbidden('Demo transfer must use the logged-in demo user as sender');
  }
  if (receiver && receiver.role !== ROLE.VENDOR_SUPER_ADMIN) {
    throw forbidden('Demo can transfer only to VENDOR_SUPER_ADMIN users');
  }
}

function updateLocationAssignment(user, locationId, shouldHaveAccess) {
  if (!user) {
    return { had_access: false, has_access: false };
  }
  const current = Array.isArray(user.assigned_location_ids) ? [...new Set(user.assigned_location_ids)] : [];
  const hadAccess = current.includes(locationId);
  if (typeof shouldHaveAccess !== 'boolean') {
    return { had_access: hadAccess, has_access: hadAccess };
  }
  let next = current;
  if (shouldHaveAccess && !hadAccess) {
    next = [...current, locationId];
  } else if (!shouldHaveAccess && hadAccess) {
    next = current.filter((item) => item !== locationId);
  }

  if (next !== current) {
    userRepository.update(user._id, {
      assigned_location_ids: next,
      updated_at: new Date().toISOString()
    });
  }

  const refreshed = userRepository.findById(user._id) || user;
  const hasAccess = Array.isArray(refreshed.assigned_location_ids) && refreshed.assigned_location_ids.includes(locationId);
  return { had_access: hadAccess, has_access: hasAccess };
}

async function createReceiverUser({ payload, authContext, ipAddress }) {
  const loginId = normalizeString(payload?.login_id);
  const password = normalizeString(payload?.password);
  const name = normalizeString(payload?.name) || loginId;
  const role = normalizeString(payload?.role).toUpperCase() || (
    authContext.user.role === ROLE.DEMO_SUPER_ADMIN
      ? ROLE.VENDOR_SUPER_ADMIN
      : ROLE.DEPARTMENT_SUPER_ADMIN
  );
  if (!loginId || !password) {
    throw badRequest('create_receiver.login_id and create_receiver.password are required');
  }

  const created = await adminUserService.createManagedUser({
    loginId,
    password,
    name,
    role,
    assignedLocationIds: [],
    vendorId: payload?.vendor_id,
    departmentId: payload?.department_id,
    isActive: true,
    authContext,
    ipAddress
  });

  return userRepository.findById(created.user_id);
}

async function runLocationTransfer({
  locationId,
  senderUserId,
  senderLoginId,
  receiverUserId,
  receiverLoginId,
  rights,
  createReceiver,
  authContext,
  ipAddress
}) {
  const nextLocationId = normalizeString(locationId).toUpperCase();
  if (!nextLocationId) {
    throw badRequest('location_id is required');
  }

  const location = locationRepository.findById(nextLocationId);
  if (!location) {
    throw notFound('Location not found');
  }
  assertUserLocationAccess(authContext.user, nextLocationId);

  const rightsPlan = normalizeRights(rights);
  const sender = resolveUserRef({
    userId: senderUserId || authContext.user._id,
    loginId: senderLoginId || authContext.user.login_id,
    label: 'Sender'
  });

  let receiver = null;
  let createdReceiver = null;
  if (rightsPlan.grant_receiver) {
    if (createReceiver && (createReceiver.login_id || createReceiver.password)) {
      receiver = await createReceiverUser({ payload: createReceiver, authContext, ipAddress });
      createdReceiver = sanitizeUser(receiver);
    } else {
      receiver = resolveUserRef({
        userId: receiverUserId,
        loginId: receiverLoginId,
        label: 'Receiver'
      });
    }
  } else if (receiverUserId || receiverLoginId) {
    receiver = resolveUserRef({
      userId: receiverUserId,
      loginId: receiverLoginId,
      label: 'Receiver',
      required: false
    });
  }

  ensureDemoTransferRules({ actor: authContext.user, sender, receiver });

  if (rightsPlan.grant_receiver && !receiver) {
    throw badRequest('Receiver user is required for the selected rights mode');
  }
  if (receiver && sender && receiver._id === sender._id && rightsPlan.grant_receiver && rightsPlan.revoke_sender) {
    throw badRequest('Sender and receiver cannot be the same user for MOVE rights');
  }

  const boundDevice = deviceRepository.findByLocation(nextLocationId);
  const senderAccess = rightsPlan.revoke_sender
    ? updateLocationAssignment(sender, nextLocationId, false)
    : updateLocationAssignment(sender, nextLocationId, true);
  const receiverAccess = receiver
    ? updateLocationAssignment(receiver, nextLocationId, rightsPlan.grant_receiver ? true : undefined)
    : { had_access: false, has_access: false };

  auditService.writeAuditLog({
    locationId: nextLocationId,
    eventType: 'LOCATION_TRANSFER_PIPELINE_EXECUTED',
    performedBy: authContext.user._id,
    loginId: authContext.user.login_id,
    sessionId: authContext.session?._id || null,
    deviceName: boundDevice?._id || null,
    ipAddress,
    details: {
      location_id: nextLocationId,
      location_name: location.name,
      device_id: boundDevice?._id || null,
      rights_mode: rightsPlan.mode,
      grant_receiver: rightsPlan.grant_receiver,
      revoke_sender: rightsPlan.revoke_sender,
      sender_user_id: sender?._id || null,
      sender_login_id: sender?.login_id || null,
      receiver_user_id: receiver?._id || null,
      receiver_login_id: receiver?.login_id || null,
      created_receiver_user_id: createdReceiver?.user_id || null
    }
  });

  const refreshedSender = sender ? userRepository.findById(sender._id) : null;
  const refreshedReceiver = receiver ? userRepository.findById(receiver._id) : null;

  return {
    pipeline: rightsPlan,
    location: {
      location_id: nextLocationId,
      location_name: location.name,
      device_id: boundDevice?._id || null
    },
    sender: {
      ...sanitizeUser(refreshedSender),
      transfer_access: senderAccess
    },
    receiver: refreshedReceiver
      ? {
          ...sanitizeUser(refreshedReceiver),
          transfer_access: receiverAccess
        }
      : null,
    created_receiver: createdReceiver
  };
}

module.exports = {
  runLocationTransfer
};
