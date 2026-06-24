const fs = require('fs');
const path = require('path');
const deviceRepository = require('../repositories/deviceRepository');
const { badRequest, notFound } = require('../utils/errors');

const jobFilePath = path.resolve(process.cwd(), 'data', 'device_ota_jobs.json');
const terminalStatuses = new Set(['completed', 'failed', 'cancelled', 'cleared', 'replaced']);

function normalizeDeviceId(value) {
  return String(value || '').trim().toUpperCase();
}

function ensureJobDir() {
  fs.mkdirSync(path.dirname(jobFilePath), { recursive: true });
}

function loadJobs() {
  try {
    if (!fs.existsSync(jobFilePath)) {
      return [];
    }
    const raw = fs.readFileSync(jobFilePath, 'utf8').replace(/^\uFEFF/, '').trim();
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('[Device OTA] Failed to load jobs:', error.message);
    return [];
  }
}

function saveJobs(jobs) {
  ensureJobDir();
  const tmp = `${jobFilePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(jobs, null, 2));
  fs.renameSync(tmp, jobFilePath);
}

function findActiveJob(jobs, deviceId) {
  return jobs
    .filter((job) => normalizeDeviceId(job.device_id) === deviceId && !terminalStatuses.has(String(job.status || '').toLowerCase()))
    .sort((left, right) => new Date(right.updated_at || right.created_at || 0).getTime() - new Date(left.updated_at || left.created_at || 0).getTime())[0] || null;
}

function getPendingOtaJob(req, res, next) {
  try {
    const deviceId = normalizeDeviceId(req.params.deviceId);
    const device = deviceRepository.findById(deviceId);
    if (!device) {
      throw notFound('Device not found');
    }

    const jobs = loadJobs();
    const job = findActiveJob(jobs, deviceId);
    if (!job) {
      return res.json({ ok: true, data: { pending: false } });
    }

    const now = new Date().toISOString();
    job.last_polled_at = now;
    job.updated_at = now;
    job.delivery_count = Number(job.delivery_count || 0) + 1;
    if (!job.first_polled_at) {
      job.first_polled_at = now;
    }
    saveJobs(jobs);

    return res.json({
      ok: true,
      data: {
        pending: true,
        job_id: String(job.job_id || ''),
        version: String(job.version || ''),
        url: String(job.url || ''),
        sha256: String(job.sha256 || ''),
        size: Number(job.size || 0),
        force: Boolean(job.force),
        status: String(job.status || 'queued'),
        created_at: job.created_at || null,
        release_notes: String(job.release_notes || '')
      }
    });
  } catch (error) {
    next(error);
  }
}

function reportOtaJob(req, res, next) {
  try {
    const deviceId = normalizeDeviceId(req.params.deviceId);
    const jobId = String(req.body?.job_id || '').trim();
    if (!jobId) {
      throw badRequest('job_id is required');
    }

    const jobs = loadJobs();
    const job = jobs.find((item) => normalizeDeviceId(item.device_id) === deviceId && String(item.job_id) === jobId);
    if (!job) {
      throw notFound('OTA job not found for device');
    }

    const now = new Date().toISOString();
    const status = String(req.body?.status || '').trim().toLowerCase();
    if (status) {
      job.status = status;
      if (status === 'completed') {
        job.completed_at = now;
      }
      if (status === 'failed') {
        job.failed_at = now;
      }
      if (status === 'cancelled') {
        job.cancelled_at = now;
      }
    }

    if (req.body?.error) {
      job.last_error = String(req.body.error);
    }
    if (Number.isFinite(Number(req.body?.bytes_written))) {
      job.bytes_written = Number(req.body.bytes_written);
    }
    if (Number.isFinite(Number(req.body?.total_bytes))) {
      job.total_bytes = Number(req.body.total_bytes);
    }
    if (req.body?.firmware_version) {
      job.reported_firmware_version = String(req.body.firmware_version);
    }
    if (req.body?.hardware_version) {
      job.reported_hardware_version = String(req.body.hardware_version);
    }

    job.last_reported_at = now;
    job.updated_at = now;
    job.report_count = Number(job.report_count || 0) + 1;
    saveJobs(jobs);

    return res.json({
      ok: true,
      data: {
        job_id: job.job_id,
        status: job.status,
        bytes_written: Number(job.bytes_written || 0),
        total_bytes: Number(job.total_bytes || 0),
        last_reported_at: job.last_reported_at
      }
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getPendingOtaJob,
  reportOtaJob
};

