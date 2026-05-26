const fs = require('fs');
const path = require('path');
const env = require('../config/env');

let _messaging = null;
let _initAttempted = false;

function _init() {
  if (_initAttempted) return _messaging;
  _initAttempted = true;

  if (!env.fcmEnabled) {
    console.info('[FCM] Disabled via FCM_ENABLED=false');
    return null;
  }

  let admin;
  try {
    admin = require('firebase-admin');
  } catch (_) {
    console.warn('[FCM] firebase-admin not installed — run: npm install firebase-admin');
    return null;
  }

  const keyPath = path.resolve(env.fcmServiceAccountPath);
  if (!fs.existsSync(keyPath)) {
    console.warn('[FCM] Service account file not found:', keyPath);
    console.warn('[FCM] Copy floodguard-f84ac-firebase-adminsdk-*.json to VPS/backend/firebase-service-account.json');
    return null;
  }

  try {
    const keyJson = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
    const app = admin.initializeApp({ credential: admin.credential.cert(keyJson) }, 'floodguard');
    _messaging = admin.messaging(app);
    console.info('[FCM] Firebase Admin SDK initialized — project:', keyJson.project_id);
    return _messaging;
  } catch (err) {
    console.error('[FCM] Init failed:', err.message);
    return null;
  }
}

async function sendFcmNotification(tokens, title, body, data = {}) {
  if (!Array.isArray(tokens) || tokens.length === 0) {
    return { sent: 0, failed: 0 };
  }

  const messaging = _init();
  if (!messaging) {
    return { sent: 0, failed: 0, reason: 'fcm_not_configured' };
  }

  const stringData = {};
  for (const [k, v] of Object.entries(data)) {
    stringData[k] = String(v == null ? '' : v);
  }

  const message = {
    notification: { title, body },
    data: stringData,
    android: {
      priority: 'high',
      notification: {
        channelId: 'flood_danger',
        sound: 'flood_alert',
        priority: 'max',
        visibility: 'PUBLIC',
        notificationCount: 1
      }
    },
    webpush: {
      headers: { Urgency: 'high' },
      notification: {
        title,
        body,
        icon: '/app-icon-192.png',
        badge: '/app-icon-192.png',
        vibrate: [500, 110, 500, 110, 450, 110, 200, 110, 170, 40, 450],
        requireInteraction: true,
        tag: 'floodguard-alert'
      },
      fcmOptions: { link: data.url || '/' }
    },
    tokens
  };

  try {
    const result = await messaging.sendEachForMulticast(message);
    console.info(`[FCM] Sent ${result.successCount}/${tokens.length} — event: ${data.event || '?'}`);
    return {
      sent: result.successCount,
      failed: result.failureCount,
      responses: result.responses.map((r, i) => ({
        token: tokens[i].slice(0, 12) + '...',
        success: r.success,
        error: r.error?.message || null
      }))
    };
  } catch (err) {
    console.error('[FCM] sendEachForMulticast error:', err.message);
    return { sent: 0, failed: tokens.length, error: err.message };
  }
}

module.exports = { sendFcmNotification };
