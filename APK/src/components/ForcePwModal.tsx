import { useState } from 'react';
import { submitForcePwChange } from '@/api/auth';
import { useApp } from '@/context/AppContext';

export default function ForcePwModal() {
  const { state, showToast } = useApp();
  const [newPw, setNewPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // Show only if user has force_change flag
  if (!(state.user as unknown as Record<string, unknown>)?.force_password_change) return null;

  async function submit() {
    setErr('');
    if (newPw.length < 6) { setErr('Password must be at least 6 characters.'); return; }
    if (newPw !== confirm) { setErr('Passwords do not match.'); return; }
    setBusy(true);
    try {
      await submitForcePwChange(newPw, confirm);
      showToast('Password updated. Please continue.');
      window.location.reload();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to update password.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" style={{ display: 'flex' }}>
      <div className="modal-card">
        <h3 style={{ margin: '0 0 6px', fontSize: 16 }}>Password Change Required</h3>
        <p className="hint" style={{ margin: '0 0 12px' }}>Your account uses a default password. Please set a new password before continuing.</p>
        <label className="lbl">New Password</label>
        <input className="inp" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="New password (min 6 chars)" />
        <label className="lbl" style={{ marginTop: 8 }}>Confirm Password</label>
        <input className="inp" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Confirm new password" />
        <button className="primary-btn" style={{ marginTop: 12 }} onClick={submit} disabled={busy}>
          {busy ? 'Saving…' : 'Set Password & Continue'}
        </button>
        {err && <div className="err" style={{ marginTop: 8 }}>{err}</div>}
      </div>
    </div>
  );
}
