const crypto = require('crypto');
const env = require('../config/env');
const deviceRepository = require('../repositories/deviceRepository');
const locationRepository = require('../repositories/locationRepository');
const auditService = require('./auditService');
const { forbidden, notFound, conflict } = require('../utils/errors');

function assertUserLocationAccess(user, locationId) {
  if (!user) {
    throw forbidden('User context missing');
  }

  if (user.role === 'VENDOR_SUPER_ADMIN') {
    return;
  }

  if (!Array.isArray(user.assigned_location_ids) || !user.assigned_location_ids.includes(locationId)) {
    throw forbidden('Location access denied');
  }
}

function sanitizeBaseUrl(url) {
  let out = String(url || '').trim();
  if (!out) {
    out = `http://${env.vpsFqdn}`;
  }
  out = out.replace(/\/+$/, '');
  out = out.replace(/\/api$/i, '');
  return out;
}

function buildCloudInfo(deviceId) {
  const base = sanitizeBaseUrl(env.publicApiBaseUrl || env.vpsFqdn);
  // Use the public VPS FQDN for device MQTT host, not the internal mqttHost
  // (which may be 'localhost' for VPS-internal broker communication).
  const publicMqttHost = env.vpsFqdn || env.mqttHost;
  return {
    vps_base_url: base,
    vps_check_url: base,
    health_url: `${base}/health`,
    api_base_url: `${base}/api`,
    mqtt: {
      host: publicMqttHost,
      port: env.mqttPort,
      username: deviceId,
      auth_mode: 'token'
    },
    auth_headers: {
      device_key: 'x-device-key',
      device_token: 'x-device-token'
    }
  };
}

function assertProvisionKey(providedKey) {
  const requiredKey = String(env.deviceProvisionKey || '').trim();
  const provided = String(providedKey || '').trim();

  if (env.requireDeviceProvisionKey) {
    if (!requiredKey) {
      throw forbidden('Device registration is locked: server provision key is not configured');
    }
    if (!provided || provided !== requiredKey) {
      throw forbidden('Invalid or missing x-provision-key');
    }
    return;
  }

  if (requiredKey && provided && provided !== requiredKey) {
    throw forbidden('Invalid x-provision-key');
  }
}

function getDeviceWithAccess(deviceId, authContext) {
  const normalizedDeviceId = String(deviceId || '').trim().toUpperCase();
  const device = deviceRepository.findById(normalizedDeviceId);
  if (!device) {
    throw notFound('Device not found');
  }

  const location = locationRepository.findById(device.location_id);
  if (!location) {
    throw notFound('Location not found');
  }

  assertUserLocationAccess(authContext.user, device.location_id);
  return { device, location };
}

function ensureClaimOwnership(device, authContext, ipAddress) {
  const security = device.security || {};
  const existingOwner = security.claimed_by_user_id;
  if (existingOwner && existingOwner !== authContext.user._id) {
    throw conflict('Device is already claimed by another user', {
      claimed_by_name: security.claimed_by_name || null,
      claimed_by_login_id: security.claimed_by_login_id || null
    });
  }

  if (existingOwner === authContext.user._id) {
    return device;
  }

  const claimed = deviceRepository.claimDevice(device._id, authContext.user);
  auditService.writeAuditLog({
    locationId: device.location_id,
    eventType: 'DEVICE_CLAIMED',
    performedBy: authContext.user._id,
    loginId: authContext.user.login_id,
    sessionId: authContext.session?._id || null,
    deviceName: device._id,
    ipAddress,
    details: {
      device_id: device._id
    }
  });
  return claimed;
}

function claimDevice({ deviceId, authContext, ipAddress }) {
  const { device } = getDeviceWithAccess(deviceId, authContext);
  const claimed = ensureClaimOwnership(device, authContext, ipAddress);
  return {
    device_id: claimed._id,
    location_id: claimed.location_id,
    claimed_by_user_id: claimed.security?.claimed_by_user_id || null,
    claimed_by_login_id: claimed.security?.claimed_by_login_id || null,
    claimed_by_name: claimed.security?.claimed_by_name || null,
    claimed_at: claimed.security?.claimed_at || null
  };
}

function createProvisionProfile({ deviceId, authContext, ipAddress }) {
  const { device } = getDeviceWithAccess(deviceId, authContext);
  const claimed = ensureClaimOwnership(device, authContext, ipAddress);

  const ttlHours = Number.isFinite(Number(env.deviceTokenTtlHours))
    ? Math.max(1, Number(env.deviceTokenTtlHours))
    : 720;
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + (ttlHours * 60 * 60 * 1000));
  const token = `fg_${crypto.randomBytes(24).toString('base64url')}`;

  const updated = deviceRepository.setDeviceToken(claimed._id, token, expiresAt.toISOString(), authContext.user);
  const cloud = buildCloudInfo(claimed._id);

  auditService.writeAuditLog({
    locationId: claimed.location_id,
    eventType: 'DEVICE_PROVISION_TOKEN_ISSUED',
    performedBy: authContext.user._id,
    loginId: authContext.user.login_id,
    sessionId: authContext.session?._id || null,
    deviceName: claimed._id,
    ipAddress,
    details: {
      token_expires_at: expiresAt.toISOString(),
      token_hint: updated?.security?.token_hint || null
    }
  });

  return {
    device_id: claimed._id,
    location_id: claimed.location_id,
    claimed_by_user_id: claimed.security?.claimed_by_user_id || null,
    claimed_by_name: claimed.security?.claimed_by_name || null,
    token_expires_at: expiresAt.toISOString(),
    device_key: token,
    device_token: token,
    cloud: {
      ...cloud,
      mqtt: {
        ...cloud.mqtt,
        password: token
      }
    }
  };
}

function registerDeviceWithProvisionKey({ deviceId, provisionKey, ipAddress }) {
  assertProvisionKey(provisionKey);
  const normalizedDeviceId = String(deviceId || '').trim().toUpperCase();
  if (!normalizedDeviceId) {
    throw notFound('Device not found');
  }

  let device = deviceRepository.findById(normalizedDeviceId);
  if (!device) {
    // Provision key is valid — auto-register this new device
    device = deviceRepository.createDevice({ device_id: normalizedDeviceId, location_id: null });
  }

  const ttlHours = Number.isFinite(Number(env.deviceTokenTtlHours))
    ? Math.max(1, Number(env.deviceTokenTtlHours))
    : 720;
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + (ttlHours * 60 * 60 * 1000));
  const deviceKey = `fgk_${crypto.randomBytes(24).toString('base64url')}`;
  const updated = deviceRepository.setDeviceToken(device._id, deviceKey, expiresAt.toISOString(), null);
  const cloud = buildCloudInfo(device._id);

  auditService.writeAuditLog({
    locationId: device.location_id,
    eventType: 'DEVICE_KEY_ISSUED_BY_PROVISION_KEY',
    performedBy: 'device_register',
    loginId: 'device_register',
    sessionId: null,
    deviceName: device._id,
    ipAddress,
    details: {
      token_expires_at: expiresAt.toISOString(),
      token_hint: updated?.security?.token_hint || null
    }
  });

  return {
    device_id: device._id,
    location_id: device.location_id,
    token_expires_at: expiresAt.toISOString(),
    device_key: deviceKey,
    device_token: deviceKey,
    cloud: {
      ...cloud,
      mqtt: {
        ...cloud.mqtt,
        auth_mode: 'device_key',
        password: deviceKey
      }
    }
  };
}

module.exports = {
  claimDevice,
  createProvisionProfile,
  registerDeviceWithProvisionKey
};
