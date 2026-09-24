import { useEffect, useState } from 'react';
import { FiDownloadCloud, FiX } from 'react-icons/fi';
import { useApp } from '@/context/AppContext';
import { fetchAppRelease } from '@/api/auth';
import { APP_RELEASE_INFO, PLAY_STORE_URL } from '@/constants';
import { isUpdateAvailable } from '@/utils/version';

const DISMISS_KEY = 'fg_update_dismissed_version_v1';
const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;

export default function UpdateBanner() {
  const { state, dispatch } = useApp();
  const [dismissedVersionCode, setDismissedVersionCode] = useState<number | null>(() => {
    try {
      const raw = localStorage.getItem(DISMISS_KEY);
      return raw ? Number(raw) : null;
    } catch (_) {
      return null;
    }
  });

  useEffect(() => {
    if (!state.token || !state.apiBase) return;
    const lastChecked = state.appUpdate.lastCheckedAt ? new Date(state.appUpdate.lastCheckedAt).getTime() : 0;
    if (Date.now() - lastChecked < CHECK_INTERVAL_MS) return;
    fetchAppRelease()
      .then((rel) => dispatch({ type: 'SET_APP_RELEASE', latest: rel }))
      .catch(() => {});
  }, [state.token, state.apiBase]);

  const latest = state.appUpdate.latest;
  const updateAvailable = isUpdateAvailable(latest, APP_RELEASE_INFO.version, APP_RELEASE_INFO.versionCode);

  if (!updateAvailable || !latest) return null;
  if (dismissedVersionCode != null && (latest.versionCode ?? 0) <= dismissedVersionCode) return null;

  function openPlayStore() {
    const a = document.createElement('a');
    a.href = PLAY_STORE_URL;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function dismiss() {
    const code = latest?.versionCode ?? 0;
    setDismissedVersionCode(code);
    try {
      localStorage.setItem(DISMISS_KEY, String(code));
    } catch (_) {}
  }

  return (
    <div className="update-banner">
      <FiDownloadCloud size={16} style={{ flexShrink: 0 }} />
      <span className="update-banner-text">Update available: v{latest.version} is on Play Store.</span>
      <button className="update-banner-btn" onClick={openPlayStore}>Update</button>
      <button className="update-banner-dismiss" onClick={dismiss} title="Dismiss" aria-label="Dismiss">
        <FiX size={14} />
      </button>
    </div>
  );
}
