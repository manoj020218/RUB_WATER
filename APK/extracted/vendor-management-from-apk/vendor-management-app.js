function applyVendorsTabVisibility() {
  const tab = byId('vendors-tab');
  if (tab) tab.style.display = (state.token && state.user && userRole() === 'VENDOR_SUPER_ADMIN') ? 'inline-block' : 'none';
  updateNavButtonCount();
}

async function loadVendorsApp() {
  try {
    const q = String(byId('vendor-search')?.value || '').trim();
    const project = String(byId('vendor-filter-project')?.value || '').trim();
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (project) params.set('project', project);
    const qs = params.toString();
    const data = await apiRequest(`/vendor-mgmt/vendors${qs ? '?' + qs : ''}`);
    state.vendors = data || [];
    state.vendorsFiltered = [...state.vendors];
    renderVendorList(state.vendorsFiltered);
  } catch (error) {
    setText('vendor-list', '');
    const el = byId('vendor-list');
    if (el) el.innerHTML = `<div class="empty err">Failed to load vendors: ${escHtml(error.message)}</div>`;
  }
}

async function populateVendorProjectSelects() {
  try {
    const projects = await apiRequest('/vendor-mgmt/projects');
    const filterSel = byId('vendor-filter-project');
    if (filterSel) {
      while (filterSel.options.length > 1) filterSel.remove(1);
      (projects || []).forEach((p) => {
        const opt = document.createElement('option');
        opt.value = p._id;
        opt.textContent = p.name;
        filterSel.appendChild(opt);
      });
    }
    const checkboxWrap = byId('vc-project-checkboxes');
    if (checkboxWrap) {
      checkboxWrap.innerHTML = (projects || []).map((p) =>
        `<label class="vendor-proj-check"><input type="checkbox" value="${escHtml(p._id)}" data-role="CLIENT"> ${escHtml(p.name)}</label>`
      ).join('');
    }
  } catch (_) {}
}

function renderVendorList(vendors) {
  const el = byId('vendor-list');
  if (!el) return;
  if (!vendors || vendors.length === 0) {
    el.innerHTML = '<div class="empty">No vendors found.</div>';
    return;
  }
  el.innerHTML = vendors.map((v) => {
    const statusClass = v.is_active ? 'ok' : 'off';
    const statusLabel = v.is_active ? 'Active' : 'Inactive';
    const projectTags = (v.projects || []).map((p) =>
      `<span class="vendor-project-tag">${escHtml(p.project_id)}</span>`
    ).join('');
    const adminInfo = v.admin_user
      ? `<span class="vendor-admin-id">${escHtml(v.admin_login_id)}</span>${v.admin_user.force_password_change ? '<span class="vendor-pw-flag">PW Change Pending</span>' : ''}`
      : `<span class="vendor-admin-id">${escHtml(v.admin_login_id)}</span>`;
    const masterBadge = v.is_master_vendor ? '<span class="vendor-master-badge">MASTER</span>' : '';
    return `
      <div class="vendor-card${v.is_active ? '' : ' vendor-inactive'}">
        <div class="vendor-card-head">
          <div>
            <span class="vendor-company">${escHtml(v.company_name)}</span>
            ${masterBadge}
            <span class="chip ${statusClass}" style="margin-left:6px;font-size:10px">${statusLabel}</span>
          </div>
        </div>
        <div class="vendor-meta-row">
          <span>Contact: <b>${escHtml(v.contact_name || '-')}</b></span>
          <span>Mobile: <b>${escHtml(v.mobile || '-')}</b></span>
        </div>
        <div class="vendor-meta-row">
          <span>Admin Login: ${adminInfo}</span>
        </div>
        <div class="vendor-meta-row" style="flex-wrap:wrap;gap:4px">
          ${projectTags || '<span class="hint">No projects assigned</span>'}
        </div>
        <div class="vendor-action-row">
          <button class="control-btn danger" onclick="resetVendorPasswordApp('${escHtml(v._id)}','${escHtml(v.company_name)}')">Reset Password</button>
          ${!v.is_master_vendor ? `<button class="control-btn ${v.is_active ? 'off' : 'ok'}" onclick="toggleVendorActiveApp('${escHtml(v._id)}','${escHtml(v.company_name)}')">${v.is_active ? 'Deactivate' : 'Activate'}</button>` : ''}
        </div>
      </div>`;
  }).join('');
}

function filterVendorListApp() {
  const q = String(byId('vendor-search')?.value || '').trim().toLowerCase();
  const project = String(byId('vendor-filter-project')?.value || '').trim();
  let filtered = state.vendors;
  if (project) {
    filtered = filtered.filter((v) => v.projects && v.projects.some((p) => p.project_id === project));
  }
  if (q) {
    filtered = filtered.filter((v) =>
      [v.company_name, v.mobile, v.admin_login_id, v.contact_name, v.email].join(' ').toLowerCase().includes(q)
    );
  }
  state.vendorsFiltered = filtered;
  renderVendorList(filtered);
}

async function createVendorApp() {
  const companyName = String(byId('vc-company')?.value || '').trim();
  const contactName = String(byId('vc-contact')?.value || '').trim();
  const mobile = String(byId('vc-mobile')?.value || '').trim();
  const email = String(byId('vc-email')?.value || '').trim();

  setText('vc-create-status', '');
  if (!companyName) { setText('vc-create-status', 'Company name is required.'); return; }
  if (!mobile) { setText('vc-create-status', 'Mobile number is required.'); return; }

  const checkboxes = Array.from(document.querySelectorAll('#vc-project-checkboxes input[type=checkbox]:checked'));
  const projects = checkboxes.map((cb) => ({ project_id: cb.value, role: cb.dataset.role || 'CLIENT' }));

  try {
    const result = await apiRequest('/vendor-mgmt/vendors', {
      method: 'POST',
      body: { company_name: companyName, contact_name: contactName, mobile, email, projects }
    });
    setText('vc-create-status', `Vendor created. Admin login: ${result.admin_login_id} / Default password: ${result.default_password}`);
    ['vc-company', 'vc-contact', 'vc-mobile', 'vc-email'].forEach((id) => {
      const el = byId(id); if (el) el.value = '';
    });
    document.querySelectorAll('#vc-project-checkboxes input[type=checkbox]').forEach((cb) => { cb.checked = false; });
    await loadVendorsApp();
  } catch (error) {
    setText('vc-create-status', `Failed: ${error.message}`);
  }
}

async function resetVendorPasswordApp(vendorId, companyName) {
  if (!confirm(`Reset password for ${companyName} admin to default (123456)?`)) return;
  try {
    const result = await apiRequest(`/vendor-mgmt/vendors/${vendorId}/reset-password`, { method: 'POST', body: {} });
    showToast(`Password reset. Login: ${result.admin_login_id} / 123456`);
    await loadVendorsApp();
  } catch (error) {
    showToast(`Reset failed: ${error.message}`);
  }
}

async function toggleVendorActiveApp(vendorId, companyName) {
  if (!confirm(`Toggle active status for ${companyName}?`)) return;
  try {
    await apiRequest(`/vendor-mgmt/vendors/${vendorId}/toggle-active`, { method: 'PATCH', body: {} });
    showToast('Vendor status updated.');
    await loadVendorsApp();
  } catch (error) {
    showToast(`Failed: ${error.message}`);
  }
}
