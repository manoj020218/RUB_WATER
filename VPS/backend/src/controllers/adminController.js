const retentionService = require('../services/retentionService');
const adminUserService = require('../services/adminUserService');
const authService = require('../services/authService');
const locationTransferService = require('../services/locationTransferService');
const { assertUserLocationAccess, listAccessibleLocationIds } = require('../services/accessService');
const { assertPermission } = require('../services/rbacService');
const locationRepo = require('../repositories/locationRepository');
const deviceRepo = require('../repositories/deviceRepository');
const { dataStore } = require('../db/datastore');
const deviceConfigRepo = require('../repositories/deviceConfigRepository');

function requireSuperAdmin(req) {
  const role = String(req.auth?.user?.role || '').toUpperCase();
  if (!['VENDOR_SUPER_ADMIN', 'DEPARTMENT_SUPER_ADMIN', 'DEMO_SUPER_ADMIN'].includes(role)) {
    const err = new Error('Super admin access required');
    err.statusCode = 403;
    throw err;
  }
}

// ── Retention ────────────────────────────────────────────────────────────────
function runNoWaterCompaction(req, res, next) {
  try {
    assertPermission(req.auth.user.role, 'RUN_ADMIN_JOB');
    const result = retentionService.runNoWaterCompaction({ hours: req.body?.hours });
    res.json({ ok: true, data: result });
  } catch (error) { next(error); }
}

// ── Users ─────────────────────────────────────────────────────────────────────
function listUsers(req, res, next) {
  try {
    const data = adminUserService.listManagedUsers(req.auth);
    res.json({ ok: true, data });
  } catch (error) { next(error); }
}

async function createUser(req, res, next) {
  try {
    const data = await adminUserService.createManagedUser({
      loginId: req.body?.login_id,
      password: req.body?.password,
      name: req.body?.name,
      role: req.body?.role,
      assignedLocationIds: req.body?.assigned_locations || req.body?.assigned_location_ids,
      vendorId: req.body?.vendor_id,
      departmentId: req.body?.department_id,
      isActive: req.body?.is_active,
      authContext: req.auth,
      ipAddress: req.ip
    });
    res.status(201).json({ ok: true, data });
  } catch (error) { next(error); }
}

function updateUserLocations(req, res, next) {
  try {
    const data = adminUserService.updateManagedUserLocations({
      userId: req.params.userId,
      locationIds: req.body?.location_ids,
      authContext: req.auth,
      ipAddress: req.ip
    });
    res.json({ ok: true, data });
  } catch (error) { next(error); }
}

function setUserAccess(req, res, next) {
  try {
    const data = adminUserService.setManagedUserAccess({
      userId: req.params.userId,
      isActive: req.body?.is_active,
      reason: req.body?.reason,
      authContext: req.auth,
      ipAddress: req.ip
    });
    res.json({ ok: true, data });
  } catch (error) { next(error); }
}

async function transferLocation(req, res, next) {
  try {
    requireSuperAdmin(req);
    const data = await locationTransferService.runLocationTransfer({
      locationId: req.body?.location_id || req.body?.locationId,
      senderUserId: req.body?.sender_user_id,
      senderLoginId: req.body?.sender_login_id,
      receiverUserId: req.body?.receiver_user_id,
      receiverLoginId: req.body?.receiver_login_id,
      rights: req.body?.rights,
      createReceiver: req.body?.create_receiver,
      authContext: req.auth,
      ipAddress: req.ip
    });
    res.json({ ok: true, data });
  } catch (error) { next(error); }
}

async function resetUserPassword(req, res, next) {
  try {
    requireSuperAdmin(req);
    const data = await authService.resetUserPassword({
      authContext: req.auth,
      targetUserId: req.params.userId,
      newPassword: req.body?.new_password
    });
    res.json({ ok: true, data });
  } catch (error) { next(error); }
}

// ── Locations ─────────────────────────────────────────────────────────────────
function listAllLocations(req, res, next) {
  try {
    requireSuperAdmin(req);
    const user = req.auth.user;
    let allLocs = locationRepo.listAll();
    if (user.role !== 'VENDOR_SUPER_ADMIN') {
      const allowed = new Set(listAccessibleLocationIds(user));
      allLocs = allLocs.filter((l) => allowed.has(l._id));
    }
    const locations = allLocs.map((loc) => {
      const device = deviceRepo.findByLocation(loc._id);
      return { ...loc, location_id: loc._id, location_name: loc.name, bound_device_id: device?._id || null };
    });
    res.json({ ok: true, data: locations });
  } catch (error) { next(error); }
}

function createLocation(req, res, next) {
  try {
    requireSuperAdmin(req);
    const actor = req.auth.user;
    const loc = locationRepo.create({
      location_id: req.body?.location_id,
      location_name: req.body?.location_name,
      description: req.body?.description,
      department_id: req.body?.department_id,
      sensor_mount_height_mm: req.body?.sensor_mount_height_mm,
      alert_level_mm: req.body?.alert_level_mm,
      danger_level_mm: req.body?.danger_level_mm,
      danger_clear_level_mm: req.body?.danger_clear_level_mm
    });
    if (actor.role !== 'VENDOR_SUPER_ADMIN') {
      const assigned = Array.isArray(actor.assigned_location_ids) ? actor.assigned_location_ids : [];
      if (!assigned.includes(loc._id)) {
        actor.assigned_location_ids = [...assigned, loc._id];
      }
    }
    res.status(201).json({ ok: true, data: { ...loc, location_id: loc._id, location_name: loc.name } });
  } catch (error) { next(error); }
}

function updateLocation(req, res, next) {
  try {
    requireSuperAdmin(req);
    const loc = locationRepo.findById(req.params.locationId);
    if (!loc) { res.status(404).json({ ok: false, error: 'Location not found' }); return; }
    assertUserLocationAccess(req.auth.user, loc._id);
    const patch = {};
    if (req.body?.location_name != null) patch.name = String(req.body.location_name).trim();
    if (req.body?.description != null) patch.description = String(req.body.description).trim();
    if (req.body?.sensor_mount_height_mm != null) patch.sensor_mount_height_mm = Number(req.body.sensor_mount_height_mm);
    patch.updated_at = new Date().toISOString();
    const updated = locationRepo.update(req.params.locationId, patch);
    res.json({ ok: true, data: { ...updated, location_id: updated._id, location_name: updated.name } });
  } catch (error) { next(error); }
}

function deleteLocation(req, res, next) {
  try {
    requireSuperAdmin(req);
    const locationId = req.params.locationId;
    const loc = locationRepo.findById(locationId);
    if (!loc) { res.status(404).json({ ok: false, error: 'Location not found' }); return; }
    assertUserLocationAccess(req.auth.user, locationId);
    const boundDevice = deviceRepo.findByLocation(locationId);
    if (boundDevice) {
      deviceRepo.unbindFromLocation(boundDevice._id);
    }
    locationRepo.remove(locationId);
    res.json({ ok: true, data: { deleted_location_id: locationId, unbound_device_id: boundDevice?._id || null } });
  } catch (error) { next(error); }
}

// ── Devices ───────────────────────────────────────────────────────────────────
function listAllDevices(req, res, next) {
  try {
    requireSuperAdmin(req);
    const user = req.auth.user;
    let allDevices = deviceRepo.listAll();
    if (user.role !== 'VENDOR_SUPER_ADMIN') {
      const allowed = new Set(listAccessibleLocationIds(user));
      allDevices = allDevices.filter((d) => d.location_id && allowed.has(d.location_id));
    }
    const devices = allDevices.map((d) => ({
      device_id: d._id,
      hardware_id: d.hardware_id || null,
      mqtt_route_id: d.mqtt_route_id || null,
      last_reported_device_id: d.last_reported_device_id || null,
      location_id: d.location_id,
      device_type: d.device_type,
      status: d.status,
      operational_status: d.operational_status,
      firmware_version: d.firmware_version,
      last_seen: d.last_seen,
      created_at: d.created_at
    }));
    res.json({ ok: true, data: devices });
  } catch (error) { next(error); }
}

function createDevice(req, res, next) {
  try {
    requireSuperAdmin(req);
    const locationId = String(req.body?.location_id || '').trim().toUpperCase() || null;
    if (locationId && !locationRepo.findById(locationId)) {
      res.status(400).json({ ok: false, error: `Location ${locationId} not found` });
      return;
    }
    if (locationId) {
      assertUserLocationAccess(req.auth.user, locationId);
    }
    const device = deviceRepo.createDevice({
      device_id: req.body?.device_id,
      device_type: req.body?.device_type,
      location_id: locationId
    });

    // Auto-create default config when location is set
    if (locationId) {
      _ensureDefaultConfig(device._id, locationId);
    }

    res.status(201).json({ ok: true, data: { device_id: device._id, location_id: device.location_id, device_type: device.device_type } });
  } catch (error) { next(error); }
}

// ── Device ↔ Location binding ─────────────────────────────────────────────────
function bindDevice(req, res, next) {
  try {
    requireSuperAdmin(req);
    const locationId = req.params.locationId;
    const deviceId = String(req.body?.device_id || '').trim().toUpperCase();
    if (!deviceId) { res.status(400).json({ ok: false, error: 'device_id is required' }); return; }

    const loc = locationRepo.findById(locationId);
    if (!loc) { res.status(404).json({ ok: false, error: 'Location not found' }); return; }
    assertUserLocationAccess(req.auth.user, locationId);

    let device = deviceRepo.findById(deviceId);
    if (!device) {
      // Auto-create the device if not registered yet (vendor may not have provisioned yet)
      device = deviceRepo.createDevice({ device_id: deviceId, location_id: locationId });
    } else {
      deviceRepo.bindToLocation(deviceId, locationId);
    }

    _ensureDefaultConfig(deviceId, locationId);

    res.json({ ok: true, data: { device_id: deviceId, location_id: locationId } });
  } catch (error) { next(error); }
}

function unbindDevice(req, res, next) {
  try {
    requireSuperAdmin(req);
    const locationId = req.params.locationId;
    assertUserLocationAccess(req.auth.user, locationId);
    const device = deviceRepo.findByLocation(locationId);
    if (!device) { res.status(404).json({ ok: false, error: 'No device bound to this location' }); return; }
    deviceRepo.unbindFromLocation(device._id);
    res.json({ ok: true, data: { unbound_device_id: device._id, location_id: locationId } });
  } catch (error) { next(error); }
}

// ── Device Configs overview ────────────────────────────────────────────────────
function listAllDeviceConfigs(req, res, next) {
  try {
    requireSuperAdmin(req);
    const allowed = new Set(listAccessibleLocationIds(req.auth.user));
    const configs = deviceConfigRepo.listAll()
      .filter((c) => req.auth.user.role === 'VENDOR_SUPER_ADMIN' || allowed.has(c.location_id))
      .map((c) => {
      const loc = locationRepo.findById(c.location_id);
      return {
        device_id: c.device_id,
        location_id: c.location_id,
        location_name: loc?.name || c.location_id,
        config_version: c.config_version,
        state: c.state,
        alert_level_mm: c.alert_level_mm,
        danger_level_mm: c.danger_level_mm,
        clear_level_mm: c.clear_level_mm,
        sensor_mount_height_mm: c.sensor_mount_height_mm,
        last_ack_status: c.last_ack_status,
        last_ack_at: c.last_ack_at,
        last_applied_at: c.last_applied_at
      };
    });
    res.json({ ok: true, data: configs });
  } catch (error) { next(error); }
}

function resetDeviceConfigToDefault(req, res, next) {
  try {
    requireSuperAdmin(req);
    const deviceId = String(req.params.deviceId || '').trim().toUpperCase();
    const device = deviceRepo.findById(deviceId);
    if (!device) { res.status(404).json({ ok: false, error: 'Device not found' }); return; }
    const locationId = device.location_id;
    if (!locationId) { res.status(400).json({ ok: false, error: 'Device is not bound to a location' }); return; }
    assertUserLocationAccess(req.auth.user, locationId);
    const loc = locationRepo.findById(locationId);
    const now = new Date().toISOString();
    const defaults = {
      alert_level_mm: loc?.alert_level_mm || 200,
      danger_level_mm: loc?.danger_level_mm || 500,
      clear_level_mm: loc?.danger_clear_level_mm || 450,
      trigger_delay_seconds: 60,
      clear_delay_seconds: 300,
      rs485_sensor_enabled: true,
      switch_sensor_enabled: true,
      switch_level_1_mm: 300,
      switch_level_2_mm: 500,
      sensor_mount_height_mm: loc?.sensor_mount_height_mm || 1200,
      mismatch_duration_seconds: 120
    };
    const existing = deviceConfigRepo.getCurrentByDevice(deviceId) || {};
    const updated = deviceConfigRepo.upsertCurrent(deviceId, {
      ...existing,
      ...defaults,
      device_id: deviceId,
      location_id: locationId,
      config_version: (existing.config_version || 0) + 1,
      state: 'ACTIVE',
      last_applied_at: now,
      last_applied_by: req.auth?.user?._id || 'admin_reset',
      last_ack_at: null,
      last_ack_status: null,
      last_ack_message: null
    });
    res.json({ ok: true, data: { device_id: deviceId, config_version: updated.config_version, ...defaults } });
  } catch (error) { next(error); }
}

// ── Internal helpers ──────────────────────────────────────────────────────────
function _ensureDefaultConfig(deviceId, locationId) {
  const existing = dataStore.deviceConfigs.find((c) => c.device_id === deviceId);
  if (existing) return;
  const loc = locationRepo.findById(locationId);
  const now = new Date().toISOString();
  const safeId = deviceId.toLowerCase().replace(/[^a-z0-9]/g, '_');
  dataStore.deviceConfigs.push({
    _id: `cfg_current_${safeId}`,
    device_id: deviceId,
    location_id: locationId,
    alert_level_mm: loc?.alert_level_mm || 200,
    danger_level_mm: loc?.danger_level_mm || 500,
    clear_level_mm: loc?.danger_clear_level_mm || 450,
    trigger_delay_seconds: 60,
    clear_delay_seconds: 300,
    rs485_sensor_enabled: true,
    switch_sensor_enabled: true,
    switch_level_1_mm: 300,
    switch_level_2_mm: 500,
    sensor_mount_height_mm: loc?.sensor_mount_height_mm || 1200,
    mismatch_duration_seconds: 120,
    config_version: 1,
    state: 'ACTIVE',
    last_applied_at: now,
    last_applied_by: 'admin_bind',
    last_ack_at: null,
    last_ack_status: null,
    last_ack_message: null
  });
}

module.exports = {
  runNoWaterCompaction,
  listUsers,
  createUser,
  setUserAccess,
  updateUserLocations,
  transferLocation,
  resetUserPassword,
  listAllLocations,
  createLocation,
  updateLocation,
  deleteLocation,
  listAllDevices,
  createDevice,
  bindDevice,
  unbindDevice,
  listAllDeviceConfigs,
  resetDeviceConfigToDefault
};
