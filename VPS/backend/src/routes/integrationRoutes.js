const express = require('express');
const integrationController = require('../controllers/integrationController');
const { requireAuth } = require('../middleware/auth');
const { requireIntegrationToken } = require('../middleware/integrationAuth');

const router = express.Router();

router.get('/settings', requireAuth, integrationController.listSettings);
router.put('/settings', requireAuth, integrationController.upsertSetting);
router.get('/delivery-logs', requireAuth, integrationController.listDeliveryLogs);

router.use('/v1', requireIntegrationToken);
router.get('/v1/locations', integrationController.listLocations);
router.get('/v1/locations/:locationId/live', integrationController.getLocationLive);
router.get('/v1/locations/:locationId/incidents', integrationController.getLocationIncidents);
router.get('/v1/locations/:locationId/audit-logs', integrationController.getLocationAuditLogs);
router.get('/v1/devices/:deviceId/status', integrationController.getDeviceStatus);
router.get('/v1/summary', integrationController.getSummary);

module.exports = router;
