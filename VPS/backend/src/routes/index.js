const express = require('express');
const authRoutes = require('./authRoutes');
const deviceRoutes = require('./deviceRoutes');
const commandRoutes = require('./commandRoutes');
const monitoringRoutes = require('./monitoringRoutes');
const adminRoutes = require('./adminRoutes');
const deviceConfigRoutes = require('./deviceConfigRoutes');
const complaintRoutes = require('./complaintRoutes');
const reportRoutes = require('./reportRoutes');
const integrationRoutes = require('./integrationRoutes');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/device', deviceRoutes);
router.use('/commands', commandRoutes);
router.use('/devices', deviceConfigRoutes);
router.use('/complaints', complaintRoutes);
router.use('/reports', reportRoutes);
router.use('/integration', integrationRoutes);
router.use('/', monitoringRoutes);
router.use('/admin', adminRoutes);

module.exports = router;
