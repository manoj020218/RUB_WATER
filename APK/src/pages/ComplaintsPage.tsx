import { useEffect, useState, useCallback } from 'react';
import { FiMessageSquare, FiRefreshCw, FiCheckCircle } from 'react-icons/fi';
import { useApp } from '@/context/AppContext';
import { fetchComplaints, raiseComplaint, updateComplaintStatus } from '@/api/complaints';
import { Complaint } from '@/types';
import { IST_TIMEZONE } from '@/constants';

function fmtDate(iso?: string) {
  if (!iso) return '--';
  try { return new Date(iso).toLocaleDateString('en-IN', { timeZone: IST_TIMEZONE, day: '2-digit', month: 'short', year: 'numeric' }); } catch (_) { return iso; }
}

export default function ComplaintsPage() {
  const { state, showToast } = useApp();
  const locations = state.locations;

  const [locId, setLocId] = useState(state.selectedLocationId ?? '');
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(false);

  const [cType, setCType] = useState('');
  const [cPriority, setCPriority] = useState('MEDIUM');
  const [cDesc, setCDesc] = useState('');
  const [raiseStatus, setRaiseStatus] = useState('');

  const load = useCallback(async () => {
    if (!locId) return;
    setLoading(true);
    try { setComplaints(await fetchComplaints(locId)); } catch (e: unknown) { showToast(e instanceof Error ? e.message : 'Failed', true); } finally { setLoading(false); }
  }, [locId, showToast]);

  useEffect(() => { if (locId) load(); }, [locId, load]);

  async function handleRaise() {
    if (!locId) { setRaiseStatus('Select a location first.'); return; }
    if (!cType) { setRaiseStatus('Select complaint type.'); return; }
    if (!cDesc.trim() || cDesc.trim().length < 10) { setRaiseStatus('Description must be at least 10 chars.'); return; }
    setRaiseStatus('Submitting…');
    try {
      await raiseComplaint({ location_id: locId, complaint_type: cType, priority: cPriority, description: cDesc.trim() });
      setRaiseStatus('Complaint submitted.');
      setCType(''); setCDesc('');
      load();
    } catch (e: unknown) { setRaiseStatus(e instanceof Error ? e.message : 'Failed'); }
  }

  async function changeStatus(id: string, action: 'acknowledge' | 'resolve' | 'close') {
    try { await updateComplaintStatus(id, action); showToast(`Complaint ${action}d.`); load(); } catch (e: unknown) { showToast(e instanceof Error ? e.message : 'Failed', true); }
  }

  const open = complaints.filter((c) => c.status !== 'CLOSED').length;

  return (
    <section className="view active" id="view-complaints">
      <div className="card">
        <div className="row between">
          <div>
            <h2 className="view-title">Complaints</h2>
            <p className="view-subtitle">{locId ? `Location: ${locId}` : 'Select a location'}</p>
          </div>
          <span className={`chip ${open > 0 ? '' : 'off'}`}>{open} open</span>
        </div>

        <label className="lbl" style={{ marginTop: 8 }}>Select Location</label>
        <select className="inp" value={locId} onChange={(e) => setLocId(e.target.value)}>
          <option value="">Select a location…</option>
          {locations.map((l) => <option key={l.id} value={l.location_id || l.id}>{l.location_name}</option>)}
        </select>

        <p className="section-sep">Raise New Complaint</p>

        <label className="lbl">Complaint Type</label>
        <select className="inp" value={cType} onChange={(e) => setCType(e.target.value)}>
          <option value="">Select type…</option>
          <option value="device_offline">Device offline</option>
          <option value="water_sensor_faulty">Water level sensor faulty</option>
          <option value="level_switch_faulty">Level switch faulty</option>
          <option value="siren_not_working">Siren not working</option>
          <option value="beacon_not_working">Beacon light not working</option>
          <option value="voice_not_working">Voice announcement not working</option>
          <option value="battery_solar_issue">Battery low / solar issue</option>
          <option value="network_issue">4G router / network issue</option>
          <option value="false_alarm">False alarm suspected</option>
          <option value="physical_damage">Physical damage / theft</option>
          <option value="other">Other</option>
        </select>

        <label className="lbl">Priority</label>
        <select className="inp" value={cPriority} onChange={(e) => setCPriority(e.target.value)}>
          <option value="LOW">Low</option>
          <option value="MEDIUM">Medium</option>
          <option value="HIGH">High</option>
          <option value="CRITICAL">Critical</option>
        </select>

        <label className="lbl">Description</label>
        <textarea className="inp complaint-textarea" rows={3} value={cDesc} onChange={(e) => setCDesc(e.target.value)} placeholder="Describe the issue (min 10 chars)…" />

        <button className="primary-btn" onClick={handleRaise}>
          <FiMessageSquare size={14} style={{ marginRight: 6 }} />Submit Complaint
        </button>
        {raiseStatus && <div className="meta">{raiseStatus}</div>}

        <p className="section-sep">
          Complaint History
          <button className="ghost-btn" style={{ padding: '3px 8px', marginLeft: 8, fontSize: 11 }} onClick={load}><FiRefreshCw size={11} /></button>
        </p>

        <div className="timeline">
          {loading && <div className="empty">Loading…</div>}
          {!loading && complaints.length === 0 && <div className="empty">No complaints for this location.</div>}
          {complaints.map((c) => (
            <div key={c.id} className="timeline-item">
              <div className="timeline-dot" style={{ background: c.status === 'CLOSED' ? '#94a3b8' : c.priority === 'CRITICAL' ? '#dc2626' : c.priority === 'HIGH' ? '#d97706' : '#1d4ed8' }} />
              <div className="timeline-body">
                <div className="timeline-event">
                  {c.complaint_type?.replace(/_/g, ' ')}
                  <span className="chip off" style={{ marginLeft: 6, fontSize: 10 }}>{c.priority}</span>
                  <span className="chip" style={{ marginLeft: 4, fontSize: 10, background: c.status === 'CLOSED' ? '#f1f5f9' : '#dbeafe' }}>{c.status}</span>
                </div>
                <div className="timeline-meta">{fmtDate(c.created_at)}</div>
                {c.description && <div className="timeline-detail">{c.description}</div>}
                {c.status !== 'CLOSED' && (
                  <div className="row" style={{ gap: 6, marginTop: 6 }}>
                    {c.status === 'OPEN' && <button className="ghost-btn" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => changeStatus(c.id, 'acknowledge')}>Acknowledge</button>}
                    {c.status !== 'RESOLVED' && <button className="ghost-btn" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => changeStatus(c.id, 'resolve')}><FiCheckCircle size={11} style={{ marginRight: 3 }} />Resolve</button>}
                    <button className="ghost-btn" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => changeStatus(c.id, 'close')}>Close</button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
