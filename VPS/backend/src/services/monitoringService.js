const locationRepository = require('../repositories/locationRepository');
const deviceRepository = require('../repositories/deviceRepository');
const telemetryRepository = require('../repositories/telemetryRepository');
const incidentService = require('./incidentService');

function listUserLocations(authContext) {
  const user = authContext.user;
  let locations = [];

  if (user.role === 'VENDOR_SUPER_ADMIN') {
    const allIds = new Set();
    telemetryRepository.listAll().forEach((item) => {
      if (item.location_id) {
        allIds.add(item.location_id);
      }
    });

    user.assigned_location_ids.forEach((locationId) => allIds.add(locationId));
    locations = locationRepository.listByIds([...allIds]);
  } else {
    locations = locationRepository.listByIds(user.assigned_location_ids || []);
  }

  return locations.map((location) => {
    const device = deviceRepository.findByLocation(location._id);
    const latestTelemetry = telemetryRepository
      .listByLocation(location._id)
      .filter((item) => item.type === 'TELEMETRY')
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0] || null;

    const activeIncident = incidentService.getActiveIncident(location._id);
    return {
      location_id: location._id,
      location_name: location.name,
      status: activeIncident ? 'DANGER' : (latestTelemetry ? latestTelemetry.status : 'OFFLINE'),
      water_level_mm: latestTelemetry ? latestTelemetry.water_level_mm : null,
      last_update: latestTelemetry ? latestTelemetry.timestamp : (device ? device.last_seen : null),
      device_id: device ? device._id : null,
      device_status: device ? device.status : 'UNMAPPED',
      active_incident_id: activeIncident ? activeIncident._id : null
    };
  });
}

module.exports = {
  listUserLocations
};
