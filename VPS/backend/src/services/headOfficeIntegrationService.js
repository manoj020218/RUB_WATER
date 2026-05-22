const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const integrationSettingRepository = require('../repositories/integrationSettingRepository');
const locationRepository = require('../repositories/locationRepository');
const deviceRepository = require('../repositories/deviceRepository');
const telemetryRepository = require('../repositories/telemetryRepository');
const incidentRepository = require('../repositories/incidentRepository');
const auditRepository = require('../repositories/auditRepository');
const complaintRepository = require('../repositories/complaintRepository');
const { assertPermission } = require('./rbacService');
const { onRealtime } = require('./realtimeBus');
const { badRequest, forbidden, notFound } = require('../utils/errors');

const WEBHOOK_RETRY_SCHEDULE_SECONDS = [30, 120, 300, 900];

function nowIso() {
  return new Date().toISOString();
}

function normalizeMode(value) {
  const mode = String(value || '').trim().toUpperCase();
  if (!mode) {
    return 'PULL_AND_PUSH';
  }
  const allowed = new Set(['PULL', 'PUSH', 'PULL_AND_PUSH']);
  return allowed.has(mode) ? mode : 'PULL_AND_PUSH';
}

function normalizeLocationIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))];
}

function normalizeSetting(setting) {
  if (!setting) {
    return null;
  }
  return {
    setting_id: setting._id,
    department_id: setting.department_id,
    enabled: Boolean(setting.enabled),
    mode: normalizeMode(setting.mode),
    webhook_url: setting.webhook_url || null,
    allowed_location_ids: Array.isArray(setting.allowed_location_ids) ? [...setting.allowed_location_ids] : [],
    send_telemetry_interval_seconds: Number(setting.send_telemetry_interval_seconds || 300),
    send_only_events: Boolean(setting.send_only_events),
    has_inbound_token: Boolean(setting.inbound_token_hash),
    has_webhook_secret: Boolean(setting.webhook_secret),
    updated_at: setting.updated_at || null
  };
}

function ensureManagePermission(authContext) {
  assertPermission(authContext.user.role, 'MANAGE_HEAD_OFFICE_INTEGRATION');
}

function listSettings({ authContext }) {
  ensureManagePermission(authContext);
  const all = integrationSettingRepository.listAll();
  if (authContext.user.role === 'VENDOR_SUPER_ADMIN') {
    return all.map((item) => normalizeSetting(item));
  }
  return all
    .filter((item) => String(item.department_id || '') === String(authContext.user.department_id || ''))
    .map((item) => normalizeSetting(item));
}

function upsertSetting({ payload, authContext, ipAddress, auditService }) {
  ensureManagePermission(authContext);
  const departmentId = String(payload?.department_id || authContext.user.department_id || '').trim();
  if (!departmentId) {
    throw badRequest('department_id is required');
  }

  if (authContext.user.role !== 'VENDOR_SUPER_ADMIN'
    && String(authContext.user.department_id || '') !== departmentId) {
    throw forbidden('You cannot manage another department integration');
  }

  const patch = {
    enabled: payload?.enabled !== false,
    mode: normalizeMode(payload?.mode),
    webhook_url: String(payload?.webhook_url || '').trim() || null,
    allowed_location_ids: normalizeLocationIds(payload?.allowed_location_ids),
    send_telemetry_interval_seconds: Math.max(10, Number(payload?.send_telemetry_interval_seconds || 300)),
    send_only_events: Boolean(payload?.send_only_events),
    outbound_auth_token: String(payload?.outbound_auth_token || '').trim() || null,
    webhook_secret: String(payload?.webhook_secret || '').trim() || null,
    updated_at: nowIso(),
    updated_by_user_id: authContext.user._id
  };

  const inboundToken = String(payload?.inbound_token || '').trim();
  if (inboundToken) {
    patch.inbound_token_hash = integrationSettingRepository.hashToken(inboundToken);
    patch.inbound_token_hint = inboundToken.slice(-6);
  }

  const saved = integrationSettingRepository.upsertByDepartmentId(departmentId, patch);
  if (auditService) {
    auditService.writeAuditLog({
      locationId: null,
      eventType: 'HEAD_OFFICE_INTEGRATION_UPDATED',
      performedBy: authContext.user._id,
      loginId: authContext.user.login_id,
      sessionId: authContext.session?._id || null,
      deviceName: authContext.session?.device_name || null,
      ipAddress,
      details: {
        department_id: departmentId,
        enabled: patch.enabled,
        mode: patch.mode,
        webhook_url: patch.webhook_url,
        allowed_location_ids: patch.allowed_location_ids
      }
    });
  }

  return normalizeSetting(saved);
}

function listDeliveryLogs({ authContext, departmentId }) {
  ensureManagePermission(authContext);
  const nextDepartment = String(departmentId || authContext.user.department_id || '').trim();
  if (!nextDepartment && authContext.user.role !== 'VENDOR_SUPER_ADMIN') {
    throw badRequest('department_id is required');
  }
  if (authContext.user.role !== 'VENDOR_SUPER_ADMIN'
    && String(authContext.user.department_id || '') !== nextDepartment) {
    throw forbidden('You cannot access logs of another department');
  }
  return integrationSettingRepository
    .listDeliveryLogs({ department_id: nextDepartment || '' })
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

function locationAllowedBySetting(setting, locationId) {
  const allowed = Array.isArray(setting.allowed_location_ids) ? setting.allowed_location_ids : [];
  if (allowed.length === 0) {
    return true;
  }
  return allowed.includes(locationId);
}

function assertSettingCanAccessLocation(setting, locationId) {
  if (!locationAllowedBySetting(setting, locationId)) {
    throw forbidden('Location not allowed for this integration token');
  }
}

function latestTelemetryForLocation(locationId) {
  return telemetryRepository
    .listByLocation(locationId)
    .filter((item) => item.type === 'TELEMETRY')
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0] || null;
}

function latestDeviceForLocation(locationId) {
  return deviceRepository.findByLocation(locationId);
}

function listIntegrationLocations(setting) {
  return locationRepository.listAll()
    .filter((location) => locationAllowedBySetting(setting, location._id))
    .map((location) => {
      const device = latestDeviceForLocation(location._id);
      const latest = latestTelemetryForLocation(location._id);
      const openComplaintCount = complaintRepository.countOpenByLocation(location._id);
      return {
        location_id: location._id,
        location_name: location.name,
        department_id: location.department_id,
        device_id: device?._id || null,
        device_status: device?.status || 'UNMAPPED',
        device_operational_status: device?.operational_status || 'ACTIVE',
        safety_status: latest?.status || 'OFFLINE',
        maintenance_status: openComplaintCount > 0 ? 'COMPLAINT_OPEN' : (location.maintenance_status || 'OK'),
        water_level_mm: latest?.water_level_mm ?? null,
        last_update: latest?.timestamp || device?.last_seen || null
      };
    });
}

function buildLocationLive(setting, locationId) {
  assertSettingCanAccessLocation(setting, locationId);
  const location = locationRepository.findById(locationId);
  if (!location) {
    throw notFound('Location not found');
  }
  const device = latestDeviceForLocation(locationId);
  if (!device) {
    throw notFound('Device not mapped for location');
  }
  const latest = latestTelemetryForLocation(locationId);
  const incident = incidentRepository.findActiveByLocation(locationId);
  const openComplaintCount = complaintRepository.countOpenByLocation(locationId);

  return {
    location_id: location._id,
    location_name: location.name,
    device_id: device._id,
    timestamp: latest?.timestamp || device.last_seen || nowIso(),
    safety_status: incident ? 'DANGER' : (latest?.status || 'OFFLINE'),
    sensor_status: latest?.primary_sensor_status || 'UNKNOWN',
    maintenance_status: openComplaintCount > 0 ? 'COMPLAINT_OPEN' : (location.maintenance_status || 'OK'),
    water_level_mm: latest?.water_level_mm ?? null,
    alert_level_mm: Number(location.alert_level_mm || 0),
    danger_level_mm: Number(location.danger_level_mm || 0),
    rs485_sensor: {
      enabled: true,
      status: latest?.primary_sensor_status || 'UNKNOWN',
      distance_mm: latest?.distance_mm ?? null,
      water_level_mm: latest?.water_level_mm ?? null
    },
    switch_sensor: {
      enabled: true,
      level_1_closed: Boolean(latest?.switch_300mm),
      level_2_closed: Boolean(latest?.switch_500mm)
    },
    outputs: latest?.relay_status || {
      siren: false,
      beacon: false,
      voice: false,
      barrier: false
    },
    battery_voltage: latest?.battery_voltage ?? null,
    solar_voltage: latest?.solar_voltage ?? null,
    last_heartbeat_at: device.last_heartbeat || device.last_seen || null,
    status_note: incident?.latest_reason || null,
    device_operational_status: device.operational_status || 'ACTIVE'
  };
}

function listLocationIncidents(setting, locationId) {
  assertSettingCanAccessLocation(setting, locationId);
  return incidentRepository
    .listByLocation(locationId)
    .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
}

function listLocationAuditLogs(setting, locationId) {
  assertSettingCanAccessLocation(setting, locationId);
  return auditRepository
    .listByLocation(locationId)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

function getDeviceStatus(setting, deviceId) {
  const device = deviceRepository.findById(deviceId);
  if (!device) {
    throw notFound('Device not found');
  }
  assertSettingCanAccessLocation(setting, device.location_id);
  const latest = latestTelemetryForLocation(device.location_id);
  return {
    device_id: device._id,
    location_id: device.location_id,
    device_status: device.status || 'OFFLINE',
    device_operational_status: device.operational_status || 'ACTIVE',
    last_seen: device.last_seen || null,
    last_heartbeat_at: device.last_heartbeat || null,
    firmware_version: device.firmware_version || null,
    latest_water_level_mm: latest?.water_level_mm ?? null
  };
}

function buildSummary(setting) {
  const rows = listIntegrationLocations(setting);
  const summary = {
    total_locations: rows.length,
    online_devices: rows.filter((item) => item.device_status === 'ONLINE').length,
    offline_devices: rows.filter((item) => item.device_status === 'OFFLINE' || item.device_status === 'UNMAPPED').length,
    danger_locations: rows.filter((item) => item.safety_status === 'DANGER').length,
    open_complaint_locations: rows.filter((item) => item.maintenance_status === 'COMPLAINT_OPEN').length,
    device_faulty_locations: rows.filter((item) => item.maintenance_status === 'DEVICE_FAULTY').length
  };
  return {
    generated_at: nowIso(),
    summary,
    locations: rows
  };
}

function signPayload(secret, timestamp, bodyText) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(`${timestamp}.${bodyText}`, 'utf8');
  return hmac.digest('hex');
}

async function postWebhook(setting, eventPayload, attempt) {
  const bodyText = JSON.stringify(eventPayload);
  const headers = {
    'content-type': 'application/json'
  };
  if (setting.outbound_auth_token) {
    headers.authorization = `Bearer ${setting.outbound_auth_token}`;
  }
  if (setting.webhook_secret) {
    const ts = String(Date.now());
    headers['X-FloodGuard-Timestamp'] = ts;
    headers['X-FloodGuard-Signature'] = `sha256=${signPayload(setting.webhook_secret, ts, bodyText)}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(setting.webhook_url, {
      method: 'POST',
      headers,
      body: bodyText,
      signal: controller.signal
    });
    const text = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      response_text: text.slice(0, 600),
      attempt
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      response_text: String(error?.message || error),
      attempt
    };
  } finally {
    clearTimeout(timer);
  }
}

function mapRealtimeToWebhookEvent(message) {
  const event = String(message?.event || '').trim().toUpperCase();
  const payload = message?.payload || {};
  const locationId = String(payload.location_id || '').trim();
  if (!locationId) {
    return null;
  }

  const mappedType = event === 'DEVICE_EVENT'
    ? String(payload.event_type || 'DEVICE_EVENT').toUpperCase()
    : event;
  return {
    event_id: `evt_${uuidv4().replace(/-/g, '').slice(0, 12)}`,
    event_type: mappedType,
    location_id: locationId,
    device_id: payload.device_id || null,
    timestamp: message.timestamp || nowIso(),
    severity: payload.status === 'DANGER' ? 'CRITICAL' : (payload.status === 'ALERT' ? 'HIGH' : 'INFO'),
    message: payload.reason || payload.note || mappedType,
    payload
  };
}

function shouldPushMessage(setting, message, throttleMap) {
  if (!setting.enabled || !setting.webhook_url) {
    return false;
  }
  const mode = normalizeMode(setting.mode);
  if (mode !== 'PUSH' && mode !== 'PULL_AND_PUSH') {
    return false;
  }

  const eventName = String(message?.event || '').trim().toUpperCase();
  const payload = message?.payload || {};
  const locationId = String(payload.location_id || '').trim();
  if (!locationId || !locationAllowedBySetting(setting, locationId)) {
    return false;
  }

  if (setting.send_only_events && eventName === 'TELEMETRY_UPDATED') {
    return false;
  }

  if (eventName === 'TELEMETRY_UPDATED') {
    const intervalSec = Math.max(10, Number(setting.send_telemetry_interval_seconds || 300));
    const key = `${setting._id}:${locationId}`;
    const now = Date.now();
    const last = throttleMap.get(key) || 0;
    if ((now - last) < (intervalSec * 1000)) {
      return false;
    }
    throttleMap.set(key, now);
  }

  return true;
}

function startWebhookDispatcher() {
  const throttleMap = new Map();
  const active = { closed: false };

  async function deliverWithRetry(setting, eventPayload, departmentId) {
    for (let attempt = 1; attempt <= (WEBHOOK_RETRY_SCHEDULE_SECONDS.length + 1); attempt += 1) {
      if (active.closed) {
        return;
      }
      const result = await postWebhook(setting, eventPayload, attempt);
      integrationSettingRepository.insertDeliveryLog({
        _id: `idl_${uuidv4().replace(/-/g, '').slice(0, 12)}`,
        department_id: departmentId,
        setting_id: setting._id,
        event_id: eventPayload.event_id,
        event_type: eventPayload.event_type,
        location_id: eventPayload.location_id || null,
        device_id: eventPayload.device_id || null,
        attempt,
        ok: result.ok,
        status: result.status,
        response_text: result.response_text,
        timestamp: nowIso()
      });

      if (result.ok) {
        return;
      }
      const retryIndex = attempt - 1;
      if (retryIndex >= WEBHOOK_RETRY_SCHEDULE_SECONDS.length) {
        return;
      }
      const waitMs = WEBHOOK_RETRY_SCHEDULE_SECONDS[retryIndex] * 1000;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  const unsubscribe = onRealtime((message) => {
    const eventPayload = mapRealtimeToWebhookEvent(message);
    if (!eventPayload) {
      return;
    }

    const settings = integrationSettingRepository.listAll();
    settings.forEach((setting) => {
      if (!shouldPushMessage(setting, message, throttleMap)) {
        return;
      }
      deliverWithRetry(setting, eventPayload, setting.department_id);
    });
  });

  return () => {
    active.closed = true;
    unsubscribe();
  };
}

module.exports = {
  listSettings,
  upsertSetting,
  listDeliveryLogs,
  listIntegrationLocations,
  buildLocationLive,
  listLocationIncidents,
  listLocationAuditLogs,
  getDeviceStatus,
  buildSummary,
  startWebhookDispatcher
};
