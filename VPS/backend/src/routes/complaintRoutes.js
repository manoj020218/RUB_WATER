const express = require('express');
const complaintController = require('../controllers/complaintController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);
router.post('/', complaintController.raiseComplaint);
router.get('/', complaintController.listComplaints);
router.get('/:complaintId', complaintController.getComplaint);
router.patch('/:complaintId/acknowledge', complaintController.acknowledgeComplaint);
router.patch('/:complaintId/assign', complaintController.assignComplaint);
router.post('/:complaintId/comments', complaintController.addComment);
router.patch('/:complaintId/resolve', complaintController.resolveComplaint);
router.patch('/:complaintId/close', complaintController.closeComplaint);

module.exports = router;
