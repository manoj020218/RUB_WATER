import { useEffect, useState, useCallback } from 'react';
import { FiRefreshCw, FiFileText, FiDownload } from 'react-icons/fi';
import { useApp } from '@/context/AppContext';
import { fetchAuditLogs } from '@/api/locations';
import { AuditLog } from '@/types';
import { IST_TIMEZONE } from '@/constants';

function getTs(log: AuditLog): string {
  return log.timestamp || log.created_at || '';
}

function fmtFull(iso: string): string {
  if (!iso) return '--';
  try {
    return new Date(iso).toLocaleString('en-IN', {
      timeZone: IST_TIMEZONE,
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
  } catch (_) { return iso; }
}

function fmtShort(iso: string): string {
  if (!iso) return '--';
  try {
    return new Date(iso).toLocaleString('en-IN', {
      timeZone: IST_TIMEZONE,
      day: '2-digit', month: 'short',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
  } catch (_) { return iso; }
}

function buildDetails(log: AuditLog): string {
  const parts: string[] = [];
  if (log.details?.reason) parts.push(`Reason: ${log.details.reason as string}`);
  if (log.details?.water_level_mm != null) parts.push(`Water: ${Math.round(Number(log.details.water_level_mm))}mm`);
  if (log.details?.command) parts.push(`Cmd: ${log.details.command as string}`);
  if (log.details?.target_login_id) parts.push(`Target: ${log.details.target_login_id as string}`);
  return parts.join(' · ');
}

async function shareFile(content: string, filename: string, showToast: (m: string, e?: boolean) => void) {
  try {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    await Filesystem.writeFile({ path: filename, data: content, directory: Directory.Cache, encoding: Encoding.UTF8 });
    const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Cache });
    await Share.share({ title: filename, url: uri, dialogTitle: 'Save or share audit log' });
  } catch (_) {
    showToast('Could not share file on this device.', true);
  }
}

function buildCsv(logs: AuditLog[], locationId: string): string {
  const rows = [['Timestamp', 'Event Type', 'Location', 'User', 'Device', 'Details']];
  logs.forEach((log) => {
    rows.push([
      fmtFull(getTs(log)),
      log.event_type || '',
      log.location_id || locationId,
      log.user_id || '',
      log.device_id || '',
      buildDetails(log)
    ]);
  });
  return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
}

function buildTxt(logs: AuditLog[], locationId: string): string {
  const lines = [`Audit Log — ${locationId} — exported ${fmtFull(new Date().toISOString())}`, ''];
  logs.forEach((log) => {
    const ts = fmtFull(getTs(log));
    const detail = buildDetails(log);
    lines.push(`[${ts}] ${log.event_type || '?'} · ${log.location_id || locationId} · ${log.user_id || '-'}${detail ? ' · ' + detail : ''}`);
  });
  return lines.join('\n');
}

export default function AuditPage() {
  const { state, showToast } = useApp();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);

  const locationId = state.selectedLocationId;

  const load = useCallback(async () => {
    if (!locationId) return;
    setLoading(true);
    try { setLogs(await fetchAuditLogs(locationId)); } catch (e: unknown) { showToast(e instanceof Error ? e.message : 'Failed', true); } finally { setLoading(false); }
  }, [locationId, showToast]);

  useEffect(() => { load(); }, [load]);

  return (
    <section className="view active" id="view-audit">
      <div className="card">
        <div className="row between" style={{ alignItems: 'center', marginBottom: 12 }}>
          <h2 className="view-title" style={{ margin: 0 }}>Audit Timeline</h2>
          <div style={{ display: 'flex', gap: 6 }}>
            {logs.length > 0 && locationId && (
              <>
                <button className="ghost-btn" style={{ padding: '5px 8px', fontSize: 12 }} title="Share CSV"
                  onClick={() => shareFile(buildCsv(logs, locationId), `audit_${locationId}_${new Date().toISOString().slice(0,10)}.csv`, showToast)}>
                  <FiDownload size={13} style={{ marginRight: 4, verticalAlign: 'middle' }} />CSV
                </button>
                <button className="ghost-btn" style={{ padding: '5px 8px', fontSize: 12 }} title="Share TXT"
                  onClick={() => shareFile(buildTxt(logs, locationId), `audit_${locationId}_${new Date().toISOString().slice(0,10)}.txt`, showToast)}>
                  <FiDownload size={13} style={{ marginRight: 4, verticalAlign: 'middle' }} />TXT
                </button>
              </>
            )}
            <button className="ghost-btn" style={{ padding: '5px 8px' }} onClick={load}>
              <FiRefreshCw size={14} />
            </button>
          </div>
        </div>

        {!locationId && <div className="empty">Select a location first.</div>}
        {locationId && loading && <div className="empty">Loading...</div>}
        {locationId && !loading && (
          <div className="timeline">
            {logs.length === 0
              ? <div className="empty">No audit logs available.</div>
              : logs.slice(0, 50).map((log, i) => {
                const ts = getTs(log);
                const detail = buildDetails(log);
                return (
                  <div key={log.id ?? i} className="timeline-item">
                    <div className="timeline-dot" />
                    <div className="timeline-body">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
                        <div className="timeline-event">
                          <FiFileText size={11} style={{ marginRight: 5, verticalAlign: 'middle', color: '#1d4ed8' }} />
                          {log.event_type?.replace(/_/g, ' ')}
                        </div>
                        {ts && (
                          <span style={{ fontSize: 10, color: '#94a3b8', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                            {fmtShort(ts)}
                          </span>
                        )}
                      </div>
                      <div className="timeline-meta">
                        {log.location_id && `${log.location_id}`}
                        {log.user_id && ` · ${log.user_id}`}
                      </div>
                      {detail && <div className="timeline-detail">{detail}</div>}
                    </div>
                  </div>
                );
              })
            }
          </div>
        )}
      </div>
    </section>
  );
}
