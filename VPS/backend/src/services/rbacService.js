const { PERMISSIONS } = require('../config/permissions');
const { forbidden } = require('../utils/errors');

function hasPermission(role, permissionName) {
  const allowedRoles = PERMISSIONS[permissionName];
  if (!allowedRoles) {
    return false;
  }
  return allowedRoles.has(role);
}

function assertPermission(role, permissionName, message) {
  if (!hasPermission(role, permissionName)) {
    throw forbidden(message || `Permission denied: ${permissionName}`);
  }
}

module.exports = {
  hasPermission,
  assertPermission
};
