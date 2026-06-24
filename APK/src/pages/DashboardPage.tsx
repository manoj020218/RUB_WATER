import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiBattery, FiSun, FiWifi, FiClock, FiActivity, FiAlertTriangle, FiMapPin, FiServer, FiCloud, FiRadio } from 'react-icons/fi';
import { useApp } from '@/context/AppContext';
import { fetchDashboard } from '@/api/locations';
import { REFRESH_INTERVAL_MS, IST_TIMEZONE } from '@/constants';
import { RtuStatus, DashboardData } from '@/types';

function fmtTime(iso?: string) {
  if (!iso) return '--';
  try { return new Date(iso).toLocaleTimeString('en-IN', { timeZone: IST_TIMEZONE, hour: '2-digit', minute: '2-digit', second: '2-digit' }); } catch (_) { return iso; }
}

function fmtDT(iso?: string) {
  if (!iso) return '--';
  try { return new Date(iso).toLocaleString('en-IN', { timeZone: IST_TIMEZONE }); } catch (_) { return iso; }
}

function floodMeta(state: string) {
  switch ((state || '').toUpperCase()) {
    case 'DANGER': return { label: 'DANGER', cls: 'danger', color: '#dc2626' };
    case 'ALERT': return { label: 'ALERT', cls: 'warn', color: '#d97706' };
    case 'CLEAR': return { label: 'CLEAR', cls: '', color: '#059669' };
    default: return { label: 'OFFLINE', cls: 'off', color: '#94a3b8' };
  }
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

function alertStatusLabel(status?: string) {
  switch ((status || '').toUpperCase()) {
    case 'CONFIRMED':
      return 'Confirmed Alert';
    case 'SUSPECTED':
      return 'Suspected Alert / Sensor Conflict';
    case 'CONFIRMED_BY_SINGLE_SENSOR':
      return 'Single Sensor Mode';
    case 'WAITING_CONFIRMATION':
      return 'Waiting for Confirmation';
    case 'DISABLED':
    case 'DISABLED_MODE':
      return 'Alert Logic Disabled';
    default:
      return 'Idle';
  }
}

function RtuCard({ side, rtu, hasData }: { side: string; rtu?: RtuStatus; hasData: boolean }) {
  const online = hasData && !!rtu?.online;
  const batt = hasData ? (rtu?.batt ?? '--') : '--';
  const battOk = batt === 'OK';
  const battLow = batt === 'LOW';
  const state = hasData ? (rtu?.state ?? (online ? 'ONLINE' : 'OFFLINE')) : '--';
  return (
    <div className="rtu-card">
      <div className="rtu-card-header">
        <span className="rtu-title">{side} RTU</span>
        <span className={`rtu-badge rtu-badge-online${hasData ? (online ? ' online' : ' offline') : ''}`}>
          {hasData ? (online ? 'ONLINE' : 'OFFLINE') : '--'}
        </span>
      </div>
      <div className="rtu-batt-row">
        <span className="rtu-batt-label">State</span>
        <span className={`rtu-batt-value${online ? ' batt-ok' : ''}`}>{state}</span>
      </div>
      <div className="rtu-batt-row">
        <span className="rtu-batt-label">Battery</span>
        <span className={`rtu-batt-value${battOk ? ' batt-ok' : battLow ? ' batt-low' : ''}`}>
          {batt}{rtu?.battery_v ? ` (${rtu.battery_v.toFixed(1)}V)` : ''}
        </span>
      </div>
      <div className="relay-row rtu-relay-row">
        {(['siren', 'flash', 'voice'] as const).map((relayName) => {
          const on = hasData && !!rtu?.[relayName];
          return (
            <div key={relayName} className={`relay-item${on ? ' relay-on' : ''}`}>
              <div className="relay-led" />
              <div className="relay-label">{relayName.charAt(0).toUpperCase() + relayName.slice(1)}</div>
              <div className="relay-status">{hasData ? (on ? 'ON' : 'OFF') : '--'}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { state, dispatch, canOperate, showToast } = useApp();
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [tick, setTick] = useState(0);
  const [elapsed, setElapsed] = useState('--:--:--');
  const [nowStr, setNowStr] = useState('');
  const [apiOk, setApiOk] = useState<boolean | null>(null);
  const [sysExpanded, setSysExpanded] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const clockRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const incidentStartRef = useRef<string | null>(null);

  const locationId = state.selectedLocationId;

  const refresh = useCallback(async () => {
    if (!locationId) return;
    try {
      const d = await fetchDashboard(locationId);
      setData(d);
      setApiOk(true);
      if (d.latest) dispatch({ type: 'SET_TELEMETRY', telemetry: d.latest });
      if (d.incident !== undefined) dispatch({ type: 'SET_INCIDENT', incident: d.incident ?? null });
      incidentStartRef.current = d.incident?.started_at ?? null;
    } catch (e: unknown) {
      setApiOk(false);
      showToast(e instanceof Error ? e.message : 'Refresh failed', true);
    }
  }, [locationId, dispatch, showToast]);

  useEffect(() => {
    if (!locationId) return;
    refresh();
    timerRef.current = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [locationId, refresh]);

  useEffect(() => {
    function update() {
      const start = incidentStartRef.current;
      if (!start) { setElapsed('--:--:--'); return; }
      const secs = Math.floor((Date.now() - new Date(start).getTime()) / 1000);
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      const s = secs % 60;
      setElapsed(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
    }
    update();
    elapsedRef.current = setInterval(update, 1000);
    return () => { if (elapsedRef.current) clearInterval(elapsedRef.current); };
  }, [tick]);

  useEffect(() => { setTick((t) => t + 1); }, [data]);

  useEffect(() => {
    function tickClock() {
      setNowStr(new Date().toLocaleTimeString('en-IN', { timeZone: IST_TIMEZONE, hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    }
    tickClock();
    clockRef.current = setInterval(tickClock, 1000);
    return () => { if (clockRef.current) clearInterval(clockRef.current); };
  }, []);

  if (!locationId) {
    return (
      <section className="view active">
        <div className="card">
          <p className="empty" style={{ textAlign: 'center', padding: '32px 0' }}>
            Select a location from the Locations tab first.
          </p>
        </div>
      </section>
    );
  }

  const loc = data?.location ?? state.locations.find((l) => l.location_id === locationId || l.id === locationId);
  const latest = data?.latest;
  const config = data?.config;
  const incident = data?.incident;
  const mountHeight = Number(config?.sensor_mount_height_mm || loc?.mount_height_mm || 1200);
  const waterLevel = Number(latest?.water_level_mm ?? 0);
  const devOnline = (data?.device?.status || '').toUpperCase() === 'ONLINE';
  const floodState = latest?.flood_state ?? (devOnline ? 'CLEAR' : 'OFFLINE');
  const meta = floodMeta(floodState);
  const hasData = !!latest;

  const alertMm = Number(config?.alert_level_mm ?? 200);
  const dangerMm = Number(config?.danger_level_mm ?? 500);
  const sw1Mm = Number(config?.switch_level_1_mm ?? 300);

  const fillPct = hasData ? Math.max(0, Math.min(100, (waterLevel / mountHeight) * 100)) : 0;
  const alertPct = Math.max(2, Math.min(95, (alertMm / mountHeight) * 100));
  const sw1Pct = Math.max(2, Math.min(95, (sw1Mm / mountHeight) * 100));
  const dangerPct = Math.max(2, Math.min(95, (dangerMm / mountHeight) * 100));

  const lifecycle = (data?.device as Record<string, unknown>)?.lifecycle_status as string | undefined;
  const lifecycleNote = (data?.device as Record<string, unknown>)?.lifecycle_note as string | undefined;
  const isFaulty = lifecycle && ['FAULTY', 'UNDER_REPLACEMENT'].includes(lifecycle.toUpperCase());

  const heartbeatAt = data?.heartbeat?.received_at ?? latest?.received_at;
  const deviceLocalIp = latest?.local_ip || data?.device?.local_ip || data?.heartbeat?.details?.local_ip || '--';
  const mqttConnected = latest?.mqtt_connected ?? data?.device?.mqtt_connected ?? data?.heartbeat?.details?.mqtt_connected ?? false;
  const apiServerValue = latest?.api_server || data?.device?.api_server || '--';
  const mqttServerValue = latest?.mqtt_server || data?.device?.mqtt_server || '--';
  const hardwareId = latest?.hardware_id || data?.device?.hardware_id || data?.location?.hardware_id || '--';
  const mqttRouteId = latest?.mqtt_route_id || data?.device?.mqtt_route_id || data?.location?.mqtt_route_id || '--';
  const logicMode = sensorModeLabel(latest?.sensor_mode || latest?.sensor_logic_mode || config?.sensor_mode || config?.sensor_logic_mode);
  const zeroDist = latest?.zero_dist_mm ?? config?.sensor_mount_height_mm ?? null;
  const vmonCal = latest?.vmon_cal_factor ?? null;
  const incidentStartedAt = incident?.started_at;
  const alertLevel = latest?.alert_level || 'NORMAL';
  const alertStatus = latest?.alert_status || 'IDLE';
  const alertReason = latest?.alert_reason || '--';
  const pendingAlert = latest?.pending_alert_level || 'NORMAL';
  const confirmationWaitSec = latest?.sensor_confirmation_wait_sec ?? config?.sensor_confirmation_wait_sec ?? config?.mismatch_duration_seconds ?? null;

  return (
    <section className="view active" id="view-dashboard">
      <div className="card">
        <div className="live-hdr">
          <div className="live-hdr-left">
            <span className={`live-dot live-dot--${devOnline ? (meta.cls === 'danger' ? 'danger' : meta.cls === 'warn' ? 'warn' : 'online') : 'offline'}`} />
            <div>
              <h2 className="view-title">{loc?.location_name ?? locationId}</h2>
              <p className="view-subtitle">{loc?.location_id ?? locationId}</p>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            <span className={`chip ${meta.cls}`}>{meta.label}</span>
            <button className="ghost-btn" style={{ fontSize: 10, padding: '3px 8px', display: 'flex', alignItems: 'center', gap: 4 }} onClick={() => navigate('/locations')}>
              <FiMapPin size={10} />Switch Location
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, fontSize: 11, color: '#64748b' }}>
          <span>{new Date().toLocaleDateString('en-IN', { timeZone: IST_TIMEZONE, day: '2-digit', month: 'short', year: 'numeric' })}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{nowStr}</span>
        </div>

        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px', marginBottom: 10 }}>
          <div
            onClick={() => setSysExpanded((v) => !v)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', userSelect: 'none' }}
          >
            <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', color: '#475569', letterSpacing: '0.05em' }}>System Status</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className={`chip${meta.cls ? ` ${meta.cls}` : devOnline ? '' : ' off'}`} style={{ fontSize: 10, padding: '2px 8px' }}>{meta.label}</span>
              <span style={{ fontSize: 11, color: '#94a3b8' }}>{sysExpanded ? '▲' : '▼'}</span>
            </div>
          </div>
          {sysExpanded && (
            <div style={{ marginTop: 8 }}>
              {([
                { icon: <FiRadio size={12} />, label: 'Device ID', value: loc?.device_id ?? '--', ok: !!loc?.device_id },
                { icon: <FiRadio size={12} />, label: 'Hardware ID', value: hardwareId || '--', ok: hardwareId !== '--' },
                { icon: <FiActivity size={12} />, label: 'Device Status', value: meta.label, ok: meta.cls !== 'off', cls: meta.cls },
                { icon: <FiWifi size={12} />, label: 'Device Online', value: devOnline ? 'Online' : 'Offline', ok: devOnline },
                { icon: <FiWifi size={12} />, label: 'Wi-Fi RSSI', value: hasData ? `${latest?.rssi ?? latest?.wifi_rssi ?? '--'} dBm` : '--', ok: hasData && ((latest?.rssi ?? latest?.wifi_rssi ?? 0) as number) > -75 },
                { icon: <FiServer size={12} />, label: 'Local IP', value: deviceLocalIp, ok: deviceLocalIp !== '--' },
                { icon: <FiServer size={12} />, label: 'API Server', value: apiServerValue || '--', ok: apiServerValue !== '--' },
                { icon: <FiCloud size={12} />, label: 'Cloud API', value: apiOk == null ? 'Checking...' : apiOk ? 'UP' : 'DOWN', ok: apiOk === true },
                { icon: <FiCloud size={12} />, label: 'MQTT Connected', value: mqttConnected ? 'Connected' : 'Disconnected', ok: !!mqttConnected },
                { icon: <FiCloud size={12} />, label: 'MQTT Route', value: mqttRouteId || '--', ok: mqttRouteId !== '--' }
              ] as { icon: React.ReactNode; label: string; value: string; ok: boolean; cls?: string }[]).map(({ icon, label, value, ok, cls }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 5, marginBottom: 5, borderBottom: '1px solid #f1f5f9' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#64748b', fontSize: 12 }}>
                    {icon}<span>{label}</span>
                  </div>
                  <span className={`chip${cls ? ` ${cls}` : ok ? '' : ' off'}`} style={{ fontSize: 10, padding: '2px 8px' }}>{value}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, padding: '10px 12px', marginBottom: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', color: '#9a3412', marginBottom: 8, letterSpacing: '0.05em' }}>Current Alert</div>
          <div className="row between" style={{ marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: '#7c2d12' }}>Alert Level</span>
            <span className={`chip ${String(alertLevel).toUpperCase() === 'DANGER' ? 'danger' : String(alertLevel).toUpperCase() === 'ORANGE' ? 'warn' : ''}`}>{alertLevel}</span>
          </div>
          <div className="meta">Status: {alertStatusLabel(alertStatus)}</div>
          <div className="meta">Pending Level: {pendingAlert}</div>
          <div className="meta">Reason: {alertReason}</div>
        </div>

        <div className="meta">
          {hasData ? `Water: ${waterLevel} mm · ${floodState}` : 'Waiting for telemetry...'}
        </div>

        {isFaulty && (
          <div className="lifecycle-band">
            <div className="lifecycle-band-title"><FiAlertTriangle size={13} style={{ marginRight: 5 }} />{lifecycle}</div>
            {lifecycleNote && <div className="lifecycle-band-note">{lifecycleNote}</div>}
          </div>
        )}

        <div className="vessel-wrap">
          <div className="vessel">
            <div className="vessel-fill" style={{ height: `${fillPct}%`, background: meta.cls === 'danger' ? '#dc2626' : meta.cls === 'warn' ? '#d97706' : '#1d4ed8' }} />
            <div className="marker marker-alert" style={{ bottom: `${alertPct}%` }}>{alertMm}mm</div>
            <div className="marker marker-sw1" style={{ bottom: `${sw1Pct}%` }}>{sw1Mm}mm</div>
            <div className="marker marker-danger" style={{ bottom: `${dangerPct}%` }}>{dangerMm}mm</div>
          </div>
          <div className="vessel-metrics">
            <div className="metric-value" style={{ color: meta.color }}>{hasData ? waterLevel : '--'}</div>
            <div className="metric-unit">mm</div>
            <div className="meta">Distance: {hasData ? (latest?.distance_mm ?? '--') : '--'} mm</div>
            <div className="meta">Incident: {elapsed}</div>
            <div className="meta">Started: {fmtDT(incidentStartedAt)}</div>
          </div>
        </div>

        <div className="rtu-row">
          <RtuCard side="LEFT" rtu={latest?.remote_left} hasData={hasData} />
          <RtuCard side="RIGHT" rtu={latest?.remote_right} hasData={hasData} />
        </div>

        <div className="grid">
          <div className="mini-card">
            <div className="mini-label"><FiBattery size={12} style={{ marginRight: 4 }} />Battery Voltage</div>
            <div className="mini-value">{hasData ? `${latest?.battery_v ?? '--'} V` : '--'}</div>
          </div>
          <div className="mini-card">
            <div className="mini-label"><FiSun size={12} style={{ marginRight: 4 }} />Battery Current</div>
            <div className="mini-value">{hasData ? `${latest?.battery_ma ?? '--'} mA` : '--'}</div>
          </div>
          <div className="mini-card">
            <div className="mini-label"><FiWifi size={12} style={{ marginRight: 4 }} />Wi-Fi RSSI</div>
            <div className="mini-value">{hasData ? `${latest?.rssi ?? latest?.wifi_rssi ?? '--'} dBm` : '--'}</div>
          </div>
          <div className="mini-card">
            <div className="mini-label"><FiClock size={12} style={{ marginRight: 4 }} />Heartbeat</div>
            <div className="mini-value" style={{ fontSize: 11 }}>{fmtTime(heartbeatAt)}</div>
          </div>
        </div>

        <div className="grid" style={{ marginTop: 8 }}>
          <div className="mini-card">
            <div className="mini-label"><FiActivity size={12} style={{ marginRight: 4 }} />RS485 US Sensor</div>
            <div className="mini-value">{hasData ? (latest?.primary_sensor_status ?? (latest?.sensor_detected ? (latest?.sensor_valid ? 'OK' : 'INVALID') : 'NOT DETECTED')) : '--'}</div>
          </div>
          <div className="mini-card">
            <div className="mini-label">Switch Type Sensor L1</div>
            <div className="mini-value">{hasData ? (latest?.l1_active ? 'TRIPPED' : 'CLEAR') : '--'}</div>
          </div>
          <div className="mini-card">
            <div className="mini-label">Switch Type Sensor L2</div>
            <div className="mini-value">{hasData ? (latest?.l2_active ? 'TRIPPED' : 'CLEAR') : '--'}</div>
          </div>
          <div className="mini-card">
            <div className="mini-label">Sensor Input Mode</div>
            <div className="mini-value" style={{ fontSize: 11 }}>{logicMode}</div>
          </div>
        </div>

        <div className="grid" style={{ marginTop: 8 }}>
          <div className="mini-card">
            <div className="mini-label">Sensor Confirmation Wait Time</div>
            <div className="mini-value">{confirmationWaitSec != null ? `${confirmationWaitSec} sec` : '--'}</div>
          </div>
          <div className="mini-card">
            <div className="mini-label">Zero / Mount Height</div>
            <div className="mini-value">{zeroDist != null ? `${zeroDist} mm` : '--'}</div>
          </div>
          <div className="mini-card">
            <div className="mini-label">INA Cal Factor</div>
            <div className="mini-value">{vmonCal != null ? Number(vmonCal).toFixed(4) : '--'}</div>
          </div>
          <div className="mini-card">
            <div className="mini-label">MQTT Server</div>
            <div className="mini-value" style={{ fontSize: 11 }}>{mqttServerValue || '--'}</div>
          </div>
        </div>

        {canOperate() && (
          <div id="dash-quick-controls">
            <p className="section-sep">Quick Controls</p>
            <QuickControls locationId={locationId} deviceId={state.selectedDeviceId ?? ''} showToast={showToast} />
          </div>
        )}
      </div>
    </section>
  );
}

function QuickControls({ locationId, deviceId, showToast }: { locationId: string; deviceId: string; showToast: (m: string, e?: boolean) => void }) {
  const [reason, setReason] = useState('');
  async function mute() {
    const { muteAlarm } = await import('@/api/commands');
    try { await muteAlarm(locationId, deviceId); showToast('Alarm muted.'); } catch (e: unknown) { showToast(e instanceof Error ? e.message : 'Failed', true); }
  }
  async function dry() {
    const { dryRun } = await import('@/api/commands');
    try { await dryRun(locationId, deviceId); showToast('Dry run triggered.'); } catch (e: unknown) { showToast(e instanceof Error ? e.message : 'Failed', true); }
  }
  async function clear() {
    if (!reason.trim() || reason.trim().length < 5) { showToast('Enter a reason (min 5 chars).', true); return; }
    const { forceClear } = await import('@/api/commands');
    try { await forceClear(locationId, deviceId, reason.trim()); showToast('Incident cleared.'); setReason(''); } catch (e: unknown) { showToast(e instanceof Error ? e.message : 'Failed', true); }
  }
  return (
    <>
      <button className="control-btn warn" onClick={mute}>Mute Alarm</button>
      <button className="control-btn info" onClick={dry}>Dry Run Test</button>
      <input className="inp" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Force clear reason (min 5 chars)" style={{ marginTop: 8 }} />
      <button className="control-btn danger" onClick={clear}>Force Clear Incident</button>
      <p className="hint">All actions are audited with user/session/device metadata.</p>
    </>
  );
}
