const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'floodguard_db.json');

// High-volume / ephemeral collections intentionally excluded:
//   telemetry, auditLogs, commands, userSessions, integrationDeliveryLogs, deviceLifecycleHistory
const PERSIST_KEYS = [
  'users',
  'vendors',
  'projects',
  'locations',
  'devices',
  'deviceConfigs',
  'deviceConfigHistory',
  'deviceActionSheets',
  'deviceActionSheetHistory',
  'alertActionLogs',
  'firmwareVersions',
  'appVersions',
  'incidents',
  'complaints',
  'notifications',
  'integrationSettings'
];

let _autoSaveTimer = null;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadFromDisk(dataStore) {
  if (!fs.existsSync(DATA_FILE)) {
    console.log('[FloodGuard DB] No persisted data file — starting fresh.');
    return false;
  }
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const saved = JSON.parse(raw);
    let totalRecords = 0;
    PERSIST_KEYS.forEach((key) => {
      if (Array.isArray(saved[key])) {
        dataStore[key] = saved[key];
        totalRecords += saved[key].length;
      }
    });
    const summary = PERSIST_KEYS
      .filter((k) => (dataStore[k] || []).length > 0)
      .map((k) => `${k}:${dataStore[k].length}`)
      .join(', ');
    console.log(`[FloodGuard DB] Loaded ${totalRecords} records from disk${summary ? ` (${summary})` : ''}.`);
    return true;
  } catch (err) {
    console.error('[FloodGuard DB] Load failed:', err.message);
    return false;
  }
}

function flushSync(dataStore) {
  if (!dataStore) return;
  try {
    ensureDataDir();
    const snapshot = {};
    PERSIST_KEYS.forEach((key) => {
      snapshot[key] = Array.isArray(dataStore[key]) ? dataStore[key] : [];
    });
    const tmpFile = DATA_FILE + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(snapshot), 'utf8');
    fs.renameSync(tmpFile, DATA_FILE);
  } catch (err) {
    console.error('[FloodGuard DB] Flush failed:', err.message);
  }
}

function startAutoSave(dataStore, intervalMs = 5000) {
  ensureDataDir();
  _autoSaveTimer = setInterval(() => {
    flushSync(dataStore);
  }, intervalMs);
  // Allow the process to exit even if this interval is still running
  if (_autoSaveTimer.unref) _autoSaveTimer.unref();
  console.log(`[FloodGuard DB] Auto-save active (every ${intervalMs / 1000}s) → ${DATA_FILE}`);
}

function stopAutoSave() {
  if (_autoSaveTimer) {
    clearInterval(_autoSaveTimer);
    _autoSaveTimer = null;
  }
}

module.exports = {
  loadFromDisk,
  flushSync,
  startAutoSave,
  stopAutoSave
};
