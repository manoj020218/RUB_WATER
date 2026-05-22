const express = require('express');
const adminController = require('../controllers/adminController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Maintenance
router.post('/jobs/no-water-compaction', adminController.runNoWaterCompaction);

// Users
router.get('/users', adminController.listUsers);
router.post('/users', adminController.createUser);
router.patch('/users/:userId/access', adminController.setUserAccess);
router.post('/users/:userId/reset-password', adminController.resetUserPassword);

// Locations
router.get('/locations', adminController.listAllLocations);
router.post('/locations', adminController.createLocation);
router.patch('/locations/:locationId', adminController.updateLocation);
router.post('/locations/:locationId/bind-device', adminController.bindDevice);
router.delete('/locations/:locationId/bind-device', adminController.unbindDevice);

// Devices
router.get('/devices', adminController.listAllDevices);
router.post('/devices', adminController.createDevice);

module.exports = router;
