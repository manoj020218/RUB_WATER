const express = require('express');
const { requireAuth } = require('../middleware/auth');
const deviceConfigController = require('../controllers/deviceConfigController');

const router = express.Router();

router.use(requireAuth);
router.get('/:deviceId/config', deviceConfigController.getDeviceConfig);
router.put('/:deviceId/config', deviceConfigController.putDeviceConfig);
router.post('/:deviceId/config/push', deviceConfigController.pushDeviceConfig);
router.get('/:deviceId/config/history', deviceConfigController.getDeviceConfigHistory);

module.exports = router;
