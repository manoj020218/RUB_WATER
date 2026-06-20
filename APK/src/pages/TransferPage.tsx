import { useState } from 'react';
import { FiSend, FiUserPlus, FiMapPin } from 'react-icons/fi';
import { useApp } from '@/context/AppContext';
import { apiRequest } from '@/api/client';

type RightsMode = 'MOVE' | 'SHARE' | 'GRANT_RECEIVER' | 'REVOKE_SENDER';

const RIGHTS_DESCRIPTIONS: Record<RightsMode, string> = {
  MOVE: 'Transfer ownership — receiver gets access, sender loses access.',
  SHARE: 'Share access — both sender and receiver get access.',
  GRANT_RECEIVER: 'Grant receiver access only (sender keeps access).',
  REVOKE_SENDER: 'Revoke sender access only (no receiver needed).',
};

async function transferLocation(body: object) {
  return apiRequest<object>('/admin/location-transfers', { method: 'POST', auth: true, body });
}

export default function TransferPage() {
  const { state, canUseTransferPipeline, isSuperAdmin, showToast } = useApp();

  const [locationId, setLocationId] = useState('');
  const [rights, setRights] = useState<RightsMode>('MOVE');
  const [receiverLogin, setReceiverLogin] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  // Create-user-and-transfer fields
  const [createMode, setCreateMode] = useState(false);
  const [newLogin, setNewLogin] = useState('');
  const [newName, setNewName] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newRole, setNewRole] = useState('DEPARTMENT_SUPER_ADMIN');

  const isDemoUser = state.user?.loginId === 'demo';

  if (!isSuperAdmin()) {
    return (
      <section className="view active" id="view-transfer">
        <div className="card">
          <h2 className="view-title">Transfer Location</h2>
          <div style={{ padding: '20px 0', textAlign: 'center', color: '#757575', fontSize: 13 }}>
            Location transfer is available to Vendor Super Admins only.
          </div>
        </div>
      </section>
    );
  }

  async function handleTransfer() {
    if (!locationId.trim()) { setStatus('Select a location first.'); return; }
    const needsReceiver = rights !== 'REVOKE_SENDER';
    if (createMode) {
      if (!newLogin.trim() || !newPw.trim()) { setStatus('New user Login ID and password are required.'); return; }
      if (newPw.length < 6) { setStatus('Password must be at least 6 characters.'); return; }
    } else if (needsReceiver && !receiverLogin.trim()) {
      setStatus('Receiver login ID or user ID is required.'); return;
    }

    setBusy(true); setStatus('Transferring…');
    try {
      const body: Record<string, unknown> = {
        location_id: locationId.trim().toUpperCase(),
        rights,
        sender_login_id: state.user?.loginId,
      };

      if (createMode) {
        body.create_receiver = {
          login_id: newLogin.trim(),
          name: newName.trim() || newLogin.trim(),
          password: newPw,
          role: isDemoUser ? 'VENDOR_SUPER_ADMIN' : newRole,
        };
      } else if (needsReceiver) {
        const ref = receiverLogin.trim();
        if (/^user_/i.test(ref)) {
          body.receiver_user_id = ref;
        } else {
          body.receiver_login_id = ref;
        }
      }

      const result = await transferLocation(body) as Record<string, unknown>;
      const data = (result as Record<string, unknown>);
      const recLogin = (data.receiver as Record<string, unknown>)?.login_id ?? (data.created_receiver as Record<string, unknown>)?.login_id ?? '--';
      setStatus(`Transfer complete: ${locationId.toUpperCase()} → ${recLogin} (${rights})`);
      showToast(`Location transferred successfully.`);
      setReceiverLogin(''); setNewLogin(''); setNewName(''); setNewPw('');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Transfer failed';
      setStatus(`Failed: ${msg}`);
      showToast(msg, true);
    } finally {
      setBusy(false);
    }
  }

  const locations = state.locations;

  return (
    <section className="view active" id="view-transfer">
      <div className="card">
        <h2 className="view-title"><FiSend size={15} style={{ marginRight: 8 }} />Transfer Location</h2>
        <p className="view-subtitle" style={{ marginTop: 0 }}>
          Transfer or share location access between users.
        </p>

        {/* Location selector */}
        <label className="lbl"><FiMapPin size={12} style={{ marginRight: 4 }} />Location</label>
        {locations.length > 0 ? (
          <select className="inp" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">-- Select Location --</option>
            {locations.map((l) => {
              const lid = l.location_id || l.id;
              return <option key={lid} value={lid}>{l.location_name} ({lid})</option>;
            })}
          </select>
        ) : (
          <input className="inp" value={locationId} onChange={(e) => setLocationId(e.target.value.toUpperCase())}
            placeholder="Location ID (e.g. RUB42-AJ)" />
        )}

        {/* Sender info */}
        <label className="lbl">Sender (you)</label>
        <input className="inp" value={state.user?.loginId ?? ''} disabled />

        {/* Rights mode */}
        <label className="lbl">Transfer Mode</label>
        <select className="inp" value={rights} onChange={(e) => setRights(e.target.value as RightsMode)}>
          <option value="MOVE">MOVE — Transfer ownership</option>
          <option value="SHARE">SHARE — Share with receiver</option>
          <option value="GRANT_RECEIVER">GRANT RECEIVER — Add receiver only</option>
          <option value="REVOKE_SENDER">REVOKE SENDER — Remove my access</option>
        </select>
        <div className="meta" style={{ marginTop: 2 }}>{RIGHTS_DESCRIPTIONS[rights]}</div>

        {/* Receiver section */}
        {rights !== 'REVOKE_SENDER' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
              <button
                className={`ghost-btn${!createMode ? ' active' : ''}`}
                style={{ flex: 1 }}
                onClick={() => setCreateMode(false)}
              >Existing User</button>
              <button
                className={`ghost-btn${createMode ? ' active' : ''}`}
                style={{ flex: 1 }}
                onClick={() => setCreateMode(true)}
              ><FiUserPlus size={12} style={{ marginRight: 4 }} />Create User</button>
            </div>

            {!createMode ? (
              <>
                <label className="lbl" style={{ marginTop: 10 }}>Receiver Login ID or User ID</label>
                <input className="inp" value={receiverLogin} onChange={(e) => setReceiverLogin(e.target.value)}
                  placeholder="e.g. john.doe or user_abc123" />
              </>
            ) : (
              <>
                {isDemoUser && (
                  <div style={{ marginTop: 8, padding: '8px 10px', background: '#fef9c3', border: '1px solid #fde047', borderRadius: 6, fontSize: 12, color: '#713f12' }}>
                    Demo user can only create Vendor Super Admin accounts.
                  </div>
                )}
                <label className="lbl" style={{ marginTop: 10 }}>New User Login ID</label>
                <input className="inp" value={newLogin} onChange={(e) => setNewLogin(e.target.value)} placeholder="e.g. rub_admin" />
                <label className="lbl">Full Name</label>
                <input className="inp" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Display name (optional)" />
                <label className="lbl">Temporary Password</label>
                <input className="inp" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="Min 6 characters" />
                {!isDemoUser && (
                  <>
                    <label className="lbl">Role</label>
                    <select className="inp" value={newRole} onChange={(e) => setNewRole(e.target.value)}>
                      <option value="VENDOR_SUPER_ADMIN">Vendor Super Admin</option>
                      <option value="DEPARTMENT_SUPER_ADMIN">Department Super Admin</option>
                      <option value="DEPARTMENT_ADMIN">Department Admin</option>
                      <option value="LOCATION_ADMIN">Location Admin</option>
                      <option value="OPERATOR">Operator</option>
                      <option value="VIEWER">Viewer</option>
                    </select>
                  </>
                )}
              </>
            )}
          </>
        )}

        <button className="primary-btn" style={{ marginTop: 16 }} onClick={handleTransfer} disabled={busy || !locationId}>
          <FiSend size={13} style={{ marginRight: 6 }} />{busy ? 'Transferring…' : 'Execute Transfer'}
        </button>

        {status && (
          <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 6, background: status.startsWith('Failed') ? '#fef2f2' : '#f0fdf4', border: `1px solid ${status.startsWith('Failed') ? '#fca5a5' : '#86efac'}`, fontSize: 13, color: status.startsWith('Failed') ? '#991b1b' : '#166534' }}>
            {status}
          </div>
        )}
      </div>
    </section>
  );
}
