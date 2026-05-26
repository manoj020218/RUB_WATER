const locationRepository = require('../repositories/locationRepository');
const deviceRepository = require('../repositories/deviceRepository');
const telemetryRepository = require('../repositories/telemetryRepository');
const complaintRepository = require('../repositories/complaintRepository');
const incidentService = require('./incidentService');
const { listAccessibleLocationIds } = require('./accessService');

// Heartbeat fires every 60 s; 3 missed = device is considered stale/offline
const STALE_THRESHOLD_MS = 3 * 60 * 1000;

function effectiveDeviceStatus(device) {
  if (!device) return 'UNMAPPED';
  if (device.status === 'OFFLINE') return 'OFFLINE';
  const lastHb = device.last_heartbeat ? new Date(device.last_heartbeat).getTime() : 0;
  if (Date.now() - lastHb > STALE_THRESHOLD_MS) return 'OFFLINE';
  return device.status || 'OFFLINE';
}

function listUserLocations(authContext) {
  const user = authContext.user;
  let locationIds = listAccessibleLocationIds(user);

  if (user.role === 'VENDOR_SUPER_ADMIN') {
    const allIds = new Set(locationIds);
    telemetryRepository.listAll().forEach((item) => {
      if (item.location_id) {
        allIds.add(item.location_id);
      }
    });
    locationIds = [...allIds];
  }

  const locations = locationRepository.listByIds(locationIds);
  return locations.map((location) => {
    const device = deviceRepository.findByLocation(location._id);
    const latestTelemetry = telemetryRepository
      .listByLocation(location._id)
      .filter((item) => item.type === 'TELEMETRY')
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0] || null;

    const activeIncident = incidentService.getActiveIncident(location._id);
    const openComplaintCount = complaintRepository.countOpenByLocation(location._id);
    const devStatus = effectiveDeviceStatus(device);
    // Location alarm status: from latest telemetry if available; fall back to
    // device connection status so "no telemetry after restart" doesn't show OFFLINE
    // when the device is actually heartbeating.
    let locationStatus;
    if (activeIncident) {
      locationStatus = 'DANGER';
    } else if (latestTelemetry) {
      locationStatus = latestTelemetry.status;
    } else {
      locationStatus = devStatus === 'ONLINE' ? 'NORMAL' : 'OFFLINE';
    }
    return {
      location_id: location._id,
      location_name: location.name,
      status: locationStatus,
      water_level_mm: latestTelemetry ? latestTelemetry.water_level_mm : null,
      last_update: latestTelemetry ? latestTelemetry.timestamp : (device ? device.last_seen : null),
      device_id: device ? device._id : null,
      device_status: devStatus,
      device_operational_status: device ? (device.operational_status || 'ACTIVE') : 'UNMAPPED',
      maintenance_status: openComplaintCount > 0 ? 'COMPLAINT_OPEN' : (location.maintenance_status || 'OK'),
      open_complaint_count: openComplaintCount,
      active_incident_id: activeIncident ? activeIncident._id : null
    };
  });
}

module.exports = {
  listUserLocations
};
