import { useEffect, useState, useCallback } from 'react';
import { FiSettings, FiRefreshCw, FiSave, FiSend, FiTool, FiMapPin } from 'react-icons/fi';
import { useApp } from '@/context/AppContext';
import {
  fetchDeviceConfig,
  saveDeviceConfig,
  pushDeviceConfig,
  fetchDeviceConfigHistory,
  saveDeviceConfigLocal,
  fetchDeviceLifecycle,
  patchDeviceLifecycle,
  fetchDeviceLifecycleHistory
} from '@/api/commands';
import { DeviceConfig } from '@/types';
import { IST_TIMEZONE } from '@/constants';

const VERIFY_POLL_INTERVAL_MS = 4000;
const VERIFY_TIMEOUT_MS = 240000;

function fmtDT(iso?: string) {
  if (!iso) return '--';
  try { return new Date(iso).toLocaleString('en-IN', { timeZone: IST_TIMEZONE }); } catch (_) { return iso; }
}

function sensorModeLabel(mode?: string) {
  switch ((mode || '').toUpperCase()) {
    case 'BOTH_ACTIVE':
    case 'DUAL':
      return 'RS485 US Sensor + Switch Type Sensor';
    case 'DYP_ONLY':
    case 'RS485_ONLY':
      return 'RS485 US Sensor Only';
    case 'SWITCH_ONLY':
      return 'Switch Type Sensor Only';
    case 'NO_SENSOR':
      return 'No Sensor Connected';
    default:
      return '--';
  }
}

function sensorModeToLegacy(mode: string) {
  switch ((mode || '').toUpperCase()) {
    case 'BOTH_ACTIVE': return 'DUAL';
    case 'DYP_ONLY': return 'RS485_ONLY';
    default: return mode;
  }
}

function verificationSummary(config: DeviceConfig | null) {
  if (!config) return '--';
  const state = String(config.state || '').toUpperCase();
  const verification = String(config.last_verification_status || '').toUpperCase();
  if (verification === 'VERIFIED' || state === 'VERIFIED') return 'Verified';
  if (verification === 'FAILED' || state === 'FAILED') return 'Verification Failed';
  if (state === 'REBOOT_PENDING' || verification === 'WAITING_FOR_REBOOT') return 'Reboot Pending';
  if (state === 'VERIFY_PENDING' || verification === 'VERIFY_PENDING') return 'Awaiting Verification';
  if (state === 'PENDING') return 'Pending ACK';
  if (state === 'ACTIVE') return 'Active';
  return state || verification || '--';
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export default function ConfigPage() {
  const { state, dispatch, canEditConfig, canViewConfig, showToast } = useApp();
  const deviceId = state.selectedDeviceId ?? state.configDeviceId ?? '';
  const locationId = state.selectedLocationId ?? '';

  const [config, setConfig] = useState<DeviceConfig | null>(null);
  const [history, setHistory] = useState<DeviceConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [localBusy, setLocalBusy] = useState(false);
  const [cloudStatus, setCloudStatus] = useState('');
  const [localStatus, setLocalStatus] = useState('');
  const [localPin, setLocalPin] = useState('Hanuman#2026');

  const [lifecycle, setLifecycle] = useState<{ status: string; note?: string; updated_at?: string } | null>(null);
  const [lcHistory, setLcHistory] = useState<{ status: string; reason?: string; created_at?: string }[]>([]);
  const [lcReason, setLcReason] = useState('');
  const [lcStatus, setLcStatus] = useState('');

  const [form, setForm] = useState({
    alert_level_mm: '',
    danger_level_mm: '',
    clear_level_mm: '',
    trigger_delay_s: '',
    clear_delay_s: '',
    sensor_mount_height_mm: '',
    sensor_mode: 'BOTH_ACTIVE',
    switch_level_1_mm: '',
    switch_level_2_mm: '',
    confirm_wait_minutes: '5'
  });

  function applyConfig(c: DeviceConfig) {
    setConfig(c);
    const waitSec = Number(c.sensor_confirmation_wait_sec ?? c.mismatch_duration_seconds ?? 300);
    setForm({
      alert_level_mm: String(c.alert_level_mm ?? ''),
      danger_level_mm: String(c.danger_level_mm ?? ''),
      clear_level_mm: String(c.clear_level_mm ?? ''),
      trigger_delay_s: String(c.trigger_delay_s ?? c.trigger_delay_seconds ?? ''),
      clear_delay_s: String(c.clear_delay_s ?? c.clear_delay_seconds ?? ''),
      sensor_mount_height_mm: String(c.sensor_mount_height_mm ?? ''),
      sensor_mode: String(c.sensor_mode ?? c.sensor_logic_mode ?? 'BOTH_ACTIVE'),
      switch_level_1_mm: String(c.switch_level_1_mm ?? ''),
      switch_level_2_mm: String(c.switch_level_2_mm ?? ''),
      confirm_wait_minutes: String(Math.max(1, Math.round(waitSec / 60)))
    });
  }

  const load = useCallback(async () => {
    if (!deviceId) return;
    setLoading(true);
    try {
      const [c, lc] = await Promise.all([
        fetchDeviceConfig(deviceId),
        fetchDeviceLifecycle(deviceId).catch(() => null)
      ]);
      applyConfig(c);
      if (lc) setLifecycle(lc);
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to load config', true);
    } finally {
      setLoading(false);
    }
  }, [deviceId, showToast]);

  useEffect(() => {
    if (deviceId) {
      load();
      loadHistory();
    }
  }, [deviceId, load]);

  async function loadHistory() {
    if (!deviceId) return;
    try { setHistory(await fetchDeviceConfigHistory(deviceId)); } catch (_) {}
  }

  async function loadLcHistory() {
    if (!deviceId) return;
    try { setLcHistory(await fetchDeviceLifecycleHistory(deviceId)); } catch (_) {}
  }

  function parseNum(v: string) {
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? undefined : n;
  }

  function buildCloudPayload() {
    const waitMinutes = Math.max(1, parseNum(form.confirm_wait_minutes) ?? 5);
    const waitSeconds = waitMinutes * 60;
    return {
      alert_level_mm: parseNum(form.alert_level_mm),
      danger_level_mm: parseNum(form.danger_level_mm),
      clear_level_mm: parseNum(form.clear_level_mm),
      trigger_delay_s: parseNum(form.trigger_delay_s),
      clear_delay_s: parseNum(form.clear_delay_s),
      sensor_mount_height_mm: parseNum(form.sensor_mount_height_mm),
      sensor_mode: form.sensor_mode,
      sensor_logic_mode: sensorModeToLegacy(form.sensor_mode),
      switch_level_1_mm: parseNum(form.switch_level_1_mm),
      switch_level_2_mm: parseNum(form.switch_level_2_mm),
      sensor_confirmation_wait_sec: waitSeconds,
      mismatch_duration_seconds: waitSeconds,
      reboot_after_config_update: true
    };
  }

  async function waitForVerification() {
    if (!deviceId) return false;
    const started = Date.now();
    while ((Date.now() - started) < VERIFY_TIMEOUT_MS) {
      const latest = await fetchDeviceConfig(deviceId);
      applyConfig(latest);
      const currentState = String(latest.state || '').toUpperCase();
      const verifyState = String(latest.last_verification_status || '').toUpperCase();

      if (currentState === 'FAILED' || verifyState === 'FAILED') {
        setCloudStatus('Configuration update not verified. Please retry or check device connection.');
        return false;
      }
      if (currentState === 'VERIFIED' || verifyState === 'VERIFIED') {
        setCloudStatus('Configuration verified successfully.');
        loadHistory();
        return true;
      }
      if (currentState === 'REBOOT_PENDING' || verifyState === 'WAITING_FOR_REBOOT') {
        setCloudStatus('Device rebooting...');
      } else if (currentState === 'VERIFY_PENDING' || verifyState === 'VERIFY_PENDING') {
        setCloudStatus('Fetching updated settings after reboot...');
      } else {
        setCloudStatus('Device applying settings...');
      }

      await sleep(VERIFY_POLL_INTERVAL_MS);
    }
    setCloudStatus('Configuration update not verified. Please retry or check device connection.');
    return false;
  }

  async function handleSave() {
    if (!deviceId) { setCloudStatus('No device selected.'); return; }
    setCloudBusy(true);
    try {
      setCloudStatus('Fetching current firmware settings...');
      const current = await fetchDeviceConfig(deviceId);
      applyConfig(current);

      setCloudStatus('Sending new settings...');
      const updated = await saveDeviceConfig(deviceId, buildCloudPayload());
      applyConfig(updated);
      setCloudStatus('Device applying settings...');
      await waitForVerification();
    } catch (e: unknown) {
      setCloudStatus(e instanceof Error ? e.message : 'Failed to update configuration.');
    } finally {
      setCloudBusy(false);
    }
  }

  async function handlePush() {
    if (!deviceId) { setCloudStatus('No device selected.'); return; }
    setCloudBusy(true);
    try {
      setCloudStatus('Fetching current firmware settings...');
      const current = await fetchDeviceConfig(deviceId);
      applyConfig(current);

      setCloudStatus('Sending new settings...');
      const updated = await pushDeviceConfig(deviceId) as { config?: DeviceConfig };
      if (updated?.config) applyConfig(updated.config);
      setCloudStatus('Device applying settings...');
      await waitForVerification();
    } catch (e: unknown) {
      setCloudStatus(e instanceof Error ? e.message : 'Failed to push configuration.');
    } finally {
      setCloudBusy(false);
    }
  }

  async function handleLocalSave() {
    const localUrl = state.install.localUrl;
    if (!localUrl) { setLocalStatus('No local URL configured. Use Install tab.'); return; }
    setLocalBusy(true);
    setLocalStatus('Sending new settings...');
    try {
      await saveDeviceConfigLocal(localUrl, buildCloudPayload(), localPin);
      setLocalStatus('Device applying settings and rebooting. Verify after it reconnects.');
    } catch (e: unknown) {
      setLocalStatus(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLocalBusy(false);
    }
  }

  async function handleLifecycle(action: string) {
    if (!deviceId) { setLcStatus('No device selected.'); return; }
    if (!lcReason.trim()) { setLcStatus('Enter a reason/note first.'); return; }
    setLcStatus(`Marking ${action}...`);
    try {
      await patchDeviceLifecycle(deviceId, action, lcReason.trim());
      setLcStatus('Done.');
      setLcReason('');
      load();
    } catch (e: unknown) {
      setLcStatus(e instanceof Error ? e.message : 'Failed');
    }
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
      <input
        className="inp"
        type={type}
        value={f[key]}
        onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
        disabled={!editable || cloudBusy || localBusy}
      />
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
            <button className="ghost-btn" style={{ padding: '5px 10px' }} onClick={load} disabled={cloudBusy || localBusy}>
              <FiRefreshCw size={14} />
            </button>
          </div>
        </div>

        {loading && <div className="meta">Loading...</div>}

        {lifecycle && (
          <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 8, background: lifecycle.status === 'OPERATIONAL' ? '#e8f5e9' : '#fff3e0', border: `1px solid ${lifecycle.status === 'OPERATIONAL' ? '#a5d6a7' : '#ffb74d'}`, fontSize: 12 }}>
            <strong>Lifecycle:</strong> {lifecycle.status} {lifecycle.note && `- ${lifecycle.note}`}
          </div>
        )}

        {canViewConfig() && config && (
          <>
            <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 10, background: '#f8fafc', border: '1px solid #e2e8f0', fontSize: 12 }}>
              <div><strong>Verification State:</strong> {verificationSummary(config)}</div>
              <div><strong>Firmware Config Version:</strong> {config.current_config_version ?? config.version ?? '--'}</div>
              <div><strong>Sensor Input Mode:</strong> {sensorModeLabel(config.sensor_mode ?? config.sensor_logic_mode)}</div>
              <div><strong>Device Reported At:</strong> {fmtDT(config.reported_at ?? config.device_reported_at)}</div>
              <div><strong>Verification Message:</strong> {config.last_verification_message || config.last_ack_message || '--'}</div>
            </div>

            {inp('alert_level_mm', 'Orange Level (mm)')}
            {inp('danger_level_mm', 'Danger Level (mm)')}
            {inp('clear_level_mm', 'Clear Level (mm)')}
            {inp('trigger_delay_s', 'Trigger Delay (seconds)')}
            {inp('clear_delay_s', 'Clear Delay (seconds)')}
            {inp('sensor_mount_height_mm', 'RS485 US Sensor Mount Height (mm)')}

            <label className="lbl">Sensor Input Mode</label>
            <select
              className="inp"
              value={f.sensor_mode}
              onChange={(e) => setForm((p) => ({ ...p, sensor_mode: e.target.value }))}
              disabled={!editable || cloudBusy || localBusy}
            >
              <option value="BOTH_ACTIVE">RS485 US Sensor + Switch Type Sensor</option>
              <option value="DYP_ONLY">RS485 US Sensor Only</option>
              <option value="SWITCH_ONLY">Switch Type Sensor Only</option>
              <option value="NO_SENSOR">No Sensor Connected</option>
            </select>

            {inp('switch_level_1_mm', 'Switch Type Sensor L1 Height (mm)')}
            {inp('switch_level_2_mm', 'Switch Type Sensor L2 Height (mm)')}
            {inp('confirm_wait_minutes', 'Sensor Confirmation Wait Time (minutes)')}

            {editable && (
              <div className="row" style={{ marginTop: 10 }}>
                <button className="control-btn info" style={{ marginTop: 0 }} onClick={handleSave} disabled={cloudBusy || localBusy}>
                  <FiSave size={13} style={{ marginRight: 5 }} />Save via Cloud
                </button>
                <button className="ghost-btn" onClick={handlePush} disabled={cloudBusy || localBusy}>
                  <FiSend size={13} style={{ marginRight: 5 }} />Push Again
                </button>
              </div>
            )}
            {cloudStatus && <div className="meta">{cloudStatus}</div>}

            {editable && (
              <>
                <label className="lbl" style={{ marginTop: 12 }}>Local Admin Password</label>
                <input className="inp" type="password" value={localPin} onChange={(e) => setLocalPin(e.target.value)} placeholder="Hanuman#2026" disabled={cloudBusy || localBusy} />
                <button className="control-btn warn" onClick={handleLocalSave} disabled={cloudBusy || localBusy}>
                  <FiTool size={13} style={{ marginRight: 5 }} />Save Direct (Local LAN)
                </button>
                {localStatus && <div className="meta">{localStatus}</div>}
              </>
            )}

            <div className="meta" style={{ marginTop: 8 }}>
              Last ACK: {fmtDT(config.last_ack_at)} � Verified: {fmtDT(config.verified_at)}
            </div>

            <div className="row between" style={{ marginTop: 16 }}>
              <h3 style={{ margin: 0, fontSize: 14 }}>Config History</h3>
              <button className="ghost-btn" style={{ padding: '6px 10px' }} onClick={loadHistory} disabled={cloudBusy || localBusy}>
                <FiRefreshCw size={12} />
              </button>
            </div>
            <div className="timeline" style={{ marginTop: 8 }}>
              {history.length === 0 ? <div className="empty">Tap refresh to load.</div> : history.map((h, i) => (
                <div key={i} className="timeline-item">
                  <div className="timeline-dot" />
                  <div className="timeline-body">
                    <div className="timeline-meta">v{h.version} � {verificationSummary(h)} � {fmtDT(h.reported_at)}</div>
                    <div className="timeline-detail">
                      Orange: {h.alert_level_mm}mm � Danger: {h.danger_level_mm}mm � Mode: {sensorModeLabel(h.sensor_mode ?? h.sensor_logic_mode)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

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

