import { useEffect, useState, useCallback } from 'react';
import { FiRefreshCw, FiFileText } from 'react-icons/fi';
import { useApp } from '@/context/AppContext';
import { fetchAuditLogs } from '@/api/locations';
import { AuditLog } from '@/types';
import { IST_TIMEZONE } from '@/constants';

function fmtDateTime(iso?: string) {
  if (!iso) return '--';
  try { return new Date(iso).toLocaleString('en-IN', { timeZone: IST_TIMEZONE, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (_) { return iso; }
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
        <div className="row between">
          <h2 className="view-title">Audit Timeline</h2>
          <button className="ghost-btn" style={{ padding: '5px 10px' }} onClick={load}>
            <FiRefreshCw size={14} />
          </button>
        </div>
        {!locationId && <div className="empty">Select a location first.</div>}
        {locationId && loading && <div className="empty">Loading…</div>}
        {locationId && !loading && (
          <div className="timeline">
            {logs.length === 0
              ? <div className="empty">No audit logs available.</div>
              : logs.slice(0, 30).map((log, i) => {
                const details: string[] = [];
                if (log.details?.reason) details.push(`Reason: ${log.details.reason as string}`);
                if (log.details?.water_level_mm != null) details.push(`Water: ${Math.round(Number(log.details.water_level_mm))}mm`);
                return (
                  <div key={log.id ?? i} className="timeline-item">
                    <div className="timeline-dot" />
                    <div className="timeline-body">
                      <div className="timeline-event">
                        <FiFileText size={11} style={{ marginRight: 5, verticalAlign: 'middle', color: '#1d4ed8' }} />
                        {log.event_type?.replace(/_/g, ' ')}
                      </div>
                      <div className="timeline-meta">
                        {fmtDateTime(log.created_at)}
                        {log.location_id && ` · ${log.location_id}`}
                        {log.user_id && ` · ${log.user_id}`}
                      </div>
                      {details.length > 0 && <div className="timeline-detail">{details.join(' · ')}</div>}
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
