const express = require('express');
const deviceController = require('../controllers/deviceController');
const { requireApiKeyOrKnownDevice, attachProxyActor } = require('../middleware/tenant');

const router = express.Router();

router.post('/register', deviceController.registerDevice);

router.use(requireApiKeyOrKnownDevice, attachProxyActor);

router.post('/telemetry', deviceController.ingestTelemetry);
router.post('/event', deviceController.ingestEvent);
router.post('/:deviceId/telemetry', deviceController.ingestTelemetry);
router.post('/:deviceId/event', deviceController.ingestEvent);
router.get('/:deviceId/commands/pending', deviceController.getPendingCommands);
router.post('/commands/:commandId/ack', deviceController.ackCommand);
router.post('/command_ack', deviceController.ackCommandLegacy);
router.post('/config_ack', deviceController.ackConfig);
router.get('/:deviceId/config', deviceController.getDeviceConfig);
router.get('/:deviceId/action-sheet', deviceController.getDeviceActionSheet);
router.post('/:deviceId/action-sheet/report', deviceController.reportDeviceActionSheet);
router.get('/:deviceId/firmware/latest', deviceController.getLatestFirmware);

module.exports = router;
