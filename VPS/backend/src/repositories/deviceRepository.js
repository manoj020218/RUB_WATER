const crypto = require('crypto');
const { dataStore } = require('../db/datastore');

function hashToken(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function safeEqualsHex(leftHex, rightHex) {
  if (!leftHex || !rightHex) {
    return false;
  }
  const left = Buffer.from(String(leftHex), 'hex');
  const right = Buffer.from(String(rightHex), 'hex');
  if (left.length === 0 || right.length === 0 || left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function ensureSecurity(device) {
  if (!device) {
    return null;
  }
  if (!device.security || typeof device.security !== 'object') {
    device.security = {
      claimed_by_user_id: null,
      claimed_by_login_id: null,
      claimed_by_name: null,
      claimed_at: null,
      token_hash: null,
      token_hint: null,
      token_issued_at: null,
      token_expires_at: null,
      token_issued_by: null
    };
  }
  return device.security;
}

function ensureLifecycle(device) {
  if (!device) {
    return null;
  }
  if (!device.operational_status) {
    device.operational_status = 'ACTIVE';
  }
  if (!device.lifecycle_updated_at) {
    device.lifecycle_updated_at = new Date().toISOString();
  }
  if (!Object.prototype.hasOwnProperty.call(device, 'lifecycle_note')) {
    device.lifecycle_note = null;
  }
  return device;
}

function listAll() {
  return dataStore.devices.map((item) => {
    ensureSecurity(item);
    ensureLifecycle(item);
    return item;
  });
}

function findById(deviceId) {
  const lookup = String(deviceId || '').trim().toUpperCase();
  const device = dataStore.devices.find((item) => String(item._id || '').toUpperCase() === lookup) || null;
  if (!device) {
    return null;
  }
  ensureSecurity(device);
  ensureLifecycle(device);
  return device;
}

function findByLocation(locationId) {
  const device = dataStore.devices.find((item) => item.location_id === locationId) || null;
  if (!device) {
    return null;
  }
  ensureSecurity(device);
  ensureLifecycle(device);
  return device;
}

function updateRuntime(deviceId, patch) {
  const device = findById(deviceId);
  if (!device) {
    return null;
  }
  Object.assign(device, patch);
  return device;
}

function updateOperationalStatus(deviceId, status, note = null) {
  const device = findById(deviceId);
  if (!device) {
    return null;
  }
  device.operational_status = String(status || '').trim().toUpperCase() || device.operational_status;
  device.lifecycle_note = note || null;
  device.lifecycle_updated_at = new Date().toISOString();
  return device;
}

function claimDevice(deviceId, user) {
  const device = findById(deviceId);
  if (!device) {
    return null;
  }
  const security = ensureSecurity(device);
  const now = new Date().toISOString();
  security.claimed_by_user_id = user?._id || null;
  security.claimed_by_login_id = user?.login_id || null;
  security.claimed_by_name = user?.name || null;
  security.claimed_at = now;
  return device;
}

function setDeviceToken(deviceId, tokenPlainText, expiresAtIso, user) {
  const device = findById(deviceId);
  if (!device) {
    return null;
  }
  const security = ensureSecurity(device);
  const now = new Date().toISOString();
  const normalized = String(tokenPlainText || '').trim();
  security.token_hash = normalized ? hashToken(normalized) : null;
  security.token_hint = normalized ? normalized.slice(-6) : null;
  security.token_issued_at = now;
  security.token_expires_at = expiresAtIso || null;
  security.token_issued_by = user?._id || null;
  return device;
}

function verifyDeviceToken(deviceId, tokenPlainText) {
  const device = findById(deviceId);
  if (!device) {
    return false;
  }
  const security = ensureSecurity(device);
  if (!security.token_hash) {
    return false;
  }

  if (security.token_expires_at) {
    const expiresAt = new Date(security.token_expires_at).getTime();
    if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
      return false;
    }
  }

  const hash = hashToken(String(tokenPlainText || '').trim());
  return safeEqualsHex(security.token_hash, hash);
}

function getClaimInfo(deviceId) {
  const device = findById(deviceId);
  if (!device) {
    return null;
  }
  const security = ensureSecurity(device);
  return {
    claimed_by_user_id: security.claimed_by_user_id || null,
    claimed_by_login_id: security.claimed_by_login_id || null,
    claimed_by_name: security.claimed_by_name || null,
    claimed_at: security.claimed_at || null
  };
}

function createDevice(data) {
  const deviceId = String(data.device_id || '').trim().toUpperCase();
  if (!deviceId) throw new Error('Device ID is required');
  if (dataStore.devices.find((d) => d._id === deviceId)) {
    throw new Error(`Device ${deviceId} already exists`);
  }
  const now = new Date().toISOString();
  const device = {
    _id: deviceId,
    location_id: String(data.location_id || '').trim() || null,
    device_type: String(data.device_type || 'ESP32_S3').trim(),
    firmware_version: 'unknown',
    hardware_version: 'unknown',
    mqtt_topic_base: `rub/${deviceId}`,
    operational_status: 'ACTIVE',
    lifecycle_note: null,
    lifecycle_updated_at: now,
    last_seen: null,
    status: 'OFFLINE',
    created_at: now,
    updated_at: now,
    config: { daily_reboot_enabled: true, daily_reboot_time: '03:30', timezone: 'Asia/Kolkata', reporting_profile: 'dynamic' }
  };
  dataStore.devices.push(device);
  ensureSecurity(device);
  ensureLifecycle(device);
  return device;
}

function bindToLocation(deviceId, locationId) {
  const device = findById(deviceId);
  if (!device) return null;
  device.location_id = String(locationId || '').trim();
  device.updated_at = new Date().toISOString();
  return device;
}

function unbindFromLocation(deviceId) {
  const device = findById(deviceId);
  if (!device) return null;
  device.location_id = null;
  device.updated_at = new Date().toISOString();
  return device;
}

module.exports = {
  listAll,
  findById,
  findByLocation,
  updateRuntime,
  updateOperationalStatus,
  claimDevice,
  setDeviceToken,
  verifyDeviceToken,
  getClaimInfo,
  createDevice,
  bindToLocation,
  unbindFromLocation
};
