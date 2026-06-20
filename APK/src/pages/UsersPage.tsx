import { useEffect, useState, useCallback } from 'react';
import { FiUsers, FiRefreshCw, FiUserCheck, FiUserX, FiKey } from 'react-icons/fi';
import { useApp } from '@/context/AppContext';
import { fetchAdminUsers, createUser, toggleUserAccess, resetUserPassword } from '@/api/users';
import { AdminUser } from '@/types';

export default function UsersPage() {
  const { state, showToast } = useApp();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [expandReset, setExpandReset] = useState<string | null>(null);
  const [resetPw, setResetPw] = useState('');
  const [createStatus, setCreateStatus] = useState('');

  const [uLogin, setULogin] = useState('');
  const [uName, setUName] = useState('');
  const [uPw, setUPw] = useState('');
  const [uRole, setURole] = useState('OPERATOR');
  const [uLocs, setULocs] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try { setUsers(await fetchAdminUsers()); } catch (e: unknown) { showToast(e instanceof Error ? e.message : 'Failed', true); } finally { setLoading(false); }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  async function handleCreate() {
    if (!uLogin.trim() || !uName.trim() || !uPw) { setCreateStatus('All fields required.'); return; }
    if (uPw.length < 6) { setCreateStatus('Password must be at least 6 characters.'); return; }
    setCreateStatus('Creating…');
    try {
      await createUser({ login_id: uLogin.trim(), name: uName.trim(), password: uPw, role: uRole, assigned_locations: uLocs ? uLocs.split(',').map((s) => s.trim()).filter(Boolean) : undefined });
      setCreateStatus('User created.');
      setULogin(''); setUName(''); setUPw(''); setULocs('');
      load();
    } catch (e: unknown) { setCreateStatus(e instanceof Error ? e.message : 'Failed'); }
  }

  async function handleToggle(userId: string, activate: boolean) {
    try { await toggleUserAccess(userId, activate); showToast(`User ${activate ? 'activated' : 'deactivated'}.`); load(); } catch (e: unknown) { showToast(e instanceof Error ? e.message : 'Failed', true); }
  }

  async function handleReset(userId: string) {
    if (!resetPw || resetPw.length < 6) { showToast('Password must be at least 6 chars.', true); return; }
    try { await resetUserPassword(userId, resetPw); showToast('Password reset.'); setExpandReset(null); setResetPw(''); } catch (e: unknown) { showToast(e instanceof Error ? e.message : 'Failed', true); }
  }

  const visible = users.filter((u) => {
    if (filter && u.role !== filter) return false;
    if (statusFilter === 'active' && !u.is_active) return false;
    if (statusFilter === 'inactive' && u.is_active) return false;
    return true;
  });

  return (
    <section className="view active" id="view-users">
      <div className="card">
        <div className="row between">
          <h2 className="view-title"><FiUsers size={16} style={{ marginRight: 8 }} />User Management</h2>
          <button className="ghost-btn" style={{ padding: '5px 10px' }} onClick={load}><FiRefreshCw size={14} /></button>
        </div>

        <div className="user-filter-row">
          <select className="inp" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">All Roles</option>
            <option value="VENDOR_SUPER_ADMIN">Vendor Super Admin</option>
            <option value="VENDOR_MONITORING_USER">Vendor Monitoring</option>
            <option value="DEPARTMENT_SUPER_ADMIN">Dept Super Admin</option>
            <option value="DEPARTMENT_ADMIN">Dept Admin</option>
            <option value="OPERATOR">Operator</option>
            <option value="VIEWER">Viewer</option>
          </select>
          <select className="inp" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>

        <div className="timeline">
          {loading && <div className="empty">Loading users…</div>}
          {!loading && visible.length === 0 && <div className="empty">No users found.</div>}
          {visible.map((u) => (
            <div key={u.id} style={{ padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
              <div className="row between" style={{ alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{u.name}</div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{u.login_id} · {u.role?.replace(/_/g, ' ')}</div>
                  {u.assigned_locations && u.assigned_locations.length > 0 && (
                    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>Locations: {u.assigned_locations.join(', ')}</div>
                  )}
                </div>
                <span className={`chip ${u.is_active ? '' : 'off'}`} style={{ fontSize: 10 }}>{u.is_active ? 'ACTIVE' : 'INACTIVE'}</span>
              </div>
              <div className="row" style={{ gap: 6, marginTop: 8 }}>
                <button className="ghost-btn" style={{ fontSize: 11, padding: '4px 8px' }} onClick={() => handleToggle(u.id, !u.is_active)}>
                  {u.is_active ? <><FiUserX size={11} style={{ marginRight: 3 }} />Deactivate</> : <><FiUserCheck size={11} style={{ marginRight: 3 }} />Activate</>}
                </button>
                <button className="ghost-btn" style={{ fontSize: 11, padding: '4px 8px' }} onClick={() => { setExpandReset(expandReset === u.id ? null : u.id); setResetPw(''); }}>
                  <FiKey size={11} style={{ marginRight: 3 }} />Reset PW
                </button>
              </div>
              {expandReset === u.id && (
                <div className="row" style={{ gap: 6, marginTop: 6 }}>
                  <input className="inp" type="password" value={resetPw} onChange={(e) => setResetPw(e.target.value)} placeholder="New password (min 6 chars)" style={{ flex: 1 }} />
                  <button className="control-btn info" style={{ marginTop: 0, padding: '6px 10px' }} onClick={() => handleReset(u.id)}>Set</button>
                </div>
              )}
            </div>
          ))}
        </div>

        <p className="section-sep">Create New User</p>
        <div className="user-create-grid">
          <input className="inp" value={uLogin} onChange={(e) => setULogin(e.target.value)} placeholder="Login ID (e.g. op_rub043)" autoCapitalize="none" />
          <input className="inp" value={uName} onChange={(e) => setUName(e.target.value)} placeholder="Full name" />
          <input className="inp" type="password" value={uPw} onChange={(e) => setUPw(e.target.value)} placeholder="Password (min 6 chars)" />
          <select className="inp" value={uRole} onChange={(e) => setURole(e.target.value)}>
            <option value="OPERATOR">Operator</option>
            <option value="VIEWER">Viewer</option>
            <option value="DEPARTMENT_ADMIN">Department Admin</option>
            <option value="DEPARTMENT_SUPER_ADMIN">Dept Super Admin</option>
            <option value="VENDOR_MONITORING_USER">Vendor Monitoring</option>
          </select>
        </div>
        <input className="inp" value={uLocs} onChange={(e) => setULocs(e.target.value)} placeholder="Assigned locations (RUB043, RUB057)" style={{ marginTop: 4 }} />
        <button className="control-btn info" style={{ marginTop: 8 }} onClick={handleCreate}>Create User</button>
        {createStatus && <div className="meta">{createStatus}</div>}
      </div>
    </section>
  );
}
