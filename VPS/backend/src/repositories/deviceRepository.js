const crypto = require('crypto');
const { dataStore } = require('../db/datastore');

const HARDWARE_REBINDABLE_STATES = new Set(['FAULTY', 'UNDER_REPLACEMENT', 'PENDING_VERIFICATION', 'REPLACED']);

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

function normalizeDeviceId(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeHardwareId(value) {
  return String(value || '').trim().toUpperCase();
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

function ensureIdentity(device) {
  if (!device) {
    return null;
  }
  if (!Array.isArray(device.device_id_history)) {
    device.device_id_history = [];
  }
  if (!Array.isArray(device.hardware_history)) {
    device.hardware_history = [];
  }
  if (!Object.prototype.hasOwnProperty.call(device, 'hardware_id')) {
    device.hardware_id = null;
  }
  if (!Object.prototype.hasOwnProperty.call(device, 'last_reported_device_id')) {
    device.last_reported_device_id = device._id || null;
  }
  if (!Object.prototype.hasOwnProperty.call(device, 'mqtt_route_id')) {
    device.mqtt_route_id = device.hardware_id || device._id || null;
  }
  if (!Object.prototype.hasOwnProperty.call(device, 'identity_updated_at')) {
    device.identity_updated_at = device.updated_at || device.created_at || new Date().toISOString();
  }
  device.mqtt_topic_base = `floodguard/${device.mqtt_route_id || device.hardware_id || device._id || ''}`.replace(/\/+$/, '');
  return device;
}

function materialize(device) {
  if (!device) {
    return null;
  }
  ensureSecurity(device);
  ensureLifecycle(device);
  ensureIdentity(device);
  return device;
}

function aliasMatches(device, lookup) {
  if (!device || !lookup) {
    return false;
  }
  return Array.isArray(device.device_id_history) && device.device_id_history.some((entry) => {
    if (typeof entry === 'string') {
      return normalizeDeviceId(entry) === lookup;
    }
    return normalizeDeviceId(entry?.device_id) === lookup;
  });
}

function listAll() {
  return dataStore.devices.map((item) => materialize(item));
}

function findById(deviceId) {
  const lookup = normalizeDeviceId(deviceId);
  if (!lookup) {
    return null;
  }
  const exact = dataStore.devices.find((item) => normalizeDeviceId(item._id) === lookup) || null;
  if (exact) {
    return materialize(exact);
  }
  const alias = dataStore.devices.find((item) => aliasMatches(item, lookup)) || null;
  return materialize(alias);
}

function findByLocation(locationId) {
  const lookup = String(locationId || '').trim();
  const device = dataStore.devices.find((item) => item.location_id === lookup) || null;
  return materialize(device);
}

function findByHardwareId(hardwareId) {
  const lookup = normalizeHardwareId(hardwareId);
  if (!lookup) {
    return null;
  }
  const device = dataStore.devices.find((item) => normalizeHardwareId(item.hardware_id) === lookup) || null;
  return materialize(device);
}

function findByRouteId(routeId) {
  const lookup = normalizeHardwareId(routeId);
  if (!lookup) {
    return null;
  }
  const device = dataStore.devices.find((item) => {
    const current = materialize(item);
    return normalizeHardwareId(current.mqtt_route_id) === lookup
      || normalizeHardwareId(current.hardware_id) === lookup
      || normalizeDeviceId(current._id) === lookup
      || aliasMatches(current, lookup);
  }) || null;
  return materialize(device);
}

function resolveByIdentity({ deviceId = null, hardwareId = null, routeId = null } = {}) {
  return findByHardwareId(hardwareId)
    || findByRouteId(routeId)
    || findById(deviceId)
    || null;
}

function updateRuntime(deviceId, patch) {
  const device = findById(deviceId);
  if (!device) {
    return null;
  }
  Object.assign(device, patch);
  device.updated_at = new Date().toISOString();
  return materialize(device);
}

function updateOperationalStatus(deviceId, status, note = null) {
  const device = findById(deviceId);
  if (!device) {
    return null;
  }
  device.operational_status = String(status || '').trim().toUpperCase() || device.operational_status;
  device.lifecycle_note = note || null;
  device.lifecycle_updated_at = new Date().toISOString();
  return materialize(device);
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
  return materialize(device);
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
  return materialize(device);
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
  const deviceId = normalizeDeviceId(data.device_id);
  const hardwareId = normalizeHardwareId(data.hardware_id);
  if (!deviceId) throw new Error('Device ID is required');
  if (findById(deviceId)) {
    throw new Error(`Device ${deviceId} already exists`);
  }
  if (hardwareId) {
    const existingHardware = findByHardwareId(hardwareId);
    if (existingHardware) {
      throw new Error(`Hardware ${hardwareId} is already bound to ${existingHardware._id}`);
    }
  }
  const now = new Date().toISOString();
  const routeId = hardwareId || deviceId;
  const device = {
    _id: deviceId,
    location_id: String(data.location_id || '').trim() || null,
    device_type: String(data.device_type || 'ESP32_S3').trim(),
    firmware_version: 'unknown',
    hardware_version: 'unknown',
    hardware_id: hardwareId || null,
    mqtt_route_id: routeId,
    mqtt_topic_base: `floodguard/${routeId}`,
    last_reported_device_id: deviceId,
    device_id_history: [],
    hardware_history: [],
    identity_updated_at: now,
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
  return materialize(device);
}

function bindToLocation(deviceId, locationId) {
  const device = findById(deviceId);
  if (!device) return null;
  device.location_id = String(locationId || '').trim();
  device.updated_at = new Date().toISOString();
  return materialize(device);
}

function unbindFromLocation(deviceId) {
  const device = findById(deviceId);
  if (!device) return null;
  device.location_id = null;
  device.updated_at = new Date().toISOString();
  return materialize(device);
}

function isHardwareRebindAllowed(device, incomingHardwareId) {
  const normalized = normalizeHardwareId(incomingHardwareId);
  if (!device || !normalized) {
    return false;
  }
  const current = normalizeHardwareId(device.hardware_id);
  if (!current || current === normalized) {
    return true;
  }
  return HARDWARE_REBINDABLE_STATES.has(String(device.operational_status || 'ACTIVE').trim().toUpperCase());
}

function bindHardware(deviceId, hardwareId, options = {}) {
  const device = findById(deviceId);
  if (!device) {
    return null;
  }
  const normalized = normalizeHardwareId(hardwareId);
  if (!normalized) {
    return materialize(device);
  }
  const existingOwner = dataStore.devices.find((item) =>
    item !== device && normalizeHardwareId(item.hardware_id) === normalized) || null;
  if (existingOwner) {
    throw new Error(`Hardware ${normalized} is already bound to ${existingOwner._id}`);
  }
  const now = new Date().toISOString();
  const current = normalizeHardwareId(device.hardware_id);
  if (current && current !== normalized) {
    device.hardware_history.push({
      hardware_id: current,
      unbound_at: now,
      reason: options.reason || 'hardware_rebound'
    });
  }
  device.hardware_id = normalized;
  device.mqtt_route_id = normalized;
  device.mqtt_topic_base = `floodguard/${normalized}`;
  device.identity_updated_at = now;
  device.updated_at = now;
  if (options.reportedDeviceId) {
    device.last_reported_device_id = normalizeDeviceId(options.reportedDeviceId) || device._id;
  }
  return materialize(device);
}

function renameReferences(previousId, nextId) {
  const updateDeviceIdField = (collectionName) => {
    dataStore[collectionName].forEach((item) => {
      if (normalizeDeviceId(item.device_id) === previousId) {
        item.device_id = nextId;
      }
      if (item.details && typeof item.details === 'object' && normalizeDeviceId(item.details.device_id) === previousId) {
        item.details.device_id = nextId;
      }
      if (item.payload && typeof item.payload === 'object' && normalizeDeviceId(item.payload.device_id) === previousId) {
        item.payload.device_id = nextId;
      }
    });
  };

  [
    'telemetry',
    'incidents',
    'auditLogs',
    'complaints',
    'notifications',
    'deviceLifecycleHistory',
    'commands',
    'deviceConfigs',
    'deviceConfigHistory'
  ].forEach(updateDeviceIdField);
}

function renameDevice(currentDeviceId, nextDeviceId, options = {}) {
  const device = findById(currentDeviceId);
  if (!device) {
    return null;
  }
  const previousId = normalizeDeviceId(device._id);
  const nextId = normalizeDeviceId(nextDeviceId);
  if (!nextId) {
    throw new Error('Next device ID is required');
  }
  if (previousId === nextId) {
    return materialize(device);
  }
  const existing = dataStore.devices.find((item) => normalizeDeviceId(item._id) === nextId);
  if (existing && existing !== device) {
    throw new Error(`Device ${nextId} already exists`);
  }

  const now = new Date().toISOString();
  device.device_id_history.push({
    device_id: previousId,
    changed_at: now,
    reason: options.reason || 'device_id_rename'
  });
  device._id = nextId;
  device.last_reported_device_id = nextId;
  if (!device.hardware_id) {
    device.mqtt_route_id = nextId;
    device.mqtt_topic_base = `floodguard/${nextId}`;
  }
  device.identity_updated_at = now;
  device.updated_at = now;

  renameReferences(previousId, nextId);
  return materialize(device);
}

module.exports = {
  normalizeDeviceId,
  normalizeHardwareId,
  listAll,
  findById,
  findByLocation,
  findByHardwareId,
  findByRouteId,
  resolveByIdentity,
  updateRuntime,
  updateOperationalStatus,
  claimDevice,
  setDeviceToken,
  verifyDeviceToken,
  getClaimInfo,
  createDevice,
  bindToLocation,
  unbindFromLocation,
  isHardwareRebindAllowed,
  bindHardware,
  renameDevice
};
