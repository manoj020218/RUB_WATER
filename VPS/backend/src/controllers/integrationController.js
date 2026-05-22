const headOfficeIntegrationService = require('../services/headOfficeIntegrationService');
const auditService = require('../services/auditService');

function listSettings(req, res, next) {
  try {
    const data = headOfficeIntegrationService.listSettings({
      authContext: req.auth
    });
    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

function upsertSetting(req, res, next) {
  try {
    const data = headOfficeIntegrationService.upsertSetting({
      payload: req.body,
      authContext: req.auth,
      ipAddress: req.ip,
      auditService
    });
    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

function listDeliveryLogs(req, res, next) {
  try {
    const data = headOfficeIntegrationService.listDeliveryLogs({
      authContext: req.auth,
      departmentId: req.query.department_id
    });
    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

function listLocations(req, res, next) {
  try {
    const data = headOfficeIntegrationService.listIntegrationLocations(req.integrationContext.setting);
    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

function getLocationLive(req, res, next) {
  try {
    const data = headOfficeIntegrationService.buildLocationLive(
      req.integrationContext.setting,
      req.params.locationId
    );
    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

function getLocationIncidents(req, res, next) {
  try {
    const data = headOfficeIntegrationService.listLocationIncidents(
      req.integrationContext.setting,
      req.params.locationId
    );
    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

function getLocationAuditLogs(req, res, next) {
  try {
    const data = headOfficeIntegrationService.listLocationAuditLogs(
      req.integrationContext.setting,
      req.params.locationId
    );
    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

function getDeviceStatus(req, res, next) {
  try {
    const data = headOfficeIntegrationService.getDeviceStatus(
      req.integrationContext.setting,
      req.params.deviceId
    );
    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

function getSummary(req, res, next) {
  try {
    const data = headOfficeIntegrationService.buildSummary(req.integrationContext.setting);
    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listSettings,
  upsertSetting,
  listDeliveryLogs,
  listLocations,
  getLocationLive,
  getLocationIncidents,
  getLocationAuditLogs,
  getDeviceStatus,
  getSummary
};
