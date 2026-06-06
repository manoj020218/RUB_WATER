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
const vendorRoutes = require('./vendorRoutes');
const appReleaseRoutes = require('./appReleaseRoutes');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/device', deviceRoutes);
router.use('/commands', commandRoutes);
router.use('/devices', deviceConfigRoutes);
router.use('/complaints', complaintRoutes);
router.use('/reports', reportRoutes);
router.use('/integration', integrationRoutes);
router.use('/app-release', appReleaseRoutes);
router.use('/', monitoringRoutes);
router.use('/admin', adminRoutes);
router.use('/vendor-mgmt', vendorRoutes);

module.exports = router;
