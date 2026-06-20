import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiDroplet, FiBattery, FiSun, FiWifi, FiClock, FiActivity, FiAlertTriangle, FiMapPin, FiServer, FiCloud, FiRadio } from 'react-icons/fi';
import { useApp } from '@/context/AppContext';
import { fetchDashboard } from '@/api/locations';
import { REFRESH_INTERVAL_MS, IST_TIMEZONE } from '@/constants';
import { RtuStatus, DashboardData } from '@/types';

// ── helpers ───────────────────────────────────────────────────────────────────
function fmtTime(iso?: string) {
  if (!iso) return '--';
  try { return new Date(iso).toLocaleTimeString('en-IN', { timeZone: IST_TIMEZONE, hour: '2-digit', minute: '2-digit', second: '2-digit' }); } catch (_) { return iso; }
}

function floodMeta(state: string) {
  switch ((state || '').toUpperCase()) {
    case 'DANGER': return { label: 'DANGER', cls: 'danger', color: '#dc2626' };
    case 'ALERT':  return { label: 'ALERT',  cls: 'warn',   color: '#d97706' };
    case 'CLEAR':  return { label: 'CLEAR',  cls: '',       color: '#059669' };
    default:       return { label: 'OFFLINE',cls: 'off',    color: '#94a3b8' };
  }
}

// ── RTU card ──────────────────────────────────────────────────────────────────
function RtuCard({ side, rtu, hasData }: { side: string; rtu?: RtuStatus; hasData: boolean }) {
  const online  = hasData && !!rtu?.online;
  const batt    = hasData ? (rtu?.batt ?? '--') : '--';
  const battOk  = batt === 'OK';
  const battLow = batt === 'LOW';
  return (
    <div className="rtu-card">
      <div className="rtu-card-header">
        <span className="rtu-title">{side} RTU</span>
        <span className={`rtu-badge rtu-badge-online${hasData ? (online ? ' online' : ' offline') : ''}`}>
          {hasData ? (online ? 'ONLINE' : 'OFFLINE') : '--'}
        </span>
      </div>
      <div className="rtu-batt-row">
        <span className="rtu-batt-label">Battery</span>
        <span className={`rtu-batt-value${battOk ? ' batt-ok' : battLow ? ' batt-low' : ''}`}>{batt}</span>
      </div>
      <div className="relay-row rtu-relay-row">
        {(['siren', 'flash', 'voice'] as const).map((r) => {
          const on = hasData && !!rtu?.[r];
          return (
            <div key={r} className={`relay-item${on ? ' relay-on' : ''}`}>
              <div className="relay-led" />
              <div className="relay-label">{r.charAt(0).toUpperCase() + r.slice(1)}</div>
              <div className="relay-status">{hasData ? (on ? 'ON' : 'OFF') : '--'}</div>
            </div>
          );
        })}
        <div className="relay-item relay-item-future">
          <div className="relay-led" />
          <div className="relay-label">Boom</div>
          <div className="relay-status">FUTURE</div>
        </div>
      </div>
    </div>
  );
}

// ── Main dashboard ────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { state, dispatch, canOperate, showToast } = useApp();
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [tick, setTick] = useState(0);
  const [elapsed, setElapsed] = useState('--:--:--');
  const [nowStr, setNowStr] = useState('');
  const [apiOk, setApiOk] = useState<boolean | null>(null);
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

  // Incident elapsed timer
  useEffect(() => {
    function update() {
      const start = incidentStartRef.current;
      if (!start) { setElapsed('--:--:--'); return; }
      const secs = Math.floor((Date.now() - new Date(start).getTime()) / 1000);
      const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
      setElapsed(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
    }
    update();
    elapsedRef.current = setInterval(update, 1000);
    return () => { if (elapsedRef.current) clearInterval(elapsedRef.current); };
  }, [tick]);

  useEffect(() => { setTick((t) => t + 1); }, [data]);

  // Live clock
  useEffect(() => {
    function tick() {
      setNowStr(new Date().toLocaleTimeString('en-IN', { timeZone: IST_TIMEZONE, hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    }
    tick();
    clockRef.current = setInterval(tick, 1000);
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

  const loc     = data?.location ?? state.locations.find((l) => l.location_id === locationId || l.id === locationId);
  const latest  = data?.latest;
  const config  = data?.config;
  const incident = data?.incident;
  const mountHeight = Number(config?.sensor_mount_height_mm || loc?.mount_height_mm || 1200);
  const waterLevel = Number(latest?.water_level_mm ?? 0);
  const floodState = latest?.flood_state ?? (data?.device?.status === 'ONLINE' ? 'CLEAR' : 'OFFLINE');
  const meta = floodMeta(floodState);
  const hasData = !!latest;
  const devOnline = (data?.device?.status || '').toUpperCase() === 'ONLINE';

  const alertMm  = Number(config?.alert_level_mm  ?? 200);
  const dangerMm = Number(config?.danger_level_mm ?? 500);
  const sw1Mm    = Number(config?.switch_level_1_mm ?? 300);

  const fillPct  = hasData ? Math.max(0, Math.min(100, (waterLevel / mountHeight) * 100)) : 0;
  const alertPct  = Math.max(2, Math.min(95, (alertMm  / mountHeight) * 100));
  const sw1Pct    = Math.max(2, Math.min(95, (sw1Mm    / mountHeight) * 100));
  const dangerPct = Math.max(2, Math.min(95, (dangerMm / mountHeight) * 100));

  const lifecycle = (data?.device as Record<string, unknown>)?.lifecycle_status as string | undefined;
  const lifecycleNote = (data?.device as Record<string, unknown>)?.lifecycle_note as string | undefined;
  const isFaulty = lifecycle && ['FAULTY', 'UNDER_REPLACEMENT'].includes(lifecycle.toUpperCase());

  const heartbeatAt = data?.heartbeat?.received_at ?? latest?.received_at;

  return (
    <section className="view active" id="view-dashboard">
      <div className="card">
        {/* Live header */}
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
            <button
              className="ghost-btn"
              style={{ fontSize: 10, padding: '3px 8px', display: 'flex', alignItems: 'center', gap: 4 }}
              onClick={() => navigate('/locations')}
            >
              <FiMapPin size={10} />Switch Location
            </button>
          </div>
        </div>

        {/* Date / time bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, fontSize: 11, color: '#64748b' }}>
          <span>{new Date().toLocaleDateString('en-IN', { timeZone: IST_TIMEZONE, day: '2-digit', month: 'short', year: 'numeric' })}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{nowStr}</span>
        </div>

        {/* System Status */}
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px', marginBottom: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', color: '#475569', marginBottom: 8, letterSpacing: '0.05em' }}>System Status</div>
          {([
            { icon: <FiRadio size={12} />,  label: 'Device ID',     value: loc?.device_id ?? '--',              ok: !!loc?.device_id },
            { icon: <FiActivity size={12} />,label: 'Device Status', value: meta.label,                          ok: meta.cls !== 'off', cls: meta.cls },
            { icon: <FiWifi size={12} />,   label: 'Device Online', value: devOnline ? 'Online' : 'Offline',    ok: devOnline },
            { icon: <FiWifi size={12} />,   label: 'Wi-Fi RSSI',    value: hasData ? `${latest?.rssi ?? '--'} dBm` : '--', ok: hasData && (latest?.rssi ?? 0) > -80 },
            { icon: <FiServer size={12} />, label: 'API Server',    value: apiOk == null ? 'Checking…' : apiOk ? 'UP' : 'DOWN', ok: apiOk === true },
            { icon: <FiCloud size={12} />,  label: 'MQTT / Cloud',  value: devOnline && hasData ? 'Connected' : 'Disconnected', ok: devOnline && hasData },
          ] as { icon: React.ReactNode; label: string; value: string; ok: boolean; cls?: string }[]).map(({ icon, label, value, ok, cls }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 5, marginBottom: 5, borderBottom: '1px solid #f1f5f9' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#64748b', fontSize: 12 }}>
                {icon}<span>{label}</span>
              </div>
              <span className={`chip${cls ? ` ${cls}` : ok ? '' : ' off'}`} style={{ fontSize: 10, padding: '2px 8px' }}>{value}</span>
            </div>
          ))}
        </div>

        <div className="meta">
          {hasData ? `Water: ${waterLevel} mm · ${floodState}` : 'Waiting for telemetry…'}
        </div>

        {/* Lifecycle warning */}
        {isFaulty && (
          <div className="lifecycle-band">
            <div className="lifecycle-band-title">
              <FiAlertTriangle size={13} style={{ marginRight: 5 }} />{lifecycle}
            </div>
            {lifecycleNote && <div className="lifecycle-band-note">{lifecycleNote}</div>}
          </div>
        )}

        {/* Water vessel */}
        <div className="vessel-wrap">
          <div className="vessel">
            <div className="vessel-fill" style={{ height: `${fillPct}%`, background: meta.cls === 'danger' ? '#dc2626' : meta.cls === 'warn' ? '#d97706' : '#1d4ed8' }} />
            <div className="marker marker-alert" style={{ bottom: `${alertPct}%` }}>{alertMm}mm</div>
            <div className="marker marker-sw1"   style={{ bottom: `${sw1Pct}%` }}>{sw1Mm}mm</div>
            <div className="marker marker-danger" style={{ bottom: `${dangerPct}%` }}>{dangerMm}mm</div>
          </div>
          <div className="vessel-metrics">
            <div className="metric-value" style={{ color: meta.color }}>{hasData ? waterLevel : '--'}</div>
            <div className="metric-unit">mm</div>
            <div className="meta">Distance: {hasData ? (latest?.distance_mm ?? '--') : '--'} mm</div>
            <div className="meta">Incident: {elapsed}</div>
          </div>
        </div>

        {/* RTU cards */}
        <div className="rtu-row">
          <RtuCard side="LEFT"  rtu={latest?.remote_left}  hasData={hasData} />
          <RtuCard side="RIGHT" rtu={latest?.remote_right} hasData={hasData} />
        </div>

        {/* Power & connectivity */}
        <div className="grid">
          <div className="mini-card">
            <div className="mini-label"><FiBattery size={12} style={{ marginRight: 4 }} />Supply/Battery</div>
            <div className="mini-value">{hasData ? `${latest?.battery_v ?? '--'} V` : '--'}</div>
          </div>
          <div className="mini-card">
            <div className="mini-label"><FiSun size={12} style={{ marginRight: 4 }} />Current</div>
            <div className="mini-value">{hasData ? `${latest?.battery_ma ?? '--'} mA` : '--'}</div>
          </div>
          <div className="mini-card">
            <div className="mini-label"><FiWifi size={12} style={{ marginRight: 4 }} />Wi-Fi RSSI</div>
            <div className="mini-value">{hasData ? `${latest?.rssi ?? '--'} dBm` : '--'}</div>
          </div>
          <div className="mini-card">
            <div className="mini-label"><FiClock size={12} style={{ marginRight: 4 }} />Heartbeat</div>
            <div className="mini-value" style={{ fontSize: 11 }}>{fmtTime(heartbeatAt)}</div>
          </div>
        </div>

        {/* Sensor state */}
        <div className="grid" style={{ marginTop: 8 }}>
          <div className="mini-card">
            <div className="mini-label"><FiActivity size={12} style={{ marginRight: 4 }} />RS485 Sensor</div>
            <div className="mini-value">{hasData ? (latest?.sensor_detected ? (latest?.sensor_valid ? 'OK' : 'INVALID') : 'NOT DETECTED') : '--'}</div>
          </div>
          <div className="mini-card">
            <div className="mini-label">Switch L1 {sw1Mm}mm</div>
            <div className="mini-value">{hasData ? (latest?.l1_active ? 'TRIPPED' : 'CLEAR') : '--'}</div>
          </div>
          <div className="mini-card">
            <div className="mini-label">Switch L2 {dangerMm}mm</div>
            <div className="mini-value">{hasData ? (latest?.l2_active ? 'TRIPPED' : 'CLEAR') : '--'}</div>
          </div>
          <div className="mini-card">
            <div className="mini-label">Logic Mode</div>
            <div className="mini-value" style={{ fontSize: 11 }}>
              {[latest?.sensor_detected && 'RS485', latest?.l1_active !== undefined && 'Switch'].filter(Boolean).join('+') || '--'}
            </div>
          </div>
        </div>

        {/* Quick controls */}
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
