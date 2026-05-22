const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const vendorRepository = require('../repositories/vendorRepository');
const projectRepository = require('../repositories/projectRepository');
const userRepository = require('../repositories/userRepository');
const sessionRepository = require('../repositories/sessionRepository');
const { ROLE } = require('../config/permissions');
const { badRequest, forbidden, notFound, conflict } = require('../utils/errors');

function requireVendorSuperAdmin(req) {
  if (req.auth.user.role !== ROLE.VENDOR_SUPER_ADMIN) {
    throw forbidden('Vendor management requires VENDOR_SUPER_ADMIN role');
  }
}

function slugify(str) {
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);
}

function buildSearchableLower(vendor) {
  return [
    vendor.company_name || '',
    vendor.mobile || '',
    vendor.admin_login_id || '',
    vendor.contact_name || '',
    vendor.email || ''
  ]
    .join(' ')
    .toLowerCase();
}

// GET /vendor-mgmt/vendors?q=&project=
function listVendors(req, res, next) {
  try {
    requireVendorSuperAdmin(req);
    const q = String(req.query.q || '').trim().toLowerCase();
    const projectFilter = String(req.query.project || '').trim();

    let vendors = vendorRepository.findAll();

    if (projectFilter) {
      vendors = vendors.filter((v) =>
        v.projects && v.projects.some((p) => p.project_id === projectFilter)
      );
    }

    if (q) {
      vendors = vendors.filter((v) => buildSearchableLower(v).includes(q));
    }

    const result = vendors.map((v) => ({
      ...v,
      admin_user: (() => {
        const u = userRepository.findById(v.admin_user_id);
        return u
          ? { login_id: u.login_id, name: u.name, is_active: u.is_active, force_password_change: u.force_password_change || false }
          : null;
      })()
    }));

    res.json({ ok: true, data: result });
  } catch (error) {
    next(error);
  }
}

// POST /vendor-mgmt/vendors
async function createVendor(req, res, next) {
  try {
    requireVendorSuperAdmin(req);

    const { company_name, contact_name, mobile, email, projects: reqProjects, admin_login_id: customLoginId, admin_password: customPassword } = req.body || {};
    if (!company_name || String(company_name).trim().length < 2) {
      throw badRequest('company_name is required (min 2 chars)');
    }
    if (!mobile || String(mobile).trim().length < 6) {
      throw badRequest('mobile is required');
    }

    const slug = slugify(company_name);
    const vendorId = `vendor_${slug}_${Date.now().toString(36)}`;
    const adminLoginId = customLoginId ? String(customLoginId).trim().toLowerCase() : `${slug}_admin`;

    if (!adminLoginId || adminLoginId.length < 3) {
      throw badRequest('admin_login_id must be at least 3 characters');
    }

    const existingVendorWithLogin = vendorRepository.findByAdminLoginId(adminLoginId);
    if (existingVendorWithLogin) {
      throw conflict(`Admin login ID "${adminLoginId}" already exists.`);
    }
    if (userRepository.findByLoginId(adminLoginId)) {
      throw conflict(`Login ID "${adminLoginId}" is already taken.`);
    }

    const projectsToAssign = Array.isArray(reqProjects)
      ? reqProjects.map((p) => ({
          project_id: String(p.project_id || p).trim(),
          role: String(p.role || 'CLIENT').toUpperCase()
        }))
      : [];

    const defaultPassword = customPassword && String(customPassword).trim().length >= 6
      ? String(customPassword).trim()
      : '123456';
    const isCustomPassword = Boolean(customPassword && String(customPassword).trim().length >= 6);
    const passwordHash = await bcrypt.hash(defaultPassword, 10);
    const userId = `user_${vendorId}_admin`;
    const now = new Date().toISOString();

    const adminUser = {
      _id: userId,
      login_id: adminLoginId,
      password_hash: passwordHash,
      name: `${String(company_name).trim()} Admin`,
      role: ROLE.VENDOR_SUPER_ADMIN,
      vendor_id: vendorId,
      department_id: null,
      assigned_location_ids: [],
      force_password_change: !isCustomPassword,
      is_active: true,
      created_at: now,
      updated_at: now
    };
    userRepository.insert(adminUser);

    const vendor = {
      _id: vendorId,
      company_name: String(company_name).trim(),
      contact_name: String(contact_name || '').trim(),
      mobile: String(mobile).trim(),
      email: String(email || '').trim(),
      is_master_vendor: false,
      projects: projectsToAssign,
      admin_login_id: adminLoginId,
      admin_user_id: userId,
      is_active: true,
      created_at: now,
      updated_at: now
    };
    vendorRepository.create(vendor);

    res.status(201).json({
      ok: true,
      data: {
        vendor,
        admin_login_id: adminLoginId,
        default_password: defaultPassword,
        force_password_change: !isCustomPassword
      }
    });
  } catch (error) {
    next(error);
  }
}

// PATCH /vendor-mgmt/vendors/:vendorId
function updateVendor(req, res, next) {
  try {
    requireVendorSuperAdmin(req);

    const vendor = vendorRepository.findById(req.params.vendorId);
    if (!vendor) {
      throw notFound('Vendor not found');
    }

    const { company_name, contact_name, mobile, email, projects: reqProjects } = req.body || {};
    const patch = { updated_at: new Date().toISOString() };

    if (company_name !== undefined) {
      patch.company_name = String(company_name).trim();
    }
    if (contact_name !== undefined) {
      patch.contact_name = String(contact_name).trim();
    }
    if (mobile !== undefined) {
      patch.mobile = String(mobile).trim();
    }
    if (email !== undefined) {
      patch.email = String(email).trim();
    }
    if (Array.isArray(reqProjects)) {
      patch.projects = reqProjects.map((p) => ({
        project_id: String(p.project_id || p).trim(),
        role: String(p.role || 'CLIENT').toUpperCase()
      }));
    }

    const updated = vendorRepository.update(vendor._id, patch);
    res.json({ ok: true, data: updated });
  } catch (error) {
    next(error);
  }
}

// POST /vendor-mgmt/vendors/:vendorId/reset-password
async function resetVendorPassword(req, res, next) {
  try {
    requireVendorSuperAdmin(req);

    const vendor = vendorRepository.findById(req.params.vendorId);
    if (!vendor) {
      throw notFound('Vendor not found');
    }

    const adminUser = userRepository.findById(vendor.admin_user_id);
    if (!adminUser) {
      throw notFound('Vendor admin user not found');
    }

    const defaultPassword = '123456';
    const passwordHash = await bcrypt.hash(defaultPassword, 10);

    userRepository.update(adminUser._id, {
      password_hash: passwordHash,
      force_password_change: true,
      updated_at: new Date().toISOString()
    });

    sessionRepository.deactivateByUserId(adminUser._id);

    res.json({
      ok: true,
      data: {
        vendor_id: vendor._id,
        admin_login_id: vendor.admin_login_id,
        reset_at: new Date().toISOString(),
        default_password: defaultPassword,
        force_password_change: true
      }
    });
  } catch (error) {
    next(error);
  }
}

// PATCH /vendor-mgmt/vendors/:vendorId/toggle-active
function toggleVendorActive(req, res, next) {
  try {
    requireVendorSuperAdmin(req);

    const vendor = vendorRepository.findById(req.params.vendorId);
    if (!vendor) {
      throw notFound('Vendor not found');
    }
    if (vendor.is_master_vendor) {
      throw forbidden('Cannot deactivate the master vendor');
    }

    const now = new Date().toISOString();
    const updated = vendorRepository.update(vendor._id, {
      is_active: !vendor.is_active,
      updated_at: now
    });

    if (vendor.admin_user_id) {
      userRepository.update(vendor.admin_user_id, {
        is_active: updated.is_active,
        updated_at: now
      });
      if (!updated.is_active) {
        sessionRepository.deactivateByUserId(vendor.admin_user_id);
      }
    }

    res.json({ ok: true, data: updated });
  } catch (error) {
    next(error);
  }
}

// GET /vendor-mgmt/projects
function listProjects(req, res, next) {
  try {
    requireVendorSuperAdmin(req);
    res.json({ ok: true, data: projectRepository.findAll() });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listVendors,
  createVendor,
  updateVendor,
  resetVendorPassword,
  toggleVendorActive,
  listProjects
};
