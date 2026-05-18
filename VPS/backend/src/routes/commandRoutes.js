const express = require('express');
const commandController = require('../controllers/commandController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);
router.post('/mute', commandController.muteAlarm);
router.post('/dry-run', commandController.dryRun);
router.post('/force-clear', commandController.forceClear);

module.exports = router;
