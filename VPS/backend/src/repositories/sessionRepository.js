const { dataStore } = require('../db/datastore');

function create(session) {
  dataStore.userSessions.push(session);
  return session;
}

function findActiveById(sessionId) {
  return dataStore.userSessions.find((session) => session._id === sessionId && session.is_active) || null;
}

function deactivate(sessionId) {
  const target = dataStore.userSessions.find((session) => session._id === sessionId);
  if (!target) {
    return null;
  }
  target.is_active = false;
  target.last_seen = new Date().toISOString();
  return target;
}

function listActiveByUserId(userId) {
  return dataStore.userSessions.filter((session) => session.user_id === userId && session.is_active);
}

function deactivateByUserId(userId) {
  const now = new Date().toISOString();
  let count = 0;
  dataStore.userSessions.forEach((session) => {
    if (session.user_id === userId && session.is_active) {
      session.is_active = false;
      session.last_seen = now;
      count += 1;
    }
  });
  return count;
}

function deactivateOtherSessions(userId, keepSessionId) {
  const now = new Date().toISOString();
  let count = 0;
  dataStore.userSessions.forEach((session) => {
    if (
      session.user_id === userId
      && session.is_active
      && session._id !== keepSessionId
    ) {
      session.is_active = false;
      session.last_seen = now;
      count += 1;
    }
  });
  return count;
}

function updateFcmToken(sessionId, fcmToken) {
  const session = dataStore.userSessions.find((s) => s._id === sessionId && s.is_active);
  if (!session) return null;
  session.fcm_token = fcmToken || null;
  session.last_seen = new Date().toISOString();
  return session;
}

module.exports = {
  create,
  findActiveById,
  deactivate,
  listActiveByUserId,
  deactivateByUserId,
  deactivateOtherSessions,
  updateFcmToken
};
