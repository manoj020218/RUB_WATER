import { useState } from 'react';
import { FiVolume2, FiZap, FiAlertOctagon, FiShield } from 'react-icons/fi';
import { useApp } from '@/context/AppContext';
import { muteAlarm, dryRun, forceClear } from '@/api/commands';

export default function ControlsPage() {
  const { state, showToast } = useApp();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState('');

  const locationId = state.selectedLocationId ?? '';
  const deviceId   = state.selectedDeviceId ?? '';

  async function doMute() {
    if (!locationId) { showToast('Select a location first.', true); return; }
    setBusy('mute');
    try { await muteAlarm(locationId, deviceId); showToast('Alarm muted.'); } catch (e: unknown) { showToast(e instanceof Error ? e.message : 'Failed', true); } finally { setBusy(''); }
  }

  async function doDry() {
    if (!locationId) { showToast('Select a location first.', true); return; }
    setBusy('dry');
    try { await dryRun(locationId, deviceId); showToast('Dry run triggered.'); } catch (e: unknown) { showToast(e instanceof Error ? e.message : 'Failed', true); } finally { setBusy(''); }
  }

  async function doClear() {
    if (!locationId) { showToast('Select a location first.', true); return; }
    if (!reason.trim() || reason.trim().length < 5) { showToast('Enter a reason (min 5 chars).', true); return; }
    setBusy('clear');
    try { await forceClear(locationId, deviceId, reason.trim()); showToast('Incident cleared.'); setReason(''); } catch (e: unknown) { showToast(e instanceof Error ? e.message : 'Failed', true); } finally { setBusy(''); }
  }

  return (
    <section className="view active" id="view-controls">
      <div className="card">
        <h2 className="view-title">Controls</h2>
        <p className="view-subtitle">
          {state.user?.role?.replace(/_/g, ' ') ?? '--'} ·{' '}
          {locationId ? `Location: ${locationId}` : 'No location selected'}
        </p>

        <button className="control-btn warn" onClick={doMute} disabled={busy === 'mute'}>
          <FiVolume2 size={14} style={{ marginRight: 6 }} />
          {busy === 'mute' ? 'Muting…' : 'Mute Alarm'}
        </button>

        <button className="control-btn info" onClick={doDry} disabled={busy === 'dry'} style={{ marginTop: 8 }}>
          <FiZap size={14} style={{ marginRight: 6 }} />
          {busy === 'dry' ? 'Running…' : 'Dry Run Test'}
        </button>

        <input
          className="inp"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Force clear reason (min 5 chars)"
          style={{ marginTop: 12 }}
        />

        <button className="control-btn danger" onClick={doClear} disabled={busy === 'clear'}>
          <FiAlertOctagon size={14} style={{ marginRight: 6 }} />
          {busy === 'clear' ? 'Clearing…' : 'Force Clear Incident'}
        </button>

        <p className="hint">
          <FiShield size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
          All actions are audited with user, session, and device metadata.
        </p>
      </div>
    </section>
  );
}
