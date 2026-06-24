import { useState } from 'react';
import { FiVolume2, FiZap, FiAlertOctagon, FiShield, FiX } from 'react-icons/fi';
import { useApp } from '@/context/AppContext';
import { muteAlarm, dryRun, forceClear } from '@/api/commands';

type MuteRtu = 'left' | 'right' | 'both';
type DryRtu = 'left' | 'right';
const ALL_RELAYS = ['siren', 'flash', 'voice'] as const;

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16
};
const modalStyle: React.CSSProperties = {
  background: 'var(--card-bg, #fff)', borderRadius: 12, padding: 24,
  width: '100%', maxWidth: 340, boxShadow: '0 8px 32px rgba(0,0,0,0.22)'
};
const rowStyle: React.CSSProperties = { display: 'flex', gap: 8, marginBottom: 14 };
const selBtnBase: React.CSSProperties = {
  flex: 1, padding: '8px 0', borderRadius: 8, border: '1.5px solid var(--border, #e2e8f0)',
  cursor: 'pointer', fontWeight: 600, fontSize: 13, background: 'var(--bg, #f8fafc)', transition: 'all .15s'
};

function selBtn(active: boolean): React.CSSProperties {
  return active
    ? { ...selBtnBase, background: 'var(--accent, #2563eb)', color: '#fff', borderColor: 'var(--accent, #2563eb)' }
    : { ...selBtnBase, color: 'var(--text, #1e293b)' };
}

export default function ControlsPage() {
  const { state, showToast } = useApp();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState('');

  const [muteOpen, setMuteOpen] = useState(false);
  const [muteRtu, setMuteRtu] = useState<MuteRtu>('both');

  const [dryOpen, setDryOpen] = useState(false);
  const [dryRtu, setDryRtu] = useState<DryRtu>('right');
  const [dryRelays, setDryRelays] = useState<string[]>(['siren', 'flash', 'voice']);

  const locationId = state.selectedLocationId ?? '';
  const deviceId   = state.selectedDeviceId ?? '';

  function openMute() {
    if (!locationId) { showToast('Select a location first.', true); return; }
    setMuteOpen(true);
  }

  function openDry() {
    if (!locationId) { showToast('Select a location first.', true); return; }
    setDryOpen(true);
  }

  async function confirmMute() {
    setMuteOpen(false);
    setBusy('mute');
    try {
      await muteAlarm(locationId, deviceId, { rtu: muteRtu });
      showToast(`Alarm muted on ${muteRtu === 'both' ? 'both RTUs' : muteRtu.toUpperCase() + ' RTU'}.`);
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed', true);
    } finally { setBusy(''); }
  }

  async function confirmDry() {
    if (dryRelays.length === 0) { showToast('Select at least one relay.', true); return; }
    setDryOpen(false);
    setBusy('dry');
    try {
      await dryRun(locationId, deviceId, { rtu: dryRtu, relays: dryRelays });
      showToast(`Dry run on ${dryRtu.toUpperCase()} RTU (auto-off in 5s).`);
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed', true);
    } finally { setBusy(''); }
  }

  async function doClear() {
    if (!locationId) { showToast('Select a location first.', true); return; }
    if (!reason.trim() || reason.trim().length < 5) { showToast('Enter a reason (min 5 chars).', true); return; }
    setBusy('clear');
    try {
      await forceClear(locationId, deviceId, reason.trim());
      showToast('Incident cleared.');
      setReason('');
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed', true);
    } finally { setBusy(''); }
  }

  function toggleRelay(r: string) {
    setDryRelays((prev) =>
      prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]
    );
  }

  function toggleAllRelays() {
    setDryRelays((prev) => prev.length === ALL_RELAYS.length ? [] : [...ALL_RELAYS]);
  }

  return (
    <section className="view active" id="view-controls">
      <div className="card">
        <h2 className="view-title">Controls</h2>
        <p className="view-subtitle">
          {state.user?.role?.replace(/_/g, ' ') ?? '--'} &middot;{' '}
          {locationId ? `Location: ${locationId}` : 'No location selected'}
        </p>

        <button className="control-btn warn" onClick={openMute} disabled={busy === 'mute'}>
          <FiVolume2 size={14} style={{ marginRight: 6 }} />
          {busy === 'mute' ? 'Muting...' : 'Mute Alarm'}
        </button>

        <button className="control-btn info" onClick={openDry} disabled={busy === 'dry'} style={{ marginTop: 8 }}>
          <FiZap size={14} style={{ marginRight: 6 }} />
          {busy === 'dry' ? 'Running...' : 'Dry Run Test'}
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
          {busy === 'clear' ? 'Clearing...' : 'Force Clear Incident'}
        </button>

        <p className="hint">
          <FiShield size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
          All actions are audited with user, session, and device metadata.
        </p>
      </div>

      {/* Mute Alarm Modal */}
      {muteOpen && (
        <div style={overlayStyle} onClick={() => setMuteOpen(false)}>
          <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <span style={{ fontWeight: 700, fontSize: 16 }}>Mute Alarm</span>
              <button onClick={() => setMuteOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
                <FiX size={18} />
              </button>
            </div>
            <p style={{ fontSize: 13, color: 'var(--muted, #64748b)', marginBottom: 14 }}>
              Select which RTU to silence. All relays on the selected bus will be turned off immediately.
            </p>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted, #64748b)', textTransform: 'uppercase', letterSpacing: 1 }}>Select RTU</label>
            <div style={{ ...rowStyle, marginTop: 8 }}>
              {(['left', 'right', 'both'] as MuteRtu[]).map((v) => (
                <button key={v} style={selBtn(muteRtu === v)} onClick={() => setMuteRtu(v)}>
                  {v === 'both' ? 'Both' : v.charAt(0).toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>
            <button className="control-btn warn" onClick={confirmMute} style={{ marginTop: 4 }}>
              <FiVolume2 size={14} style={{ marginRight: 6 }} />
              Confirm Mute
            </button>
          </div>
        </div>
      )}

      {/* Dry Run Modal */}
      {dryOpen && (
        <div style={overlayStyle} onClick={() => setDryOpen(false)}>
          <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <span style={{ fontWeight: 700, fontSize: 16 }}>Dry Run Test</span>
              <button onClick={() => setDryOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
                <FiX size={18} />
              </button>
            </div>
            <p style={{ fontSize: 13, color: 'var(--muted, #64748b)', marginBottom: 14 }}>
              Relays will activate for 5 seconds then auto-off. Test one RTU at a time.
            </p>

            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted, #64748b)', textTransform: 'uppercase', letterSpacing: 1 }}>Select RTU</label>
            <div style={{ ...rowStyle, marginTop: 8 }}>
              {(['left', 'right'] as DryRtu[]).map((v) => (
                <button key={v} style={selBtn(dryRtu === v)} onClick={() => setDryRtu(v)}>
                  {v.charAt(0).toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>

            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted, #64748b)', textTransform: 'uppercase', letterSpacing: 1 }}>Select Relays</label>
            <div style={{ marginTop: 8, marginBottom: 14 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, marginBottom: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={dryRelays.length === ALL_RELAYS.length} onChange={toggleAllRelays} />
                <strong>All Relays</strong>
              </label>
              {ALL_RELAYS.map((r) => (
                <label key={r} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, marginBottom: 6, cursor: 'pointer', paddingLeft: 8 }}>
                  <input type="checkbox" checked={dryRelays.includes(r)} onChange={() => toggleRelay(r)} />
                  {r.charAt(0).toUpperCase() + r.slice(1)}
                </label>
              ))}
            </div>

            <p style={{ fontSize: 12, color: 'var(--warn, #d97706)', marginBottom: 12 }}>
              Auto-off after 5 seconds.
            </p>
            <button className="control-btn info" onClick={confirmDry}>
              <FiZap size={14} style={{ marginRight: 6 }} />
              Start Dry Run
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
