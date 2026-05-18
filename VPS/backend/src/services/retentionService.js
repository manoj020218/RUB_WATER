const telemetryRepository = require('../repositories/telemetryRepository');
const env = require('../config/env');
const { hoursAgo, sameUtcDay } = require('../utils/time');
const { createNoWaterSummary } = require('../models/telemetryModel');

function dayKey(date) {
  const d = new Date(date);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function runNoWaterCompaction(options = {}) {
  const hours = Number(options.hours || env.retentionNoWaterHours || 24);
  const cutoff = hoursAgo(hours);
  const all = telemetryRepository.listAll();

  const groups = new Map();
  for (const record of all) {
    if (record.type !== 'TELEMETRY') {
      continue;
    }
    const ts = new Date(record.timestamp);
    if (ts.getTime() < cutoff.getTime()) {
      continue;
    }

    const key = `${record.device_id}|${dayKey(ts)}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(record);
  }

  const removeIds = new Set();
  const summaries = [];
  let compactedGroups = 0;
  let removedSamples = 0;

  for (const [key, records] of groups.entries()) {
    if (records.some((item) => item.water_detected)) {
      continue;
    }

    compactedGroups += 1;
    removedSamples += records.length;

    records.forEach((item) => removeIds.add(item._id));

    const [deviceId] = key.split('|');
    const locationId = records[0].location_id;
    const avg = records.reduce((sum, item) => sum + Number(item.water_level_mm || 0), 0) / Math.max(records.length, 1);
    const day = new Date(records[0].timestamp);

    const summaryExists = all.some(
      (item) =>
        item.type === 'NO_WATER_DAY_SUMMARY' &&
        item.device_id === deviceId &&
        sameUtcDay(new Date(item.timestamp), day)
    );

    if (!summaryExists) {
      summaries.push(
        createNoWaterSummary({
          deviceId,
          locationId,
          avgLevel: Number(avg.toFixed(2)),
          sampleCount: records.length,
          day
        })
      );
    }
  }

  const kept = all.filter((item) => !removeIds.has(item._id));
  telemetryRepository.replaceAll([...kept, ...summaries]);

  return {
    cutoff_iso: cutoff.toISOString(),
    compacted_groups: compactedGroups,
    removed_samples: removedSamples,
    summaries_created: summaries.length,
    telemetry_count_after: telemetryRepository.count()
  };
}

module.exports = {
  runNoWaterCompaction
};
