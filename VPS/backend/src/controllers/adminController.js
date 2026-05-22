const bcrypt = require('bcryptjs');
const retentionService = require('../services/retentionService');
const adminUserService = require('../services/adminUserService');
const { assertPermission } = require('../services/rbacService');
const locationRepo = require('../repositories/locationRepository');
const deviceRepo = require('../repositories/deviceRepository');
const userRepo = require('../repositories/userRepository');
const { dataStore } = require('../db/datastore');

function requireSuperAdmin(req) {
  const role = String(req.auth?.user?.role || '').toUpperCase();
  if (!['VENDOR_SUPER_ADMIN', 'DEPARTMENT_SUPER_ADMIN'].includes(role)) {
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

async function resetUserPassword(req, res, next) {
  try {
    requireSuperAdmin(req);
    const user = userRepo.findById(req.params.userId);
    if (!user) { res.status(404).json({ ok: false, error: 'User not found' }); return; }
    const newPassword = String(req.body?.new_password || '').trim();
    if (newPassword.length < 6) {
      res.status(400).json({ ok: false, error: 'Password must be at least 6 characters' });
      return;
    }
    const hash = await bcrypt.hash(newPassword, 10);
    userRepo.update(user._id, { password_hash: hash, updated_at: new Date().toISOString() });
    res.json({ ok: true, message: 'Password reset successfully' });
  } catch (error) { next(error); }
}

// ── Locations ─────────────────────────────────────────────────────────────────
function listAllLocations(req, res, next) {
  try {
    requireSuperAdmin(req);
    const locations = locationRepo.listAll().map((loc) => {
      const device = deviceRepo.findByLocation(loc._id);
      return { ...loc, location_id: loc._id, location_name: loc.name, bound_device_id: device?._id || null };
    });
    res.json({ ok: true, data: locations });
  } catch (error) { next(error); }
}

function createLocation(req, res, next) {
  try {
    requireSuperAdmin(req);
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
    res.status(201).json({ ok: true, data: { ...loc, location_id: loc._id, location_name: loc.name } });
  } catch (error) { next(error); }
}

function updateLocation(req, res, next) {
  try {
    requireSuperAdmin(req);
    const loc = locationRepo.findById(req.params.locationId);
    if (!loc) { res.status(404).json({ ok: false, error: 'Location not found' }); return; }
    const patch = {};
    if (req.body?.location_name != null) patch.name = String(req.body.location_name).trim();
    if (req.body?.description != null) patch.description = String(req.body.description).trim();
    if (req.body?.sensor_mount_height_mm != null) patch.sensor_mount_height_mm = Number(req.body.sensor_mount_height_mm);
    patch.updated_at = new Date().toISOString();
    const updated = locationRepo.update(req.params.locationId, patch);
    res.json({ ok: true, data: { ...updated, location_id: updated._id, location_name: updated.name } });
  } catch (error) { next(error); }
}

// ── Devices ───────────────────────────────────────────────────────────────────
function listAllDevices(req, res, next) {
  try {
    requireSuperAdmin(req);
    const devices = deviceRepo.listAll().map((d) => ({
      device_id: d._id,
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
    const device = deviceRepo.findByLocation(locationId);
    if (!device) { res.status(404).json({ ok: false, error: 'No device bound to this location' }); return; }
    deviceRepo.unbindFromLocation(device._id);
    res.json({ ok: true, data: { unbound_device_id: device._id, location_id: locationId } });
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
  resetUserPassword,
  listAllLocations,
  createLocation,
  updateLocation,
  listAllDevices,
  createDevice,
  bindDevice,
  unbindDevice
};
