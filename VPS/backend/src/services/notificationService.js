const { v4: uuidv4 } = require('uuid');
const userRepository = require('../repositories/userRepository');
const sessionRepository = require('../repositories/sessionRepository');
const locationRepository = require('../repositories/locationRepository');
const { dataStore } = require('../db/datastore');
const { ROLE } = require('../config/permissions');

function resolveRecipients({ locationId, recipientRoles, recipientUserIds }) {
  const explicitUsers = Array.isArray(recipientUserIds) ? recipientUserIds.map((item) => String(item || '').trim()).filter(Boolean) : [];
  const roleSet = new Set(Array.isArray(recipientRoles) ? recipientRoles : []);
  const location = locationId ? locationRepository.findById(locationId) : null;

  const users = userRepository.listAll().filter((user) => {
    if (!user || !user.is_active) {
      return false;
    }
    if (explicitUsers.length > 0 && !explicitUsers.includes(user._id)) {
      return false;
    }
    if (roleSet.size > 0 && !roleSet.has(user.role)) {
      return false;
    }

    if (!locationId) {
      return true;
    }
    if (user.role === ROLE.VENDOR_SUPER_ADMIN) {
      return true;
    }
    if (location && user.department_id && location.department_id && user.department_id === location.department_id) {
      return true;
    }
    return Array.isArray(user.assigned_location_ids) && user.assigned_location_ids.includes(locationId);
  });

  return users.map((user) => {
    const sessions = sessionRepository.listActiveByUserId(user._id);
    const fcmTokens = sessions.map((session) => String(session.fcm_token || '').trim()).filter(Boolean);
    return {
      user_id: user._id,
      login_id: user.login_id,
      role: user.role,
      fcm_tokens: [...new Set(fcmTokens)]
    };
  });
}

function publishNotification(eventName, payload, options = {}) {
  const recipients = resolveRecipients({
    locationId: options.locationId || payload?.location_id || null,
    recipientRoles: options.recipientRoles || null,
    recipientUserIds: options.recipientUserIds || null
  });

  const outboxRecord = {
    _id: `ntf_${uuidv4().replace(/-/g, '').slice(0, 12)}`,
    channel: 'stub-fcm',
    event_name: eventName,
    payload: payload || {},
    recipients,
    timestamp: new Date().toISOString()
  };
  dataStore.notifications.push(outboxRecord);

  return {
    sent: true,
    channel: outboxRecord.channel,
    event_name: eventName,
    payload: payload || {},
    recipient_count: recipients.length,
    recipients,
    timestamp: outboxRecord.timestamp
  };
}

module.exports = {
  publishNotification
};
