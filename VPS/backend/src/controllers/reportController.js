const auditReportService = require('../services/auditReportService');

function getAuditReport(req, res, next) {
  try {
    const data = auditReportService.buildReport({
      filters: req.query,
      authContext: req.auth
    });
    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

function downloadAuditReport(req, res, next) {
  try {
    const report = auditReportService.exportReport({
      filters: { ...req.query, format: req.params.format },
      authContext: req.auth
    });
    res.setHeader('Content-Type', report.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${report.filename}"`);
    res.status(200).send(report.body);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getAuditReport,
  downloadAuditReport
};
