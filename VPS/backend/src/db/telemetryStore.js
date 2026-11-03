// Durable telemetry store.
//
// Telemetry / heartbeats / device events are too high-volume for the main JSON
// snapshot (rewritten every 5 s), so they are appended to one NDJSON file per
// UTC day under data/telemetry/. Only a recent window is kept in memory for
// dashboards; reports read the day files for older ranges. Files older than the
// retention period are deleted.
//
// Disabled until start() is called (server.js), so tests never touch disk.

const fs = require('fs');
const path = require('path');

const TELEMETRY_DIR = process.env.TELEMETRY_DIR
  ? path.resolve(process.env.TELEMETRY_DIR)
  : path.resolve(__dirname, '..', '..', 'data', 'telemetry');
const FILE_RE = /^(\d{4}-\d{2}-\d{2})\.ndjson$/;

function readPositive(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const RETENTION_DAYS = readPositive('TELEMETRY_RETENTION_DAYS', 90);
const MEMORY_HOURS = readPositive('TELEMETRY_MEMORY_HOURS', 48);
const DAY_MS = 24 * 60 * 60 * 1000;

let enabled = false;
let pending = new Map(); // day -> serialized lines awaiting append
let flushTimer = null;
let maintenanceTimer = null;

function dayKey(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function recordMs(record) {
  const ms = new Date(record?.timestamp || 0).getTime();
  return Number.isFinite(ms) && ms > 0 ? ms : Date.now();
}

function append(record) {
  if (!enabled || !record) return;
  const key = dayKey(recordMs(record));
  if (!pending.has(key)) pending.set(key, []);
  pending.get(key).push(JSON.stringify(record));
}

function takePending() {
  const byDay = pending;
  pending = new Map();
  return byDay;
}

function flushSync() {
  if (!enabled) return;
  const byDay = takePending();
  if (byDay.size === 0) return;
  fs.mkdirSync(TELEMETRY_DIR, { recursive: true });
  byDay.forEach((lines, key) => {
    fs.appendFileSync(path.join(TELEMETRY_DIR, `${key}.ndjson`), `${lines.join('\n')}\n`, 'utf8');
  });
}

function safeFlush() {
  try {
    flushSync();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`[TelemetryStore] flush failed: ${error.message}`);
  }
}

function listDayFiles() {
  if (!fs.existsSync(TELEMETRY_DIR)) return [];
  return fs.readdirSync(TELEMETRY_DIR)
    .map((name) => {
      const m = FILE_RE.exec(name);
      return m ? { day: m[1], file: path.join(TELEMETRY_DIR, name) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.day.localeCompare(b.day));
}

function parseFile(file, fromMs, toMs, out) {
  const text = fs.readFileSync(file, 'utf8');
  let start = 0;
  while (start < text.length) {
    let end = text.indexOf('\n', start);
    if (end === -1) end = text.length;
    const line = text.slice(start, end);
    start = end + 1;
    if (!line) continue;
    try {
      const rec = JSON.parse(line);
      const ms = new Date(rec.timestamp || 0).getTime();
      if (ms >= fromMs && ms <= toMs) out.push(rec);
    } catch (_) {
      // skip a torn/partial line
    }
  }
}

/** Records from day files with fromMs <= timestamp <= toMs (pending buffer included). */
function readRange(fromMs, toMs) {
  if (!enabled) return [];
  safeFlush();
  const firstDay = dayKey(Math.max(fromMs, 0));
  const lastDay = dayKey(Math.min(toMs, Date.now() + DAY_MS));
  const out = [];
  listDayFiles()
    .filter(({ day }) => day >= firstDay && day <= lastDay)
    .forEach(({ file }) => parseFile(file, fromMs, toMs, out));
  return out;
}

function pruneOldFiles(nowMs = Date.now()) {
  const cutoffDay = dayKey(nowMs - RETENTION_DAYS * DAY_MS);
  let removed = 0;
  listDayFiles().forEach(({ day, file }) => {
    if (day < cutoffDay) {
      fs.unlinkSync(file);
      removed += 1;
    }
  });
  return removed;
}

function trimMemory(dataStore, nowMs = Date.now()) {
  const cutoff = nowMs - MEMORY_HOURS * 60 * 60 * 1000;
  const before = dataStore.telemetry.length;
  dataStore.telemetry = dataStore.telemetry.filter((rec) => recordMs(rec) >= cutoff);
  return before - dataStore.telemetry.length;
}

function runMaintenance(dataStore) {
  try {
    safeFlush();
    const files = pruneOldFiles();
    const trimmed = trimMemory(dataStore);
    if (files || trimmed) {
      // eslint-disable-next-line no-console
      console.log(`[TelemetryStore] pruned ${files} day file(s), trimmed ${trimmed} in-memory record(s)`);
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`[TelemetryStore] maintenance failed: ${error.message}`);
  }
}

/** Enable persistence and reload the recent window into memory. */
function start(dataStore, { flushIntervalMs = 2000, maintenanceIntervalMs = 60 * 60 * 1000 } = {}) {
  enabled = true;
  fs.mkdirSync(TELEMETRY_DIR, { recursive: true });
  const now = Date.now();
  const recent = [];
  listDayFiles()
    .filter(({ day }) => day >= dayKey(now - MEMORY_HOURS * 60 * 60 * 1000))
    .forEach(({ file }) => parseFile(file, now - MEMORY_HOURS * 60 * 60 * 1000, Number.MAX_SAFE_INTEGER, recent));
  const seen = new Set(dataStore.telemetry.map((r) => r._id));
  recent.forEach((r) => { if (!seen.has(r._id)) dataStore.telemetry.push(r); });
  // eslint-disable-next-line no-console
  console.log(`[TelemetryStore] ${recent.length} record(s) from last ${MEMORY_HOURS}h reloaded; retention ${RETENTION_DAYS} days → ${TELEMETRY_DIR}`);

  flushTimer = setInterval(safeFlush, flushIntervalMs);
  maintenanceTimer = setInterval(() => runMaintenance(dataStore), maintenanceIntervalMs);
  if (flushTimer.unref) flushTimer.unref();
  if (maintenanceTimer.unref) maintenanceTimer.unref();
  runMaintenance(dataStore);
}

function stop() {
  if (flushTimer) clearInterval(flushTimer);
  if (maintenanceTimer) clearInterval(maintenanceTimer);
  flushTimer = null;
  maintenanceTimer = null;
  safeFlush();
}

function isEnabled() {
  return enabled;
}

module.exports = {
  TELEMETRY_DIR,
  RETENTION_DAYS,
  MEMORY_HOURS,
  append,
  flushSync,
  readRange,
  pruneOldFiles,
  trimMemory,
  start,
  stop,
  isEnabled
};
