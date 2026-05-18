const express = require('express');
const adminController = require('../controllers/adminController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);
router.post('/jobs/no-water-compaction', adminController.runNoWaterCompaction);
router.get('/users', adminController.listUsers);
router.post('/users', adminController.createUser);
router.patch('/users/:userId/access', adminController.setUserAccess);

module.exports = router;
