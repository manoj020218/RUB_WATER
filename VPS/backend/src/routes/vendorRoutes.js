const express = require('express');
const vendorController = require('../controllers/vendorController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Projects reference list
router.get('/projects', vendorController.listProjects);

// Vendor CRUD
router.get('/vendors', vendorController.listVendors);
router.post('/vendors', vendorController.createVendor);
router.patch('/vendors/:vendorId', vendorController.updateVendor);
router.post('/vendors/:vendorId/reset-password', vendorController.resetVendorPassword);
router.patch('/vendors/:vendorId/toggle-active', vendorController.toggleVendorActive);

module.exports = router;
