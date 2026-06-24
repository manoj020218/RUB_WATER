const { v4: uuidv4 } = require('uuid');
const { badRequest } = require('../utils/errors');
const { toIso } = require('../utils/time');

function bool(value, fallback = false) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }
  return fallback;
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function text(value, fallback = '') {
  return value === undefined || value === null ? fallback : String(value);
}

function normalizeRelayStatus(relayStatus = {}) {
  return {
    siren: bool(relayStatus.siren),
    flash: bool(relayStatus.flash ?? relayStatus.beacon),
    beacon: bool(relayStatus.flash ?? relayStatus.beacon),
    voice: bool(relayStatus.voice),
    barrier: bool(relayStatus.barrier ?? relayStatus.boom)
  };
}

function normalizeRemoteStatus(remote = null) {
  if (!remote || typeof remote !== 'object') {
    return {
      online: false,
      state: '--',
      batt: '--',
      battery_v: 0,
      siren: false,
      flash: false,
      voice: false,
      boom: false,
      barrier: false,
      fault_siren: false,
      fault_flash: false,
      fault_voice: false,
      poll_ms: 0
    };
  }

  return {
    online: bool(remote.online),
    state: text(remote.state, '--'),
    batt: text(remote.batt, '--'),
    battery_v: num(remote.battery_v ?? remote.batteryVoltage, 0),
    siren: bool(remote.siren),
    flash: bool(remote.flash),
    voice: bool(remote.voice),
    boom: bool(remote.boom ?? remote.barrier),
    barrier: bool(remote.barrier ?? remote.boom),
    fault_siren: bool(remote.fault_siren),
    fault_flash: bool(remote.fault_flash),
    fault_voice: bool(remote.fault_voice),
    poll_ms: num(remote.poll_ms, 0)
  };
}

function normalizeSensorMode(payload = {}) {
  const explicit = text(payload.sensor_mode || payload.sensor_logic_mode || payload.logic_mode, '').toUpperCase();
  if (explicit) {
    if (explicit === 'DUAL') return 'BOTH_ACTIVE';
    if (explicit === 'RS485_ONLY') return 'DYP_ONLY';
    return explicit;
  }
  const rs485Enabled = payload.rs485_sensor_enabled !== undefined
    ? bool(payload.rs485_sensor_enabled)
    : bool(payload.rs485_enabled, true);
  const switchEnabled = payload.switch_sensor_enabled !== undefined
    ? bool(payload.switch_sensor_enabled)
    : bool(payload.switch_enabled, true);
  if (rs485Enabled && switchEnabled) return 'BOTH_ACTIVE';
  if (rs485Enabled) return 'DYP_ONLY';
  if (switchEnabled) return 'SWITCH_ONLY';
  return 'NO_SENSOR';
}

function normalizeSensorLogicMode(sensorMode) {
  if (sensorMode === 'BOTH_ACTIVE') return 'DUAL';
  if (sensorMode === 'DYP_ONLY') return 'RS485_ONLY';
  return sensorMode;
}

function createTelemetryRecord(payload) {
  if (!payload || typeof payload !== 'object') {
    throw badRequest('Invalid telemetry payload');
  }

  const deviceId = text(payload.device_id).trim().toUpperCase();
  const hardwareId = text(payload.hardware_id).trim().toUpperCase();
  const locationId = payload.location_id || null;
  if (!deviceId) {
    throw badRequest('device_id is required');
  }

  const waterLevel = num(payload.water_level_mm, 0);
  const distance = num(payload.distance_mm, 0);
  const switch300 = bool(payload.switch_300mm ?? payload.l1_active);
  const switch500 = bool(payload.switch_500mm ?? payload.l2_active);
  const status = text(payload.status || 'NORMAL', 'NORMAL').toUpperCase();
  const relayStatus = normalizeRelayStatus(payload.relay_status);
  const remoteLeft = normalizeRemoteStatus(payload.remote_left);
  const remoteRight = normalizeRemoteStatus(payload.remote_right);
  const timestamp = toIso(payload.timestamp || payload.ts || payload.received_at || null);
  const sensorMode = normalizeSensorMode(payload);

  return {
    _id: uuidv4(),
    type: 'TELEMETRY',
    device_id: deviceId,
    hardware_id: hardwareId || null,
    location_id: locationId,
    timestamp,
    received_at: timestamp,
    status,
    flood_state: text(payload.flood_state || status, status).toUpperCase(),
    alert_level: text(payload.alert_level, 'NORMAL').toUpperCase(),
    alert_status: text(payload.alert_status, 'IDLE').toUpperCase(),
    alert_source: text(payload.alert_source, 'NONE').toUpperCase(),
    alert_reason: text(payload.alert_reason, ''),
    pending_alert_level: text(payload.pending_alert_level, 'NORMAL').toUpperCase(),
    outputs_enabled: bool(payload.outputs_enabled),
    dyp_first: bool(payload.dyp_first),
    switch_first: bool(payload.switch_first),
    current_config_version: num(payload.current_config_version ?? payload.config_version, 0),
    sensor_confirmation_wait_sec: num(payload.sensor_confirmation_wait_sec ?? payload.mismatch_duration_seconds, 0),
    water_level_mm: waterLevel,
    distance_mm: distance,
    primary_sensor_status: text(payload.primary_sensor_status, 'OK'),
    sensor_valid: payload.sensor_valid !== undefined ? bool(payload.sensor_valid, true) : true,
    sensor_detected: payload.sensor_detected !== undefined ? bool(payload.sensor_detected, true) : true,
    sensor_logic_mode: normalizeSensorLogicMode(sensorMode),
    sensor_mode: sensorMode,
    switch_300mm: switch300,
    switch_500mm: switch500,
    l1_active: switch300,
    l2_active: switch500,
    zero_dist_mm: num(payload.zero_dist_mm ?? payload.zero_distance_mm, 0),
    sensor_mount_height_mm: num(payload.sensor_mount_height_mm, 0),
    rs485_sensor_enabled: payload.rs485_sensor_enabled !== undefined
      ? bool(payload.rs485_sensor_enabled)
      : bool(payload.rs485_enabled, true),
    switch_sensor_enabled: payload.switch_sensor_enabled !== undefined
      ? bool(payload.switch_sensor_enabled)
      : bool(payload.switch_enabled, true),
    switch_level_1_mm: num(payload.switch_level_1_mm, 0),
    switch_level_2_mm: num(payload.switch_level_2_mm, 0),
    mismatch_duration_seconds: num(payload.mismatch_duration_seconds ?? payload.sensor_confirmation_wait_sec, 0),
    vmon_cal_factor: num(payload.vmon_cal_factor, 0),
    battery_voltage: num(payload.battery_voltage ?? payload.battery_v, 0),
    battery_v: num(payload.battery_v ?? payload.battery_voltage, 0),
    battery_current_ma: num(payload.battery_ma ?? payload.battery_current_ma, 0),
    battery_ma: num(payload.battery_ma ?? payload.battery_current_ma, 0),
    battery_power_mw: num(payload.battery_mw ?? payload.battery_power_mw, 0),
    battery_mw: num(payload.battery_mw ?? payload.battery_power_mw, 0),
    batt_low: bool(payload.batt_low),
    ina_status: text(payload.ina_status || (payload.batt_low ? 'LOW' : 'OK'), 'OK'),
    solar_voltage: num(payload.solar_voltage, 0),
    wifi_connected: bool(payload.wifi_connected, true),
    mqtt_connected: bool(payload.mqtt_connected),
    wifi_rssi: num(payload.wifi_rssi ?? payload.rssi, 0),
    rssi: num(payload.rssi ?? payload.wifi_rssi, 0),
    ssid: text(payload.ssid),
    local_ip: text(payload.local_ip || payload.device_local_ip),
    api_server: text(payload.api_server),
    mqtt_server: text(payload.mqtt_server),
    mqtt_route_id: text(payload.mqtt_route_id),
    mqtt_topic_base: text(payload.mqtt_topic_base),
    uptime_s: num(payload.uptime_s ?? (payload.uptime_ms ? Math.floor(payload.uptime_ms / 1000) : 0), 0),
    uptime_ms: num(payload.uptime_ms, 0),
    free_heap: num(payload.free_heap, 0),
    firmware_version: text(payload.firmware_version || payload.firmware, 'unknown'),
    relay_status: relayStatus,
    remote_left: remoteLeft,
    remote_right: remoteRight,
    water_detected: (Number.isFinite(waterLevel) && waterLevel > 0) || switch300 || switch500,
    source: payload.source || 'device',
    config: (payload.config && typeof payload.config === 'object') ? payload.config : null
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
