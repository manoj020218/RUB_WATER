import { useState } from 'react';
import { FiLock, FiDownload, FiRefreshCw, FiInfo } from 'react-icons/fi';
import { useApp } from '@/context/AppContext';
import { changePassword, fetchAppRelease } from '@/api/auth';
import { APP_RELEASE_INFO } from '@/constants';

function cmpVersions(a: string, b: string) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

export default function SettingsPage() {
  const { state, dispatch, showToast } = useApp();

  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confPw, setConfPw] = useState('');
  const [pwStatus, setPwStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState('');

  async function handleChangePw() {
    if (!curPw || !newPw || !confPw) { setPwStatus('Fill all fields.'); return; }
    if (newPw.length < 6) { setPwStatus('New password must be at least 6 chars.'); return; }
    if (newPw !== confPw) { setPwStatus('Passwords do not match.'); return; }
    setBusy(true); setPwStatus('Saving…');
    try { await changePassword(curPw, newPw, confPw); setPwStatus('Password changed successfully.'); setCurPw(''); setNewPw(''); setConfPw(''); } catch (e: unknown) { setPwStatus(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  }

  async function checkUpdate() {
    setCheckingUpdate(true);
    try {
      const rel = await fetchAppRelease();
      dispatch({ type: 'SET_APP_RELEASE', latest: rel });
      const newer = (rel.versionCode ?? 0) > APP_RELEASE_INFO.versionCode || cmpVersions(rel.version ?? '0', APP_RELEASE_INFO.version) > 0;
      showToast(newer ? `Update available: v${rel.version}` : 'You are on the latest version.');
    } catch (e: unknown) { showToast(e instanceof Error ? e.message : 'Update check failed', true); } finally { setCheckingUpdate(false); }
  }

  const latest = state.appUpdate.latest;
  const updateAvailable = latest && ((latest.versionCode ?? 0) > APP_RELEASE_INFO.versionCode || cmpVersions(latest.version ?? '0', APP_RELEASE_INFO.version) > 0);

  function download() {
    if (!latest?.downloadUrl) return;
    // Session (token, location) is already auto-persisted to localStorage by AppContext.
    // Force an explicit sync here as a safety net before navigating away.
    try {
      const saved = localStorage.getItem('fg_mobile_session_v1');
      if (saved) localStorage.setItem('fg_mobile_session_v1', saved); // re-write to flush any pending
    } catch (_) {}
    setDownloadStatus('Local data saved. Opening download…');
    setTimeout(() => {
      const a = document.createElement('a');
      a.href = latest!.downloadUrl!;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.setAttribute('download', latest?.fileName ?? 'FloodGuard-release.apk');
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setDownloadStatus('APK download started. Tap the downloaded file to install.');
    }, 300);
  }

  return (
    <section className="view active" id="view-settings">
      <div className="card">
        <h2 className="view-title">Settings</h2>
        <p className="view-subtitle">{state.user?.name ?? '--'} · {state.user?.role?.replace(/_/g, ' ')}</p>

        <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>
          <FiInfo size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />App Build
        </h3>
        <div className="build-info-panel">
          <div className="build-info-line"><span className="build-info-label">Version</span><span className="build-info-value">v{APP_RELEASE_INFO.version}</span></div>
          <div className="build-info-line"><span className="build-info-label">Build Code</span><span className="build-info-value">{APP_RELEASE_INFO.versionCode}</span></div>
          <div className="build-info-line"><span className="build-info-label">Last Release</span><span className="build-info-value">{APP_RELEASE_INFO.releasedLabel} ({APP_RELEASE_INFO.releasedAt})</span></div>
        </div>

        <h3 style={{ fontSize: 14, margin: '16px 0 8px' }}>
          <FiRefreshCw size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />App Updates
        </h3>
        <div className="build-info-panel">
          <div className="build-info-line"><span className="build-info-label">Update Channel</span><span className="build-info-value">FloodGuard VPS</span></div>
          {latest && <>
            <div className="build-info-line"><span className="build-info-label">Latest Published</span><span className="build-info-value">v{latest.version}</span></div>
            <div className="build-info-line"><span className="build-info-label">Status</span><span className="build-info-value" style={{ color: updateAvailable ? '#d97706' : '#059669' }}>{updateAvailable ? 'Update available' : 'Up to date'}</span></div>
          </>}
          <div className="row" style={{ marginTop: 10 }}>
            <button className="ghost-btn" style={{ flex: 1 }} onClick={checkUpdate} disabled={checkingUpdate}>
              <FiRefreshCw size={12} style={{ marginRight: 5 }} />{checkingUpdate ? 'Checking…' : 'Check for Update'}
            </button>
            {updateAvailable && latest?.downloadUrl && (
              <button className="control-btn info" style={{ marginTop: 0, flex: 1 }} onClick={download}>
                <FiDownload size={12} style={{ marginRight: 5 }} />Download Latest APK
              </button>
            )}
          </div>
          {downloadStatus && <div className="meta" style={{ marginTop: 6 }}>{downloadStatus}</div>}
          {latest?.notes && latest.notes.length > 0 && (
            <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, color: '#475569' }}>
              {latest.notes.map((n: string, i: number) => <li key={i}>{n}</li>)}
            </ul>
          )}
        </div>

        <h3 style={{ fontSize: 14, margin: '16px 0 8px' }}>
          <FiLock size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />Change Password
        </h3>
        <label className="lbl">Current Password</label>
        <input className="inp" type="password" value={curPw} onChange={(e) => setCurPw(e.target.value)} placeholder="Current password" />
        <label className="lbl">New Password</label>
        <input className="inp" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="New password (min 6 chars)" />
        <label className="lbl">Confirm New Password</label>
        <input className="inp" type="password" value={confPw} onChange={(e) => setConfPw(e.target.value)} placeholder="Confirm new password" />
        <button className="primary-btn" onClick={handleChangePw} disabled={busy}>
          {busy ? 'Saving…' : 'Change Password'}
        </button>
        {pwStatus && <div className="meta">{pwStatus}</div>}
      </div>
    </section>
  );
}
