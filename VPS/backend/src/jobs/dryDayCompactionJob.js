const retentionService = require('../services/retentionService');

function runDryDayCompactionJob(hours) {
  return retentionService.runNoWaterCompaction({ hours });
}

module.exports = {
  runDryDayCompactionJob
};
