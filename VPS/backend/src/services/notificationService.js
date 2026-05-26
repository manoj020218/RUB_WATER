const { v4: uuidv4 } = require('uuid');
const userRepository = require('../repositories/userRepository');
const sessionRepository = require('../repositories/sessionRepository');
const locationRepository = require('../repositories/locationRepository');
const { dataStore } = require('../db/datastore');
const { ROLE } = require('../config/permissions');
const fcmService = require('./fcmService');

const EVENT_MESSAGES = {
  DANGER_CONFIRMED:    { title: '🚨 Flood DANGER',       body: (loc) => `${loc} — Water level CRITICAL. Evacuate now.` },
  DANGER_AUTO_CLEARED: { title: '✅ Flood Cleared',       body: (loc) => `${loc} — Water level back to normal.` },
  ALERT_ORANGE:        { title: '⚠️ Flood ALERT',         body: (loc) => `${loc} — Water level rising. Stay alert.` },
  COMPLAINT_RAISED:    { title: '📋 Complaint Filed',     body: (loc) => `${loc} — New complaint submitted.` },
  COMPLAINT_RESOLVED:  { title: '✅ Complaint Resolved',  body: (loc) => `${loc} — Complaint has been resolved.` },
  COMPLAINT_ASSIGNED:  { title: '👤 Complaint Assigned',  body: (loc) => `${loc} — Complaint assigned for action.` },
};

function resolveRecipients({ locationId, recipientRoles, recipientUserIds }) {
  const explicitUsers = Array.isArray(recipientUserIds)
    ? recipientUserIds.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const roleSet = new Set(Array.isArray(recipientRoles) ? recipientRoles : []);
  const location = locationId ? locationRepository.findById(locationId) : null;

  const users = userRepository.listAll().filter((user) => {
    if (!user || !user.is_active) return false;
    if (explicitUsers.length > 0 && !explicitUsers.includes(user._id)) return false;
    if (roleSet.size > 0 && !roleSet.has(user.role)) return false;
    if (!locationId) return true;
    if (user.role === ROLE.VENDOR_SUPER_ADMIN) return true;
    if (location && user.department_id && location.department_id && user.department_id === location.department_id) return true;
    return Array.isArray(user.assigned_location_ids) && user.assigned_location_ids.includes(locationId);
  });

  return users.map((user) => {
    const sessions = sessionRepository.listActiveByUserId(user._id);
    const fcmTokens = sessions.map((s) => String(s.fcm_token || '').trim()).filter(Boolean);
    return {
      user_id: user._id,
      login_id: user.login_id,
      role: user.role,
      fcm_tokens: [...new Set(fcmTokens)]
    };
  });
}

function publishNotification(eventName, payload, options = {}) {
  const locationId = options.locationId || payload?.location_id || '';

  const recipients = resolveRecipients({
    locationId,
    recipientRoles: options.recipientRoles || null,
    recipientUserIds: options.recipientUserIds || null
  });

  const outboxRecord = {
    _id: `ntf_${uuidv4().replace(/-/g, '').slice(0, 12)}`,
    channel: 'fcm',
    event_name: eventName,
    payload: payload || {},
    recipients,
    timestamp: new Date().toISOString(),
    fcm_result: null
  };
  dataStore.notifications.push(outboxRecord);

  const allTokens = [];
  recipients.forEach((r) => allTokens.push(...r.fcm_tokens));
  const uniqueTokens = [...new Set(allTokens)];

  if (uniqueTokens.length > 0) {
    const tpl = EVENT_MESSAGES[eventName] || {
      title: `FloodGuard: ${eventName}`,
      body: (loc) => `Event at ${loc}`
    };
    const title = tpl.title;
    const body = typeof tpl.body === 'function' ? tpl.body(locationId) : tpl.body;
    const data = {
      event: eventName,
      location_id: locationId,
      water_level_mm: String(payload?.water_level_mm ?? ''),
      url: '/'
    };

    fcmService.sendFcmNotification(uniqueTokens, title, body, data)
      .then((result) => { outboxRecord.fcm_result = result; })
      .catch((err) => { outboxRecord.fcm_error = err.message; });
  }

  return {
    sent: true,
    channel: 'fcm',
    event_name: eventName,
    payload: payload || {},
    recipient_count: recipients.length,
    token_count: uniqueTokens.length,
    recipients,
    timestamp: outboxRecord.timestamp
  };
}

module.exports = { publishNotification };
