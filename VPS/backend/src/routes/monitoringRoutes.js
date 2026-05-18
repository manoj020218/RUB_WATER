const express = require('express');
const monitoringController = require('../controllers/monitoringController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);
router.get('/locations', monitoringController.listLocations);
router.get('/locations/:locationId/dashboard', monitoringController.getLocationDashboard);
router.get('/incidents', monitoringController.listIncidents);
router.get('/audit-logs', monitoringController.listAuditLogs);

module.exports = router;
