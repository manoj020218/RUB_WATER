import { useEffect, useState, useCallback } from 'react';
import { FiSettings, FiRefreshCw, FiSave, FiSend, FiTool, FiMapPin } from 'react-icons/fi';
import { useApp } from '@/context/AppContext';
import {
  fetchDeviceConfig,
  fetchDeviceActionSheet,
  fetchDeviceActionSheetHistory,
  saveDeviceConfig,
  saveDeviceActionSheet,
  pushDeviceConfig,
  pushDeviceActionSheet,
  fetchDeviceConfigHistory,
  saveDeviceConfigLocal,
  fetchDeviceLifecycle,
  patchDeviceLifecycle,
  fetchDeviceLifecycleHistory
} from '@/api/commands';
import { AlertActionItem, DeviceActionSheet, DeviceConfig } from '@/types';
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

function actionSheetSummary(sheet: DeviceActionSheet | null) {
  if (!sheet) return '--';
  const state = String(sheet.state || '').toUpperCase();
  if (state === 'SYNCED') return 'Synced';
  if (state === 'FAILED') return 'Sync Failed';
  if (sheet.pending_sync || state === 'PENDING_SYNC') return 'Pending Sync';
  return state || '--';
}

function defaultActionItems(): AlertActionItem[] {
  return [
    { alert_level: 'ORANGE', relay_number: 1, relay_name: 'Siren', enabled: true, mode: 'PULSE_REPEAT', on_time_sec: 10, off_time_sec: 60, repeat_interval_sec: 0, pulse_duration_sec: 0 },
    { alert_level: 'ORANGE', relay_number: 2, relay_name: 'Flash', enabled: true, mode: 'PULSE_REPEAT', on_time_sec: 10, off_time_sec: 60, repeat_interval_sec: 0, pulse_duration_sec: 0 },
    { alert_level: 'ORANGE', relay_number: 3, relay_name: 'Voice Trigger', enabled: true, mode: 'PULSE_REPEAT', on_time_sec: 0, off_time_sec: 0, repeat_interval_sec: 60, pulse_duration_sec: 2 },
    { alert_level: 'RED', relay_number: 1, relay_name: 'Siren', enabled: true, mode: 'CONTINUOUS_ON', on_time_sec: 0, off_time_sec: 0, repeat_interval_sec: 0, pulse_duration_sec: 0 },
    { alert_level: 'RED', relay_number: 2, relay_name: 'Flash', enabled: true, mode: 'CONTINUOUS_ON', on_time_sec: 0, off_time_sec: 0, repeat_interval_sec: 0, pulse_duration_sec: 0 },
    { alert_level: 'RED', relay_number: 3, relay_name: 'Voice Trigger', enabled: true, mode: 'PULSE_REPEAT', on_time_sec: 0, off_time_sec: 0, repeat_interval_sec: 15, pulse_duration_sec: 2 }
  ];
}

export default function ConfigPage() {
  const { state, dispatch, canEditConfig, canViewConfig, showToast } = useApp();
  const deviceId = state.selectedDeviceId ?? state.configDeviceId ?? '';
  const locationId = state.selectedLocationId ?? '';
  const isVendorSuperAdmin = state.user?.role === 'VENDOR_SUPER_ADMIN';

  const [config, setConfig] = useState<DeviceConfig | null>(null);
  const [history, setHistory] = useState<DeviceConfig[]>([]);
  const [actionSheet, setActionSheet] = useState<DeviceActionSheet | null>(null);
  const [actionHistory, setActionHistory] = useState<DeviceActionSheet[]>([]);
  const [loading, setLoading] = useState(false);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [localBusy, setLocalBusy] = useState(false);
  const [cloudStatus, setCloudStatus] = useState('');
  const [actionStatus, setActionStatus] = useState('');
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
  const [actionForm, setActionForm] = useState<AlertActionItem[]>(defaultActionItems());
  const [redOverride, setRedOverride] = useState(false);

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

  function applyActionSheet(sheet: DeviceActionSheet) {
    setActionSheet(sheet);
    setActionForm((sheet.actions && sheet.actions.length > 0 ? sheet.actions : defaultActionItems()).map((item) => ({ ...item })));
    setRedOverride(Boolean(sheet.red_all_off_override));
  }

  const load = useCallback(async () => {
    if (!deviceId) return;
    setLoading(true);
    try {
      const [c, action, lc] = await Promise.all([
        fetchDeviceConfig(deviceId),
        fetchDeviceActionSheet(deviceId).catch(() => null),
        fetchDeviceLifecycle(deviceId).catch(() => null)
      ]);
      applyConfig(c);
      if (action) applyActionSheet(action);
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
      loadActionHistory();
    }
  }, [deviceId, load]);

  async function loadHistory() {
    if (!deviceId) return;
    try { setHistory(await fetchDeviceConfigHistory(deviceId)); } catch (_) {}
  }

  async function loadActionHistory() {
    if (!deviceId) return;
    try { setActionHistory(await fetchDeviceActionSheetHistory(deviceId)); } catch (_) {}
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

  function buildActionSheetPayload() {
    return {
      red_all_off_override: redOverride,
      actions: actionForm.map((item) => ({
        ...item,
        relay_name: item.relay_name || (item.relay_number === 1 ? 'Siren' : item.relay_number === 2 ? 'Flash' : 'Voice Trigger'),
        on_time_sec: Number(item.on_time_sec || 0),
        off_time_sec: Number(item.off_time_sec || 0),
        repeat_interval_sec: Number(item.repeat_interval_sec || 0),
        pulse_duration_sec: Number(item.pulse_duration_sec || 0)
      }))
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

  async function waitForActionSheetSync() {
    if (!deviceId) return false;
    const started = Date.now();
    while ((Date.now() - started) < VERIFY_TIMEOUT_MS) {
      const latest = await fetchDeviceActionSheet(deviceId);
      applyActionSheet(latest);
      const state = String(latest.state || '').toUpperCase();
      if (state === 'FAILED') {
        setActionStatus(latest.last_sync_message || 'Action sheet sync failed.');
        return false;
      }
      if (state === 'SYNCED' && !latest.pending_sync) {
        setActionStatus('Action sheet synced successfully.');
        loadActionHistory();
        return true;
      }
      setActionStatus(latest.last_sync_message || 'Waiting for MCU action sheet sync...');
      await sleep(VERIFY_POLL_INTERVAL_MS);
    }
    setActionStatus('Action sheet sync not verified. Please retry or check device connection.');
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

  async function handleActionSheetSave() {
    if (!deviceId) { setActionStatus('No device selected.'); return; }
    setActionBusy(true);
    try {
      setActionStatus('Fetching current action sheet...');
      const current = await fetchDeviceActionSheet(deviceId);
      applyActionSheet(current);

      setActionStatus('Sending updated action sheet...');
      const updated = await saveDeviceActionSheet(deviceId, buildActionSheetPayload());
      applyActionSheet(updated);
      await waitForActionSheetSync();
    } catch (e: unknown) {
      setActionStatus(e instanceof Error ? e.message : 'Failed to update action sheet.');
    } finally {
      setActionBusy(false);
    }
  }

  async function handleActionSheetPush() {
    if (!deviceId) { setActionStatus('No device selected.'); return; }
    setActionBusy(true);
    try {
      setActionStatus('Pushing current action sheet...');
      const updated = await pushDeviceActionSheet(deviceId);
      applyActionSheet(updated);
      await waitForActionSheetSync();
    } catch (e: unknown) {
      setActionStatus(e instanceof Error ? e.message : 'Failed to push action sheet.');
    } finally {
      setActionBusy(false);
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

  const setActionField = (index: number, patch: Partial<AlertActionItem>) => {
    setActionForm((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const numberActionInput = (index: number, key: keyof AlertActionItem) => (
    <input
      className="inp"
      type="number"
      min="0"
      value={String(actionForm[index]?.[key] ?? 0)}
      onChange={(e) => setActionField(index, { [key]: Number(e.target.value || 0) } as Partial<AlertActionItem>)}
      disabled={!editable || actionBusy}
    />
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
              Last ACK: {fmtDT(config.last_ack_at)} | Verified: {fmtDT(config.verified_at)}
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
                    <div className="timeline-meta">v{h.version} | {verificationSummary(h)} | {fmtDT(h.reported_at)}</div>
                    <div className="timeline-detail">
                      Orange: {h.alert_level_mm}mm | Danger: {h.danger_level_mm}mm | Mode: {sensorModeLabel(h.sensor_mode ?? h.sensor_logic_mode)}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <p className="section-sep">Alert Action Sheet</p>
            <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 10, background: '#f8fafc', border: '1px solid #e2e8f0', fontSize: 12 }}>
              <div><strong>Sync State:</strong> {actionSheetSummary(actionSheet)}</div>
              <div><strong>Desired Version:</strong> {actionSheet?.action_sheet_version ?? actionSheet?.version ?? '--'}</div>
              <div><strong>MCU Version:</strong> {actionSheet?.current_action_sheet_version ?? actionSheet?.last_reported_action_sheet_version ?? '--'}</div>
              <div><strong>Last Sync:</strong> {fmtDT(actionSheet?.last_sync_at ?? actionSheet?.updated_at ?? undefined)}</div>
              <div><strong>Sync Source:</strong> {actionSheet?.last_sync_source || '--'}</div>
              <div><strong>Sync Message:</strong> {actionSheet?.last_sync_message || '--'}</div>
            </div>

            <div className="meta" style={{ marginBottom: 10 }}>
              RTU relay mapping: R1 Siren | R2 Flash Beacon | R3 Voice Trigger / Amplifier Trigger.
            </div>

            {actionForm.map((item, index) => {
              const mode = String(item.mode || 'OFF').toUpperCase();
              return (
                <div
                  key={`${item.alert_level}-${item.relay_number}`}
                  style={{
                    marginBottom: 12,
                    padding: '10px 12px',
                    borderRadius: 10,
                    background: item.alert_level === 'RED' ? '#fff7ed' : '#fffaf0',
                    border: `1px solid ${item.alert_level === 'RED' ? '#fdba74' : '#fde68a'}`
                  }}
                >
                  <div className="row between" style={{ alignItems: 'center', marginBottom: 8 }}>
                    <strong style={{ fontSize: 13 }}>{item.alert_level} - R{item.relay_number} {item.relay_name}</strong>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#334155' }}>
                      <input
                        type="checkbox"
                        checked={Boolean(item.enabled)}
                        onChange={(e) => setActionField(index, { enabled: e.target.checked })}
                        disabled={!editable || actionBusy}
                      />
                      Enabled
                    </label>
                  </div>

                  <label className="lbl">Mode</label>
                  <select
                    className="inp"
                    value={item.mode}
                    onChange={(e) => setActionField(index, { mode: e.target.value as AlertActionItem['mode'] })}
                    disabled={!editable || actionBusy}
                  >
                    <option value="OFF">OFF</option>
                    <option value="CONTINUOUS_ON">CONTINUOUS ON</option>
                    <option value="PULSE_REPEAT">PULSE REPEAT</option>
                  </select>

                  <div className="grid" style={{ marginTop: 8 }}>
                    <div>
                      <label className="lbl">ON Time (sec)</label>
                      {numberActionInput(index, 'on_time_sec')}
                    </div>
                    <div>
                      <label className="lbl">OFF Time (sec)</label>
                      {numberActionInput(index, 'off_time_sec')}
                    </div>
                    <div>
                      <label className="lbl">Repeat Interval (sec)</label>
                      {numberActionInput(index, 'repeat_interval_sec')}
                    </div>
                    <div>
                      <label className="lbl">Pulse Duration (sec)</label>
                      {numberActionInput(index, 'pulse_duration_sec')}
                    </div>
                  </div>

                  <div className="meta" style={{ marginTop: 6 }}>
                    {mode === 'CONTINUOUS_ON' && 'Relay stays ON continuously after confirmed alert.'}
                    {mode === 'PULSE_REPEAT' && 'Relay follows pulse or cycle timing after confirmed alert.'}
                    {mode === 'OFF' && 'Relay remains OFF for this alert level.'}
                  </div>
                </div>
              );
            })}

            {isVendorSuperAdmin ? (
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: '#7c2d12', marginBottom: 12 }}>
                <input
                  type="checkbox"
                  checked={redOverride}
                  onChange={(e) => setRedOverride(e.target.checked)}
                  disabled={!editable || actionBusy}
                  style={{ marginTop: 2 }}
                />
                <span>Vendor super-admin override: allow RED danger action sheet to keep all relays OFF.</span>
              </label>
            ) : (
              <div className="meta" style={{ marginBottom: 12 }}>
                Safety rule active: RED danger cannot have all three relays OFF.
              </div>
            )}

            {editable && (
              <div className="row" style={{ marginTop: 10 }}>
                <button className="control-btn info" style={{ marginTop: 0 }} onClick={handleActionSheetSave} disabled={actionBusy || cloudBusy || localBusy}>
                  <FiSave size={13} style={{ marginRight: 5 }} />Save Action Sheet
                </button>
                <button className="ghost-btn" onClick={handleActionSheetPush} disabled={actionBusy || cloudBusy || localBusy}>
                  <FiSend size={13} style={{ marginRight: 5 }} />Push Action Sheet
                </button>
              </div>
            )}
            {actionStatus && <div className="meta">{actionStatus}</div>}

            <div className="row between" style={{ marginTop: 16 }}>
              <h3 style={{ margin: 0, fontSize: 14 }}>Action Sheet History</h3>
              <button className="ghost-btn" style={{ padding: '6px 10px' }} onClick={loadActionHistory} disabled={actionBusy || cloudBusy || localBusy}>
                <FiRefreshCw size={12} />
              </button>
            </div>
            <div className="timeline" style={{ marginTop: 8 }}>
              {actionHistory.length === 0 ? <div className="empty">Tap refresh to load.</div> : actionHistory.map((h, i) => (
                <div key={i} className="timeline-item">
                  <div className="timeline-dot" />
                  <div className="timeline-body">
                    <div className="timeline-meta">
                      v{h.action_sheet_version ?? h.version ?? '--'} | {actionSheetSummary(h)} | {fmtDT(h.updated_at ?? h.last_sync_at ?? undefined)}
                    </div>
                    <div className="timeline-detail">
                      MCU v{h.current_action_sheet_version ?? h.last_reported_action_sheet_version ?? '--'} | {h.actions?.filter((entry) => entry.enabled).length ?? 0} relay rules enabled
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

