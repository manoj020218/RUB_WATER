const retentionService = require('../services/retentionService');
const adminUserService = require('../services/adminUserService');
const { assertPermission } = require('../services/rbacService');

function runNoWaterCompaction(req, res, next) {
  try {
    assertPermission(req.auth.user.role, 'RUN_ADMIN_JOB');
    const result = retentionService.runNoWaterCompaction({
      hours: req.body?.hours
    });
    res.json({ ok: true, data: result });
  } catch (error) {
    next(error);
  }
}

function listUsers(req, res, next) {
  try {
    const data = adminUserService.listManagedUsers(req.auth);
    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

async function createUser(req, res, next) {
  try {
    const data = await adminUserService.createManagedUser({
      loginId: req.body?.login_id,
      password: req.body?.password,
      name: req.body?.name,
      role: req.body?.role,
      assignedLocationIds: req.body?.assigned_location_ids,
      vendorId: req.body?.vendor_id,
      departmentId: req.body?.department_id,
      isActive: req.body?.is_active,
      authContext: req.auth,
      ipAddress: req.ip
    });

    res.status(201).json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

function setUserAccess(req, res, next) {
  try {
    const data = adminUserService.setManagedUserAccess({
      userId: req.params.userId,
      isActive: req.body?.is_active,
      reason: req.body?.reason,
      authContext: req.auth,
      ipAddress: req.ip
    });

    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  runNoWaterCompaction,
  listUsers,
  createUser,
  setUserAccess
};
