const monitoringService = require('../services/monitoringService');
const deviceService = require('../services/deviceService');
const incidentService = require('../services/incidentService');
const auditService = require('../services/auditService');

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
    const data = auditService.listAuditLogs(req.query.location_id || null);
    res.json({ ok: true, data });
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
