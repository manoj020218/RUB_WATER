import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiMapPin, FiRefreshCw, FiWifi, FiWifiOff, FiAlertTriangle, FiPlus, FiEdit2, FiTrash2, FiCheck, FiX } from 'react-icons/fi';
import { useApp } from '@/context/AppContext';
import { fetchLocations, addLocation, fetchAdminDevices, saveLocationDetails, deleteLocation, bindDevice } from '@/api/locations';
import { Location } from '@/types';

function statusColor(status?: string) {
  const s = (status || '').toUpperCase();
  if (s === 'ONLINE') return '#059669';
  if (s === 'OFFLINE') return '#dc2626';
  return '#94a3b8';
}

export default function LocationsPage() {
  const { state, dispatch, isSuperAdmin, showToast } = useApp();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  // Ã¢-â‚¬Ã¢-â‚¬ Add location Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬
  const [addId, setAddId] = useState('');
  const [addName, setAddName] = useState('');
  const [addDesc, setAddDesc] = useState('');
  const [addMount, setAddMount] = useState('');
  const [addDept, setAddDept] = useState('');
  const [addStatus, setAddStatus] = useState('');

  // Ã¢-â‚¬Ã¢-â‚¬ Register device Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬
  const [devAddId, setDevAddId] = useState('');
  const [devAddLoc, setDevAddLoc] = useState('');
  const [devAddStatus, setDevAddStatus] = useState('');
  const [adminDevices, setAdminDevices] = useState<{
    device_id: string;
    hardware_id?: string | null;
    mqtt_route_id?: string | null;
    location_id?: string;
  }[]>([]);

  // Ã¢-â‚¬Ã¢-â‚¬ Edit location Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬Ã¢-â‚¬
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLocId, setEditLocId] = useState('');
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editMount, setEditMount] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const locs = await fetchLocations();
      dispatch({ type: 'SET_LOCATIONS', locations: locs });
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to load locations', true);
    } finally {
      setLoading(false);
    }
  }, [dispatch, showToast]);

  useEffect(() => { load(); loadAdminDevices(); }, [load]);

  function selectLoc(loc: Location) {
    const locId = loc.location_id || loc.id;
    const devId = loc.device_id || null;
    dispatch({ type: 'SELECT_LOCATION', locationId: locId, deviceId: devId });
    navigate('/dashboard');
  }

  function startEdit(loc: Location) {
    const locId = loc.location_id || loc.id;
    setEditingId(locId);
    setEditLocId(locId);
    setEditName(loc.location_name || '');
    setEditDesc(loc.description || '');
    setEditMount(loc.mount_height_mm != null ? String(loc.mount_height_mm) : '');
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function saveEdit(locId: string, loc: Location) {
    const newLocId = editLocId.trim().toUpperCase();
    if (!newLocId) { showToast('Location ID is required.', true); return; }
    if (!editName.trim()) { showToast('Location name is required.', true); return; }
    setEditSaving(true);
    try {
      const idChanged = newLocId !== locId;
      if (idChanged) {
        // Create new location with the new ID
        await addLocation({
          location_id: newLocId,
          location_name: editName.trim(),
          description: editDesc.trim() || undefined,
          mount_height_mm: editMount ? Number(editMount) : undefined,
        });
        // Move bound device to new location before deleting old
        const boundDeviceId = loc.device_id;
        if (boundDeviceId) {
          await bindDevice(newLocId, boundDeviceId);
        }
        // Delete old location (device already moved, no unbind will happen)
        await deleteLocation(locId);
        showToast(`Location renamed to ${newLocId}.`);
      } else {
        await saveLocationDetails(locId, {
          location_name: editName.trim(),
          description: editDesc.trim() || undefined,
          sensor_mount_height_mm: editMount ? Number(editMount) : undefined,
        });
        showToast('Location updated.');
      }
      setEditingId(null);
      load();
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Update failed', true);
    } finally {
      setEditSaving(false);
    }
  }

  async function handleDelete(locId: string, locName: string) {
    if (!window.confirm(`Delete location "${locName}"?\nThis cannot be undone.`)) return;
    try {
      await deleteLocation(locId);
      showToast(`"${locName}" deleted.`);
      load();
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Delete failed', true);
    }
  }

  async function handleAddLocation() {
    if (!addId.trim() || !addName.trim()) { setAddStatus('Location ID and Name are required.'); return; }
    setAddStatus('Adding...');
    try {
      await addLocation({ location_id: addId.trim(), location_name: addName.trim(), description: addDesc.trim() || undefined, mount_height_mm: addMount ? Number(addMount) : undefined, department_id: addDept.trim() || undefined });
      setAddStatus('Location added.');
      setAddId(''); setAddName(''); setAddDesc(''); setAddMount(''); setAddDept('');
      load();
    } catch (e: unknown) { setAddStatus(e instanceof Error ? e.message : 'Failed'); }
  }

  async function loadAdminDevices() {
    try { const d = await fetchAdminDevices(); setAdminDevices(d); } catch (_) {}
  }

  async function handleAddDevice() {
    const id = devAddId.trim().toUpperCase();
    const loc = devAddLoc.trim();
    if (!id) { setDevAddStatus('Device ID required.'); return; }
    setDevAddStatus('Registering...');
    try {
      if (loc) {
        // bindDevice auto-creates if new, or rebinds if already registered  - no "already exists" error
        await bindDevice(loc, id);
        setDevAddStatus(`Device ${id} linked to ${loc}.`);
      } else {
        const { addDevice } = await import('@/api/locations');
        try {
          await addDevice(id);
          setDevAddStatus('Device registered (no location).');
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : '';
          if (/already exist/i.test(msg)) {
            setDevAddStatus(`${id} already registered. Select a location to reassign it.`);
            return;
          }
          throw e;
        }
      }
      setDevAddId(''); setDevAddLoc('');
      loadAdminDevices();
    } catch (e: unknown) { setDevAddStatus(e instanceof Error ? e.message : 'Failed'); }
  }

  const locations = state.locations;
  const isAdmin = isSuperAdmin();

  return (
    <section className="view active" id="view-locations">
      <div className="card">
        <div className="row between">
          <h2 className="view-title">Locations</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className="chip">{locations.length} sites</span>
            <button className="ghost-btn" style={{ padding: '5px 10px' }} onClick={load} title="Refresh">
              <FiRefreshCw size={14} />
            </button>
          </div>
        </div>

        {loading && <div className="empty">Loading locations...</div>}

        <div className="list" id="location-list">
          {!loading && locations.length === 0 && (
            <div className="empty">No locations assigned to your account.</div>
          )}
          {locations.map((loc) => {
            const locId = loc.location_id || loc.id;
            const status = (loc.device_status || 'OFFLINE').toUpperCase();
            const isOnline = status === 'ONLINE';
            const lifecycle = (loc.lifecycle_status || '').toUpperCase();
            const isFaulty = lifecycle === 'FAULTY' || lifecycle === 'UNDER_REPLACEMENT';
            const isEditing = editingId === locId;

            return (
              <div key={locId} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 0 }}>
                {/* Main row */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <div
                    style={{ display: 'flex', flex: 1, alignItems: 'flex-start', gap: 10, cursor: 'pointer', minWidth: 0 }}
                    onClick={() => !isEditing && selectLoc(loc)}
                  >
                    <FiMapPin size={16} color="#1d4ed8" style={{ flexShrink: 0, marginTop: 2 }} />
                    <div style={{ minWidth: 0 }}>
                      <div className="list-item-name">{loc.location_name}</div>
                      <div className="list-item-sub">{locId}</div>
                      {loc.device_id && (
                        <span className="chip device-ok" style={{ marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#16a34a', display: 'inline-block' }} />
                          {loc.device_id}
                        </span>
                      )}
                      {loc.hardware_id && (
                        <div style={{ marginTop: 4, fontSize: 11, color: '#64748b' }}>
                          HW: {loc.hardware_id}{loc.mqtt_route_id ? ` | Route: ${loc.mqtt_route_id}` : ''}
                        </div>
                      )}
                      {isFaulty && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3, fontSize: 11, color: '#d97706' }}>
                          <FiAlertTriangle size={11} />{lifecycle}
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                    <span className={`chip ${isOnline ? '' : 'off'}`} style={{ fontSize: 10 }}>
                      {isOnline ? <FiWifi size={10} style={{ marginRight: 3 }} /> : <FiWifiOff size={10} style={{ marginRight: 3 }} />}
                      {status}
                    </span>
                    {isAdmin && !isEditing && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          className="ghost-btn"
                          style={{ padding: '3px 7px', fontSize: 11 }}
                          onClick={(e) => { e.stopPropagation(); startEdit(loc); }}
                          title="Edit location"
                        >
                          <FiEdit2 size={12} />
                        </button>
                        <button
                          className="ghost-btn"
                          style={{ padding: '3px 7px', fontSize: 11, color: '#dc2626' }}
                          onClick={(e) => { e.stopPropagation(); handleDelete(locId, loc.location_name); }}
                          title="Delete location"
                        >
                          <FiTrash2 size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Inline edit form */}
                {isEditing && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #e2e8f0' }} onClick={(e) => e.stopPropagation()}>
                    <label style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', display: 'block', marginBottom: 2 }}>Location ID</label>
                    <input
                      className="inp"
                      value={editLocId}
                      onChange={(e) => setEditLocId(e.target.value.toUpperCase())}
                      placeholder="e.g. RUB42"
                      autoCapitalize="characters"
                      style={{ marginBottom: 4, fontFamily: 'monospace', fontWeight: 600 }}
                    />
                    {editLocId.trim().toUpperCase() !== locId && (
                      <div style={{ fontSize: 11, color: '#d97706', marginBottom: 4, padding: '4px 8px', background: '#fffbeb', borderRadius: 6, border: '1px solid #fcd34d' }}>
                        ID change: old location will be deleted and recreated as {editLocId.trim().toUpperCase() || '...'}
                      </div>
                    )}
                    <input
                      className="inp"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Location Name"
                      style={{ marginBottom: 4 }}
                    />
                    <input
                      className="inp"
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      placeholder="Description (optional)"
                      style={{ marginBottom: 4 }}
                    />
                    <input
                      className="inp"
                      value={editMount}
                      onChange={(e) => setEditMount(e.target.value)}
                      type="number"
                      placeholder="Mount height mm (optional)"
                      style={{ marginBottom: 8 }}
                    />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        className="control-btn info"
                        style={{ flex: 1, marginTop: 0 }}
                        onClick={() => saveEdit(locId, loc)}
                        disabled={editSaving}
                      >
                        <FiCheck size={12} style={{ marginRight: 4 }} />
                        {editSaving ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        className="ghost-btn"
                        style={{ flex: 1 }}
                        onClick={cancelEdit}
                        disabled={editSaving}
                      >
                        <FiX size={12} style={{ marginRight: 4 }} />Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {isAdmin && (
          <div id="loc-admin-panel">
            <p className="section-sep">Site Administration</p>

            <h4 className="admin-sub-title">Add New Location</h4>
            <div className="admin-2col">
              <input className="inp" value={addId} onChange={(e) => setAddId(e.target.value)} placeholder="Location ID (e.g. RUB044)" />
              <input className="inp" value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="Location Name" />
            </div>
            <input className="inp" value={addDesc} onChange={(e) => setAddDesc(e.target.value)} placeholder="Description (optional)" style={{ marginTop: 4 }} />
            <div className="admin-2col" style={{ marginTop: 4 }}>
              <input className="inp" value={addMount} onChange={(e) => setAddMount(e.target.value)} type="number" placeholder="Mount height mm" />
              <input className="inp" value={addDept} onChange={(e) => setAddDept(e.target.value)} placeholder="Department ID (optional)" />
            </div>
            <button className="control-btn info" style={{ marginTop: 8 }} onClick={handleAddLocation}>
              <FiPlus size={13} style={{ marginRight: 5 }} />Add Location
            </button>
            {addStatus && <div className="meta">{addStatus}</div>}

            <h4 className="admin-sub-title" style={{ marginTop: 16 }}>Register New Device (MCU)</h4>
            {(() => {
              const unassigned = adminDevices.filter((d) => !d.location_id);
              return unassigned.length > 0 ? (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#15803d', textTransform: 'uppercase', marginBottom: 4 }}>
                    Cloud Devices  - Not Yet Assigned
                  </div>
                  {unassigned.map((d) => (
                    <button
                      key={d.device_id}
                      className="ghost-btn"
                      style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '7px 10px', marginBottom: 4, border: devAddId === d.device_id ? '1px solid #4ade80' : '1px solid #e2e8f0', background: devAddId === d.device_id ? '#dcfce7' : '#f8fafc' }}
                      onClick={() => setDevAddId(d.device_id)}
                    >
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#16a34a', flexShrink: 0 }} />
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{d.device_id}</span>
                      <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 'auto' }}>Tap to select</span>
                    </button>
                  ))}
                </div>
              ) : null;
            })()}
            <div className="admin-2col">
              <input className="inp" value={devAddId} onChange={(e) => setDevAddId(e.target.value)} placeholder="Device ID (e.g. RUB044-CTRL01)" />
              <select className="inp" value={devAddLoc} onChange={(e) => setDevAddLoc(e.target.value)}>
                <option value="">No location  - bind later</option>
                {locations.map((l) => <option key={l.id} value={l.location_id || l.id}>{l.location_name}</option>)}
              </select>
            </div>
            <button className="control-btn info" style={{ marginTop: 8 }} onClick={handleAddDevice}>Register Device</button>
            {devAddStatus && <div className="meta">{devAddStatus}</div>}

            <div className="row between" style={{ marginTop: 16 }}>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#334155' }}>All Registered Devices</span>
              <button className="ghost-btn" style={{ padding: '5px 10px', fontSize: 11 }} onClick={loadAdminDevices}>Refresh</button>
            </div>
            <div style={{ marginTop: 6 }}>
              {adminDevices.length === 0
                ? <div className="empty">Tap Refresh to load devices.</div>
                : adminDevices.map((d) => (
                  <div key={d.device_id} style={{ padding: '8px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}>
                    <span style={{ fontWeight: 600 }}>{d.device_id}</span>
                    {d.location_id && <span style={{ color: '#64748b', marginLeft: 8 }}>| {d.location_id}</span>}
                    {(d.hardware_id || d.mqtt_route_id) && (
                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                        HW: {d.hardware_id ?? '--'}{d.mqtt_route_id ? ` | Route: ${d.mqtt_route_id}` : ''}
                      </div>
                    )}
                  </div>
                ))
              }
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
