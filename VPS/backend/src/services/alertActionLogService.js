const { v4: uuidv4 } = require('uuid');
const alertActionLogRepository = require('../repositories/alertActionLogRepository');

function createAlertActionLog({
  locationId,
  deviceId,
  hardwareId = null,
  alertLevel,
  alertStatus,
  waterLevelMm,
  sensorSource,
  actionSheetVersion,
  relayActionsApplied,
  triggeredBy,
  timestamp,
  userId = null
}) {
  if (!locationId || !deviceId || !alertLevel || !alertStatus) {
    return null;
  }
  return alertActionLogRepository.insert({
    _id: `aact_${uuidv4().replace(/-/g, '').slice(0, 12)}`,
    location_id: locationId,
    site_id: locationId,
    device_id: deviceId,
    hardware_id: hardwareId || null,
    alert_level: String(alertLevel).toUpperCase(),
    alert_status: String(alertStatus).toUpperCase(),
    water_level_mm: Number(waterLevelMm || 0),
    sensor_source: sensorSource || 'NONE',
    action_sheet_version: Number(actionSheetVersion || 0) || null,
    relay_actions_applied: Array.isArray(relayActionsApplied) ? relayActionsApplied : [],
    triggered_by: String(triggeredBy || 'AUTO').toUpperCase(),
    user_id: userId || null,
    timestamp: timestamp || new Date().toISOString()
  });
}

function listAlertActionLogs(locationId = null) {
  return alertActionLogRepository.listByLocation(locationId);
}

module.exports = {
  createAlertActionLog,
  listAlertActionLogs
};
