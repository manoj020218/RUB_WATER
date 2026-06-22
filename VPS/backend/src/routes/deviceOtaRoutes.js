const express = require('express');
const deviceOtaController = require('../controllers/deviceOtaController');
const { requireApiKeyOrKnownDevice, attachProxyActor } = require('../middleware/tenant');

const router = express.Router();

router.use(requireApiKeyOrKnownDevice, attachProxyActor);
router.get('/:deviceId/pending', deviceOtaController.getPendingOtaJob);
router.post('/:deviceId/report', deviceOtaController.reportOtaJob);

module.exports = router;
