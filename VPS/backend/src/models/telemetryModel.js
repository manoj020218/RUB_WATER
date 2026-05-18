const { v4: uuidv4 } = require('uuid');
const { badRequest } = require('../utils/errors');
const { toIso } = require('../utils/time');

function bool(value, fallback = false) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true';
  }
  return fallback;
}

function createTelemetryRecord(payload) {
  if (!payload || typeof payload !== 'object') {
    throw badRequest('Invalid telemetry payload');
  }

  const deviceId = payload.device_id;
  const locationId = payload.location_id;
  if (!deviceId || !locationId) {
    throw badRequest('device_id and location_id are required');
  }

  const waterLevel = Number(payload.water_level_mm ?? 0);
  const distance = Number(payload.distance_mm ?? 0);
  const switch300 = bool(payload.switch_300mm);
  const switch500 = bool(payload.switch_500mm);
  const status = payload.status || 'NORMAL';

  return {
    _id: uuidv4(),
    type: 'TELEMETRY',
    device_id: deviceId,
    location_id: locationId,
    timestamp: toIso(payload.timestamp),
    status,
    water_level_mm: Number.isFinite(waterLevel) ? waterLevel : 0,
    distance_mm: Number.isFinite(distance) ? distance : 0,
    primary_sensor_status: payload.primary_sensor_status || 'OK',
    switch_300mm: switch300,
    switch_500mm: switch500,
    battery_voltage: Number(payload.battery_voltage ?? 0),
    solar_voltage: Number(payload.solar_voltage ?? 0),
    wifi_rssi: Number(payload.wifi_rssi ?? 0),
    router_online: bool(payload.router_online, true),
    firmware_version: payload.firmware_version || 'unknown',
    relay_status: payload.relay_status || {
      siren: false,
      beacon: false,
      voice: false,
      barrier: false
    },
    water_detected: (Number.isFinite(waterLevel) && waterLevel > 0) || switch300 || switch500,
    source: payload.source || 'device'
  };
}

function createNoWaterSummary({ deviceId, locationId, avgLevel, sampleCount, day }) {
  return {
    _id: uuidv4(),
    type: 'NO_WATER_DAY_SUMMARY',
    device_id: deviceId,
    location_id: locationId,
    timestamp: new Date(day).toISOString(),
    water_level_mm: Number.isFinite(avgLevel) ? avgLevel : 0,
    sample_count: sampleCount,
    remark: 'no water day',
    water_detected: false,
    status: 'NORMAL',
    source: 'retention_job'
  };
}

module.exports = {
  createTelemetryRecord,
  createNoWaterSummary
};
