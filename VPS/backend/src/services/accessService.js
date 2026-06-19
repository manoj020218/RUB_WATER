const { forbidden } = require('../utils/errors');
const { ROLE } = require('../config/permissions');
const locationRepository = require('../repositories/locationRepository');

function isVendorWideRole(role) {
  return role === ROLE.VENDOR_SUPER_ADMIN;
}

function hasUserLocationAccess(user, locationId) {
  if (!user || !locationId) {
    return false;
  }
  if (isVendorWideRole(user.role)) {
    return true;
  }
  const allowed = Array.isArray(user.assigned_location_ids) ? user.assigned_location_ids : [];
  return allowed.includes(locationId);
}

function listAccessibleLocationIds(user) {
  if (!user) {
    return [];
  }
  if (isVendorWideRole(user.role)) {
    return locationRepository.listAll().map((item) => item._id);
  }
  return Array.isArray(user.assigned_location_ids) ? [...new Set(user.assigned_location_ids)] : [];
}

function assertUserLocationAccess(user, locationId) {
  if (!user) {
    throw forbidden('User context missing');
  }
  if (!hasUserLocationAccess(user, locationId)) {
    throw forbidden('Location access denied');
  }
}

module.exports = {
  hasUserLocationAccess,
  listAccessibleLocationIds,
  assertUserLocationAccess
};
