const express = require('express');
const appReleaseController = require('../controllers/appReleaseController');

const router = express.Router();

router.get('/mobile', appReleaseController.getMobileRelease);

module.exports = router;
