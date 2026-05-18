const express = require('express');
const authRoutes = require('./authRoutes');
const deviceRoutes = require('./deviceRoutes');
const commandRoutes = require('./commandRoutes');
const monitoringRoutes = require('./monitoringRoutes');
const adminRoutes = require('./adminRoutes');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/device', deviceRoutes);
router.use('/commands', commandRoutes);
router.use('/', monitoringRoutes);
router.use('/admin', adminRoutes);

module.exports = router;
