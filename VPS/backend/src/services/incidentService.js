const { v4: uuidv4 } = require('uuid');
const incidentRepository = require('../repositories/incidentRepository');
const { nowIso } = require('../utils/time');

function openOrUpdateDangerIncident({ locationId, deviceId, waterLevel, reason, source = 'device' }) {
  const active = incidentRepository.findActiveByLocation(locationId);
  const level = Number(waterLevel || 0);

  if (active) {
    const maxLevel = Math.max(Number(active.max_water_level_mm || 0), level);
    return incidentRepository.update(active._id, {
      max_water_level_mm: maxLevel,
      latest_reason: reason || active.latest_reason,
      latest_source: source,
      updated_at: nowIso()
    });
  }

  const incident = {
    _id: `incident_${uuidv4().replace(/-/g, '').slice(0, 12)}`,
    location_id: locationId,
    device_id: deviceId,
    status: 'ACTIVE',
    started_at: nowIso(),
    ended_at: null,
    max_water_level_mm: level,
    trigger_reason: reason || 'Danger event received',
    latest_reason: reason || 'Danger event received',
    latest_source: source,
    auto_cleared: false,
    force_cleared_by: null,
    force_clear_reason: null,
    created_at: nowIso(),
    updated_at: nowIso()
  };

  return incidentRepository.insert(incident);
}

function closeIncidentAuto({ locationId, reason }) {
  const active = incidentRepository.findActiveByLocation(locationId);
  if (!active) {
    return null;
  }

  return incidentRepository.update(active._id, {
    status: 'CLOSED',
    auto_cleared: true,
    force_cleared_by: null,
    force_clear_reason: null,
    ended_at: nowIso(),
    latest_reason: reason || 'Danger auto cleared',
    updated_at: nowIso()
  });
}

function forceClearIncident({ locationId, reason, userId }) {
  const active = incidentRepository.findActiveByLocation(locationId);
  if (!active) {
    return null;
  }

  return incidentRepository.update(active._id, {
    status: 'CLOSED',
    auto_cleared: false,
    force_cleared_by: userId,
    force_clear_reason: reason,
    ended_at: nowIso(),
    latest_reason: 'Force cleared by user',
    updated_at: nowIso()
  });
}

function listIncidents(locationId) {
  return incidentRepository
    .listByLocation(locationId)
    .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
}

function getActiveIncident(locationId) {
  return incidentRepository.findActiveByLocation(locationId);
}

module.exports = {
  openOrUpdateDangerIncident,
  closeIncidentAuto,
  forceClearIncident,
  listIncidents,
  getActiveIncident
};
