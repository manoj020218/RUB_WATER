import { useEffect, useState, useCallback } from 'react';
import { FiSettings, FiRefreshCw, FiSave, FiSend, FiTool, FiMapPin } from 'react-icons/fi';
import { useApp } from '@/context/AppContext';
import { fetchDeviceConfig, saveDeviceConfig, pushDeviceConfig, fetchDeviceConfigHistory, saveDeviceConfigLocal, fetchDeviceLifecycle, patchDeviceLifecycle, fetchDeviceLifecycleHistory } from '@/api/commands';
import { DeviceConfig } from '@/types';
import { IST_TIMEZONE } from '@/constants';

function fmtDT(iso?: string) {
  if (!iso) return '--';
  try { return new Date(iso).toLocaleString('en-IN', { timeZone: IST_TIMEZONE }); } catch (_) { return iso; }
}

export default function ConfigPage() {
  const { state, dispatch, canEditConfig, canViewConfig, showToast } = useApp();
  const deviceId = state.selectedDeviceId ?? state.configDeviceId ?? '';
  const locationId = state.selectedLocationId ?? '';

  const [config, setConfig] = useState<DeviceConfig | null>(null);
  const [history, setHistory] = useState<DeviceConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [cloudStatus, setCloudStatus] = useState('');
  const [localStatus, setLocalStatus] = useState('');
  const [localPin, setLocalPin] = useState('654321');

  const [lifecycle, setLifecycle] = useState<{ status: string; note?: string; updated_at?: string } | null>(null);
  const [lcHistory, setLcHistory] = useState<{ status: string; reason?: string; created_at?: string }[]>([]);
  const [lcReason, setLcReason] = useState('');
  const [lcStatus, setLcStatus] = useState('');

  const [form, setForm] = useState({
    alert_level_mm: '', danger_level_mm: '', clear_level_mm: '',
    trigger_delay_s: '', clear_delay_s: '', sensor_mount_height_mm: '',
    rs485_enabled: 'true', switch_enabled: 'true',
    switch_level_1_mm: '', switch_level_2_mm: '',
  });

  function applyConfig(c: DeviceConfig) {
    setConfig(c);
    setForm({
      alert_level_mm:       String(c.alert_level_mm  ?? ''),
      danger_level_mm:      String(c.danger_level_mm ?? ''),
      clear_level_mm:       String(c.clear_level_mm  ?? ''),
      trigger_delay_s:      String(c.trigger_delay_s ?? ''),
      clear_delay_s:        String(c.clear_delay_s   ?? ''),
      sensor_mount_height_mm: String(c.sensor_mount_height_mm ?? ''),
      rs485_enabled:        String(c.rs485_enabled   ?? 'true'),
      switch_enabled:       String(c.switch_enabled  ?? 'true'),
      switch_level_1_mm:    String(c.switch_level_1_mm ?? ''),
      switch_level_2_mm:    String(c.switch_level_2_mm ?? ''),
    });
  }

  const load = useCallback(async () => {
    if (!deviceId) return;
    setLoading(true);
    try {
      const [c, lc] = await Promise.all([fetchDeviceConfig(deviceId), fetchDeviceLifecycle(deviceId).catch(() => null)]);
      applyConfig(c);
      if (lc) setLifecycle(lc);
    } catch (e: unknown) { showToast(e instanceof Error ? e.message : 'Failed to load config', true); } finally { setLoading(false); }
  }, [deviceId, showToast]);

  useEffect(() => { if (deviceId) load(); }, [deviceId, load]);

  async function loadHistory() {
    if (!deviceId) return;
    try { setHistory(await fetchDeviceConfigHistory(deviceId)); } catch (_) {}
  }

  async function loadLcHistory() {
    if (!deviceId) return;
    try { setLcHistory(await fetchDeviceLifecycleHistory(deviceId)); } catch (_) {}
  }

  function parseNum(v: string) { const n = parseInt(v, 10); return isNaN(n) ? undefined : n; }

  async function handleSave() {
    if (!deviceId) { setCloudStatus('No device selected.'); return; }
    setCloudStatus('Saving…');
    try {
      const body = {
        alert_level_mm:        parseNum(form.alert_level_mm),
        danger_level_mm:       parseNum(form.danger_level_mm),
        clear_level_mm:        parseNum(form.clear_level_mm),
        trigger_delay_s:       parseNum(form.trigger_delay_s),
        clear_delay_s:         parseNum(form.clear_delay_s),
        sensor_mount_height_mm: parseNum(form.sensor_mount_height_mm),
        rs485_enabled:         form.rs485_enabled === 'true',
        switch_enabled:        form.switch_enabled === 'true',
        switch_level_1_mm:     parseNum(form.switch_level_1_mm),
        switch_level_2_mm:     parseNum(form.switch_level_2_mm),
      };
      const updated = await saveDeviceConfig(deviceId, body);
      applyConfig(updated);
      setCloudStatus('Saved via cloud.');
    } catch (e: unknown) { setCloudStatus(e instanceof Error ? e.message : 'Failed'); }
  }

  async function handlePush() {
    if (!deviceId) { setCloudStatus('No device selected.'); return; }
    setCloudStatus('Pushing…');
    try { await pushDeviceConfig(deviceId); setCloudStatus('Config pushed to device.'); } catch (e: unknown) { setCloudStatus(e instanceof Error ? e.message : 'Failed'); }
  }

  async function handleLocalSave() {
    const localUrl = state.install.localUrl;
    if (!localUrl) { setLocalStatus('No local URL configured. Use Install tab.'); return; }
    setLocalStatus('Saving locally…');
    try {
      const body = {
        alert_level_mm:        parseNum(form.alert_level_mm),
        danger_level_mm:       parseNum(form.danger_level_mm),
        clear_level_mm:        parseNum(form.clear_level_mm),
        sensor_mount_height_mm: parseNum(form.sensor_mount_height_mm),
      };
      await saveDeviceConfigLocal(localUrl, body, localPin);
      setLocalStatus('Saved directly via Local LAN.');
    } catch (e: unknown) { setLocalStatus(e instanceof Error ? e.message : 'Failed'); }
  }

  async function handleLifecycle(action: string) {
    if (!deviceId) { setLcStatus('No device selected.'); return; }
    if (!lcReason.trim()) { setLcStatus('Enter a reason/note first.'); return; }
    setLcStatus(`Marking ${action}…`);
    try { await patchDeviceLifecycle(deviceId, action, lcReason.trim()); setLcStatus('Done.'); setLcReason(''); load(); } catch (e: unknown) { setLcStatus(e instanceof Error ? e.message : 'Failed'); }
  }

  if (!deviceId) {
    return (
      <section className="view active" id="view-config">
        <div className="card">
          <h2 className="view-title"><FiSettings size={16} style={{ marginRight: 8 }} />Device Configuration</h2>
          {state.locations.length > 0 ? (
            <>
              <div style={{ padding: '10px 0 6px', color: '#475569', fontSize: 13 }}>Select a location to configure its device:</div>
              <select
                className="inp"
                defaultValue=""
                onChange={(e) => {
                  const loc = state.locations.find((l) => (l.location_id || l.id) === e.target.value);
                  if (loc) {
                    dispatch({ type: 'SELECT_LOCATION', locationId: loc.location_id || loc.id, deviceId: loc.device_id || null });
                  }
                }}
              >
                <option value="" disabled>-- Select Location --</option>
                {state.locations.map((l) => {
                  const lid = l.location_id || l.id;
                  return <option key={lid} value={lid}>{l.location_name} ({lid})</option>;
                })}
              </select>
            </>
          ) : (
            <div style={{ padding: '20px 0', textAlign: 'center', color: '#757575', fontSize: 13 }}>
              Select a device from the <strong>Locations</strong> tab to view and configure it.
            </div>
          )}
        </div>
      </section>
    );
  }

  const editable = canEditConfig();
  const f = form;
  const inp = (key: keyof typeof form, label: string, type = 'number') => (
    <div>
      <label className="lbl">{label}</label>
      <input className="inp" type={type} value={f[key]} onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))} disabled={!editable} />
    </div>
  );

  return (
    <section className="view active" id="view-config">
      <div className="card">
        <div className="row between">
          <h2 className="view-title"><FiSettings size={16} style={{ marginRight: 8 }} />Device Config</h2>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {locationId && (
              <span className="chip" style={{ fontSize: 11, background: '#e0f2fe', color: '#0369a1' }}>
                <FiMapPin size={10} style={{ marginRight: 3 }} />{locationId}
              </span>
            )}
            <span className="chip off" style={{ fontSize: 11 }}>{deviceId}</span>
            <button className="ghost-btn" style={{ padding: '5px 10px' }} onClick={load}><FiRefreshCw size={14} /></button>
          </div>
        </div>

        {loading && <div className="meta">Loading…</div>}

        {lifecycle && (
          <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 8, background: lifecycle.status === 'OPERATIONAL' ? '#e8f5e9' : '#fff3e0', border: `1px solid ${lifecycle.status === 'OPERATIONAL' ? '#a5d6a7' : '#ffb74d'}`, fontSize: 12 }}>
            <strong>Lifecycle:</strong> {lifecycle.status} {lifecycle.note && `— ${lifecycle.note}`}
          </div>
        )}

        {canViewConfig() && config && (
          <>
            {inp('alert_level_mm', 'Alert Threshold (mm)')}
            {inp('danger_level_mm', 'Danger Threshold (mm)')}
            {inp('clear_level_mm', 'Clear Threshold (mm)')}
            {inp('trigger_delay_s', 'Trigger Delay (seconds)')}
            {inp('clear_delay_s', 'Clear Delay (seconds)')}
            {inp('sensor_mount_height_mm', 'US Sensor Mount Height (mm)')}

            <label className="lbl">RS485 Sensor Connected</label>
            <select className="inp" value={f.rs485_enabled} onChange={(e) => setForm((p) => ({ ...p, rs485_enabled: e.target.value }))} disabled={!editable}>
              <option value="true">Yes</option><option value="false">No</option>
            </select>

            <label className="lbl">Switch Sensor Connected</label>
            <select className="inp" value={f.switch_enabled} onChange={(e) => setForm((p) => ({ ...p, switch_enabled: e.target.value }))} disabled={!editable}>
              <option value="true">Yes</option><option value="false">No</option>
            </select>

            {inp('switch_level_1_mm', 'Level 1 Switch Height (mm)')}
            {inp('switch_level_2_mm', 'Level 2 Switch Height (mm)')}

            {editable && (
              <div className="row" style={{ marginTop: 10 }}>
                <button className="control-btn info" style={{ marginTop: 0 }} onClick={handleSave}>
                  <FiSave size={13} style={{ marginRight: 5 }} />Save via Cloud
                </button>
                <button className="ghost-btn" onClick={handlePush}>
                  <FiSend size={13} style={{ marginRight: 5 }} />Push Again
                </button>
              </div>
            )}
            {cloudStatus && <div className="meta">{cloudStatus}</div>}

            {editable && (
              <>
                <label className="lbl" style={{ marginTop: 12 }}>Local Admin PIN</label>
                <input className="inp" type="password" value={localPin} onChange={(e) => setLocalPin(e.target.value)} placeholder="654321" />
                <button className="control-btn warn" onClick={handleLocalSave}>
                  <FiTool size={13} style={{ marginRight: 5 }} />Save Direct (Local LAN)
                </button>
                {localStatus && <div className="meta">{localStatus}</div>}
              </>
            )}

            <div className="meta" style={{ marginTop: 8 }}>Version: {config.version ?? '--'} · Last ACK: {fmtDT(config.last_ack_at)}</div>

            <div className="row between" style={{ marginTop: 16 }}>
              <h3 style={{ margin: 0, fontSize: 14 }}>Config History</h3>
              <button className="ghost-btn" style={{ padding: '6px 10px' }} onClick={loadHistory}><FiRefreshCw size={12} /></button>
            </div>
            <div className="timeline" style={{ marginTop: 8 }}>
              {history.length === 0 ? <div className="empty">Tap refresh to load.</div> : history.map((h, i) => (
                <div key={i} className="timeline-item">
                  <div className="timeline-dot" />
                  <div className="timeline-body">
                    <div className="timeline-meta">v{h.version} · {fmtDT(h.reported_at)}</div>
                    <div className="timeline-detail">Alert: {h.alert_level_mm}mm · Danger: {h.danger_level_mm}mm</div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Lifecycle actions */}
        <p className="section-sep">Device Lifecycle</p>
        {lifecycle && <div className="meta">Current: {lifecycle.status}</div>}
        <input className="inp" value={lcReason} onChange={(e) => setLcReason(e.target.value)} placeholder="Reason / note (required)" style={{ marginTop: 8 }} />
        <div className="lifecycle-btn-row">
          <button className="ghost-btn" onClick={() => handleLifecycle('FAULTY')}>Mark Faulty</button>
          <button className="ghost-btn" onClick={() => handleLifecycle('UNDER_REPLACEMENT')}>Under Replacement</button>
          <button className="ghost-btn" onClick={() => handleLifecycle('OPERATIONAL')}>Recommission</button>
        </div>
        {lcStatus && <div className="meta">{lcStatus}</div>}
        <div className="row between" style={{ marginTop: 12 }}>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#334155' }}>Lifecycle History</span>
          <button className="ghost-btn" style={{ padding: '5px 10px', fontSize: 11 }} onClick={loadLcHistory}><FiRefreshCw size={11} /></button>
        </div>
        <div className="timeline" style={{ marginTop: 8 }}>
          {lcHistory.length === 0 ? <div className="empty">Tap refresh to load.</div> : lcHistory.map((h, i) => (
            <div key={i} className="timeline-item">
              <div className="timeline-dot" />
              <div className="timeline-body">
                <div className="timeline-event">{h.status}</div>
                <div className="timeline-meta">{fmtDT(h.created_at)}</div>
                {h.reason && <div className="timeline-detail">{h.reason}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
