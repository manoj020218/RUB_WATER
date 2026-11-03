// Location ID rename.
//
// A location's _id is referenced everywhere: users' assigned_location_ids, the
// bound device, configs, telemetry, incidents, complaints, audit logs, ...
// Renaming it by "create new + move device + delete old" (what older app builds
// do) leaves all of those pointing at a location that no longer exists, so users
// silently lose access and history is orphaned. This service rewrites every
// reference in one step.

const { dataStore } = require('../db/datastore');
const locationRepository = require('../repositories/locationRepository');
const auditService = require('./auditService');
const { assertUserLocationAccess } = require('./accessService');
const { badRequest, notFound } = require('../utils/errors');

// Collections never holding location references we must rewrite.
const SKIP_COLLECTIONS = new Set(['locations']);
const MAX_DEPTH = 3;

function normalizeLocationId(value) {
  return String(value || '').trim().toUpperCase();
}

function isLocationScalarKey(key) {
  return key === 'location_id' || key.endsWith('_location_id');
}

function isLocationArrayKey(key) {
  return key === 'location_ids' || key.endsWith('_location_ids');
}

function rewriteValue(obj, oldId, newId, depth, counter) {
  if (!obj || typeof obj !== 'object' || depth > MAX_DEPTH) return;
  Object.keys(obj).forEach((key) => {
    const value = obj[key];
    if (typeof value === 'string' && value === oldId && isLocationScalarKey(key)) {
      obj[key] = newId;
      counter.count += 1;
    } else if (Array.isArray(value) && isLocationArrayKey(key)) {
      if (value.includes(oldId)) {
        obj[key] = [...new Set(value.map((item) => (item === oldId ? newId : item)))];
        counter.count += 1;
      }
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      rewriteValue(value, oldId, newId, depth + 1, counter);
    }
  });
}

/**
 * Rewrites every reference to `oldId` into `newId` across the data store
 * (the location record itself is not touched). Returns per-collection counts.
 */
function migrateLocationReferences(oldId, newId) {
  const summary = {};
  Object.keys(dataStore).forEach((collection) => {
    if (SKIP_COLLECTIONS.has(collection) || !Array.isArray(dataStore[collection])) return;
    const counter = { count: 0 };
    dataStore[collection].forEach((record) => rewriteValue(record, oldId, newId, 0, counter));
    if (counter.count > 0) summary[collection] = counter.count;
  });
  return summary;
}

function renameLocationId({ locationId, newLocationId, authContext, ipAddress }) {
  const oldId = String(locationId || '').trim();
  const newId = normalizeLocationId(newLocationId);
  if (!newId) throw badRequest('new_location_id is required');

  const location = locationRepository.findById(oldId);
  if (!location) throw notFound('Location not found');
  assertUserLocationAccess(authContext.user, oldId);

  if (newId === oldId) {
    return { location_id: oldId, previous_location_id: oldId, migrated: {} };
  }
  if (locationRepository.findById(newId)) {
    throw badRequest(`Location ${newId} already exists`);
  }

  const migrated = migrateLocationReferences(oldId, newId);
  location._id = newId;
  location.previous_location_ids = [...new Set([...(location.previous_location_ids || []), oldId])];
  location.updated_at = new Date().toISOString();

  auditService.writeAuditLog({
    locationId: newId,
    eventType: 'LOCATION_ID_RENAMED',
    performedBy: authContext.user._id,
    loginId: authContext.user.login_id,
    sessionId: authContext.session?._id,
    deviceName: authContext.session?.device_name,
    ipAddress,
    details: { previous_location_id: oldId, location_id: newId, migrated }
  });

  return { location_id: newId, previous_location_id: oldId, migrated };
}

// Old app builds rename by: create NEW, bind device to NEW, delete OLD.
// If OLD is being deleted, its device was just moved to a location created a
// few minutes ago, treat it as a rename so access and history follow.
const LEGACY_RENAME_WINDOW_MS = 15 * 60 * 1000;

function detectLegacyRenameTarget(deletedLocationId, nowMs = Date.now()) {
  const moved = dataStore.devices.find((device) => device.previous_location_id === deletedLocationId
    && device.location_id && device.location_id !== deletedLocationId);
  if (!moved) return null;
  const target = locationRepository.findById(moved.location_id);
  if (!target || !target.created_at) return null;
  const movedAt = moved.location_moved_at ? Date.parse(moved.location_moved_at) : 0;
  const createdAt = Date.parse(target.created_at);
  if (nowMs - createdAt > LEGACY_RENAME_WINDOW_MS || nowMs - movedAt > LEGACY_RENAME_WINDOW_MS) return null;
  return target._id;
}

module.exports = {
  normalizeLocationId,
  migrateLocationReferences,
  renameLocationId,
  detectLegacyRenameTarget
};
