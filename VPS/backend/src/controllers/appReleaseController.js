const fs = require('fs');
const path = require('path');
const env = require('../config/env');
const { notFound } = require('../utils/errors');

const releaseManifestPath = path.resolve(process.cwd(), 'app-release.json');

function readReleaseManifest() {
  if (!fs.existsSync(releaseManifestPath)) {
    throw notFound(`Release manifest not found at ${releaseManifestPath}`);
  }

  const raw = fs.readFileSync(releaseManifestPath, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

function buildAbsoluteDownloadUrl(downloadPath) {
  const normalizedPath = String(downloadPath || '').trim();
  if (!normalizedPath) {
    return '';
  }
  if (/^https?:\/\//i.test(normalizedPath)) {
    return normalizedPath;
  }

  const baseUrl = String(env.publicApiBaseUrl || '').trim().replace(/\/+$/, '');
  return `${baseUrl}${normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`}`;
}

function getMobileRelease(req, res) {
  const manifest = readReleaseManifest();
  const android = manifest?.android;
  if (!android) {
    throw notFound('Android release metadata is not configured.');
  }

  res.json({
    ok: true,
    data: {
      channel: 'vps',
      platform: 'android',
      version: String(android.version || ''),
      versionCode: Number(android.versionCode || 0),
      releasedAt: String(android.releasedAt || ''),
      releasedLabel: String(android.releasedLabel || ''),
      minimumSupportedVersionCode: Number(android.minimumSupportedVersionCode || 0),
      forceUpdate: Boolean(android.forceUpdate),
      fileName: String(android.fileName || ''),
      downloadUrl: buildAbsoluteDownloadUrl(android.downloadPath),
      downloadPath: String(android.downloadPath || ''),
      notes: Array.isArray(android.notes) ? android.notes.map((item) => String(item)) : []
    }
  });
}

module.exports = {
  getMobileRelease
};
