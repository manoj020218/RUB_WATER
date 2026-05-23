const monitoringService = require('../services/monitoringService');
const deviceService = require('../services/deviceService');
const incidentService = require('../services/incidentService');
const auditService = require('../services/auditService');
const { listAccessibleLocationIds, assertUserLocationAccess } = require('../services/accessService');

function listLocations(req, res, next) {
  try {
    const data = monitoringService.listUserLocations(req.auth);
    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

function getLocationDashboard(req, res, next) {
  try {
    const data = deviceService.getLocationDashboard(req.params.locationId);
    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

function listIncidents(req, res, next) {
  try {
    const data = incidentService.listIncidents(req.query.location_id || null);
    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

function listAuditLogs(req, res, next) {
  try {
    const locationId = req.query.location_id || null;
    if (locationId) {
      assertUserLocationAccess(req.auth.user, locationId);
    }
    const data = auditService.listAuditLogs(locationId);
    const accessibleIds = new Set(listAccessibleLocationIds(req.auth.user));
    const filtered = data.filter((log) => !log.location_id || accessibleIds.has(log.location_id));
    res.json({ ok: true, data: filtered });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listLocations,
  getLocationDashboard,
  listIncidents,
  listAuditLogs
};
