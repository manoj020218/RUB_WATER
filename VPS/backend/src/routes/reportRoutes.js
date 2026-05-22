const express = require('express');
const reportController = require('../controllers/reportController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);
router.get('/audit', reportController.getAuditReport);
router.get('/audit/download/:format', reportController.downloadAuditReport);

module.exports = router;
