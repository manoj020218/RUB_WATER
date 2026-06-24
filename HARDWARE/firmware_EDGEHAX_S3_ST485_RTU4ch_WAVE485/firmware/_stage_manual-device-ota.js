#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const projectRoot = path.resolve(__dirname, '..');
const backendDataFile = path.resolve(projectRoot, 'repo', 'VPS', 'backend', 'data', 'device_ota_jobs.json');
const otaDir = '/var/www/floodguard-ota';
const otaBaseUrl = 'https://api.floodguard.iotsoft.in/ota';
const terminalStatuses = new Set(['completed', 'failed', 'cancelled', 'cleared', 'replaced']);

function usage() {
  console.log('Usage:');
  console.log('  manual-device-ota.js queue <DEVICE_ID> <VERSION> <FILE_NAME> [--force]');
  console.log('  manual-device-ota.js status [DEVICE_ID]');
  console.log('  manual-device-ota.js clear <DEVICE_ID>');
}

function normalizeDeviceId(value) {
  return String(value || '').trim().toUpperCase();
}

function ensureStoreDir() {
  fs.mkdirSync(path.dirname(backendDataFile), { recursive: true });
}

function loadJobs() {
  try {
    if (!fs.existsSync(backendDataFile)) {
      return [];
    }
    const raw = fs.readFileSync(backendDataFile, 'utf8').replace(/^\\uFEFF/, '').trim();
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('[manual-device-ota] Failed to load job store:', error.message);
    process.exit(1);
  }
}

function saveJobs(jobs) {
  ensureStoreDir();
  const tmp = `${backendDataFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(jobs, null, 2));
  fs.renameSync(tmp, backendDataFile);
}

function activeForDevice(jobs, deviceId) {
  return jobs.filter((job) => normalizeDeviceId(job.device_id) === deviceId && !terminalStatuses.has(String(job.status || '').toLowerCase()));
}

function buildUrl(fileName) {
  return `${otaBaseUrl}/${String(fileName).split('/').map(encodeURIComponent).join('/')}`;
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function queueJob(deviceIdRaw, version, fileName, force) {
  const deviceId = normalizeDeviceId(deviceIdRaw);
  const localPath = path.join(otaDir, fileName);
  if (!deviceId || !version || !fileName) {
    usage();
    process.exit(1);
  }
  if (!fs.existsSync(localPath)) {
    console.error(`Firmware file not found: ${localPath}`);
    process.exit(1);
  }

  const jobs = loadJobs();
  const now = new Date().toISOString();
  activeForDevice(jobs, deviceId).forEach((job) => {
    job.status = 'replaced';
    job.updated_at = now;
    job.replaced_at = now;
  });

  const size = fs.statSync(localPath).size;
  const sha256 = sha256File(localPath);
  const job = {
    job_id: `ota_${deviceId}_${Date.now()}`,
    device_id: deviceId,
    version: String(version),
    file_name: String(fileName),
    url: buildUrl(fileName),
    sha256,
    size,
    force: Boolean(force),
    status: 'queued',
    created_at: now,
    updated_at: now,
    delivery_count: 0,
    report_count: 0,
    bytes_written: 0,
    total_bytes: size,
    last_error: null
  };
  jobs.push(job);
  saveJobs(jobs);

  console.log(JSON.stringify({
    ok: true,
    action: 'queued',
    job_id: job.job_id,
    device_id: job.device_id,
    version: job.version,
    url: job.url,
    sha256: job.sha256,
    size: job.size,
    force: job.force
  }, null, 2));
}

function showStatus(deviceIdRaw) {
  const deviceId = normalizeDeviceId(deviceIdRaw);
  const jobs = loadJobs();
  const filtered = deviceId ? jobs.filter((job) => normalizeDeviceId(job.device_id) === deviceId) : jobs;
  console.log(JSON.stringify(filtered, null, 2));
}

function clearJobs(deviceIdRaw) {
  const deviceId = normalizeDeviceId(deviceIdRaw);
  if (!deviceId) {
    usage();
    process.exit(1);
  }

  const jobs = loadJobs();
  const now = new Date().toISOString();
  let changed = 0;
  jobs.forEach((job) => {
    if (normalizeDeviceId(job.device_id) === deviceId && !terminalStatuses.has(String(job.status || '').toLowerCase())) {
      job.status = 'cleared';
      job.updated_at = now;
      job.cleared_at = now;
      changed += 1;
    }
  });
  saveJobs(jobs);
  console.log(JSON.stringify({ ok: true, action: 'cleared', device_id: deviceId, jobs_cleared: changed }, null, 2));
}

const [command, arg1, arg2, arg3, arg4] = process.argv.slice(2);
if (!command) {
  usage();
  process.exit(1);
}

if (command === 'queue') {
  queueJob(arg1, arg2, arg3, arg4 === '--force');
} else if (command === 'status') {
  showStatus(arg1);
} else if (command === 'clear') {
  clearJobs(arg1);
} else {
  usage();
  process.exit(1);
}

