const complaintService = require('../services/complaintService');

function raiseComplaint(req, res, next) {
  try {
    const data = complaintService.raiseComplaint({
      payload: req.body,
      authContext: req.auth,
      ipAddress: req.ip
    });
    res.status(201).json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

function listComplaints(req, res, next) {
  try {
    const data = complaintService.listComplaints({
      filters: {
        location_id: req.query.location_id,
        device_id: req.query.device_id,
        status: req.query.status,
        assigned_to_user_id: req.query.assigned_to_user_id,
        raised_by_user_id: req.query.raised_by_user_id
      },
      authContext: req.auth
    });
    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

function getComplaint(req, res, next) {
  try {
    const data = complaintService.getComplaint({
      complaintId: req.params.complaintId,
      authContext: req.auth
    });
    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

function acknowledgeComplaint(req, res, next) {
  try {
    const data = complaintService.acknowledgeComplaint({
      complaintId: req.params.complaintId,
      note: req.body?.note,
      authContext: req.auth,
      ipAddress: req.ip
    });
    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

function assignComplaint(req, res, next) {
  try {
    const data = complaintService.assignComplaint({
      complaintId: req.params.complaintId,
      assignedToUserId: req.body?.assigned_to_user_id,
      note: req.body?.note,
      authContext: req.auth,
      ipAddress: req.ip
    });
    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

function addComment(req, res, next) {
  try {
    const data = complaintService.addComplaintComment({
      complaintId: req.params.complaintId,
      note: req.body?.note,
      authContext: req.auth,
      ipAddress: req.ip
    });
    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

function resolveComplaint(req, res, next) {
  try {
    const data = complaintService.resolveComplaint({
      complaintId: req.params.complaintId,
      note: req.body?.note,
      authContext: req.auth,
      ipAddress: req.ip
    });
    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

function closeComplaint(req, res, next) {
  try {
    const data = complaintService.closeComplaint({
      complaintId: req.params.complaintId,
      note: req.body?.note,
      authContext: req.auth,
      ipAddress: req.ip
    });
    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  raiseComplaint,
  listComplaints,
  getComplaint,
  acknowledgeComplaint,
  assignComplaint,
  addComment,
  resolveComplaint,
  closeComplaint
};
