import { useEffect, useState } from 'react';
import { FiDownload, FiSearch } from 'react-icons/fi';
import { useApp } from '@/context/AppContext';
import { fetchAuditReport } from '@/api/complaints';
import { ReportRow } from '@/types';
import { IST_TIMEZONE } from '@/constants';

function fmtDT(iso?: string) {
  if (!iso) return '--';
  try { return new Date(iso).toLocaleString('en-IN', { timeZone: IST_TIMEZONE, day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (_) { return iso; }
}

export default function ReportsPage() {
  const { state, showToast } = useApp();
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');

  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [locFilter, setLocFilter] = useState('');
  const [eventType, setEventType] = useState('');
  const [limit, setLimit] = useState('100');

  useEffect(() => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    setDateTo(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`);
    const from = new Date(now); from.setDate(from.getDate() - 7);
    setDateFrom(`${from.getFullYear()}-${pad(from.getMonth() + 1)}-${pad(from.getDate())}`);
  }, []);

  async function loadReport() {
    setStatus('Loading…'); setLoading(true);
    try {
      const res = await fetchAuditReport({ from: dateFrom, to: dateTo, location_id: locFilter || undefined, event_type: eventType || undefined, limit: Number(limit) });
      setRows(res.rows ?? []);
      setStatus(`${res.rows?.length ?? 0} records loaded.`);
    } catch (e: unknown) { setStatus(e instanceof Error ? e.message : 'Failed'); showToast('Report failed', true); } finally { setLoading(false); }
  }

  function exportCsv() {
    if (rows.length === 0) { showToast('No data to export.', true); return; }
    const header = 'Time (IST),Location,Event,Details,User';
    const csv = [header, ...rows.map((r) => [
      fmtDT(r.created_at), r.location_id ?? '', r.event_type ?? '',
      JSON.stringify(r.details ?? '').replace(/,/g, ';'), r.user_id ?? ''
    ].map((v) => `"${v}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `fg-audit-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="view active" id="view-reports">
      <div className="card">
        <div className="row between">
          <div>
            <h2 className="view-title">Audit Report</h2>
            <p className="view-subtitle">Export filtered audit logs</p>
          </div>
          <span className={`chip ${rows.length > 0 ? '' : 'off'}`}>{rows.length} records</span>
        </div>

        <p className="section-sep">Filters</p>
        <div className="report-filter-grid">
          <div><label className="lbl">From Date</label><input className="inp" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></div>
          <div><label className="lbl">To Date</label><input className="inp" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></div>
        </div>
        <label className="lbl">Location</label>
        <select className="inp" value={locFilter} onChange={(e) => setLocFilter(e.target.value)}>
          <option value="">All Locations</option>
          {state.locations.map((l) => <option key={l.id} value={l.location_id || l.id}>{l.location_name}</option>)}
        </select>
        <div className="report-filter-grid">
          <div>
            <label className="lbl">Event Type</label>
            <select className="inp" value={eventType} onChange={(e) => setEventType(e.target.value)}>
              <option value="">All Events</option>
              <option value="ALARM_TRIGGERED">Alarm Triggered</option>
              <option value="ALARM_CLEARED">Alarm Cleared</option>
              <option value="ALARM_MUTED">Alarm Muted</option>
              <option value="COMMAND_FORCE_CLEAR">Force Clear</option>
              <option value="COMMAND_DRY_RUN">Dry Run</option>
              <option value="CONFIG_CHANGED">Config Changed</option>
              <option value="DEVICE_ONLINE">Device Online</option>
              <option value="DEVICE_OFFLINE">Device Offline</option>
              <option value="LIFECYCLE_CHANGE">Lifecycle Change</option>
              <option value="COMPLAINT_RAISED">Complaint Raised</option>
            </select>
          </div>
          <div>
            <label className="lbl">Max Records</label>
            <select className="inp" value={limit} onChange={(e) => setLimit(e.target.value)}>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="200">200</option>
              <option value="500">500</option>
            </select>
          </div>
        </div>

        <button className="primary-btn" onClick={loadReport} disabled={loading}>
          <FiSearch size={14} style={{ marginRight: 6 }} />{loading ? 'Loading…' : 'Load Preview'}
        </button>
        {status && <div className="meta">{status}</div>}

        {rows.length > 0 && (
          <>
            <div className="report-count-bar">
              <span>{rows.length} records loaded</span>
              <button className="ghost-btn" style={{ padding: '5px 10px', fontSize: 11 }} onClick={exportCsv}>
                <FiDownload size={12} style={{ marginRight: 4 }} />Export CSV
              </button>
            </div>
            <div className="report-table-wrap">
              <table className="report-table">
                <thead>
                  <tr><th>Time (IST)</th><th>Location</th><th>Event</th><th>User</th></tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td>{fmtDT(r.created_at)}</td>
                      <td>{r.location_id ?? '--'}</td>
                      <td>{r.event_type?.replace(/_/g, ' ')}</td>
                      <td>{r.user_id ?? '--'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
