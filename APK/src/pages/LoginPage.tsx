import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiLogIn, FiServer, FiUser, FiLock } from 'react-icons/fi';
import { useApp } from '@/context/AppContext';
import { login } from '@/api/auth';
import { normalizeApiBase, configureClient } from '@/api/client';
import { APP_RELEASE_INFO, DEFAULT_API_BASE } from '@/constants';

export default function LoginPage() {
  const { dispatch, showToast } = useApp();
  const navigate = useNavigate();

  const [apiBase, setApiBase] = useState(DEFAULT_API_BASE);
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleLogin() {
    setError('');
    if (!loginId.trim() || !password) { setError('Enter login ID and password.'); return; }
    const base = normalizeApiBase(apiBase);
    setBusy(true);
    try {
      configureClient({ apiBase: base, token: '' });
      const res = await login(base, loginId.trim(), password);
      // Set token on the client immediately so the first auth'd request on /locations
      // doesn't race against the AppContext useEffect that does the same thing async.
      configureClient({ apiBase: base, token: res.token });
      dispatch({
        type: 'LOGIN',
        apiBase: base,
        token: res.token,
        user: res.user,
        session: { token: res.token, refreshToken: res.refreshToken, expiresAt: res.expiresAt },
      });
      showToast(`Welcome, ${res.user.name}`);
      navigate('/locations', { replace: true });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Login failed. Check credentials.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="view active" id="view-login">
      <div className="card">
        <h1 className="view-title">Secure Login</h1>
        <p className="view-subtitle">Sign in with authorized dashboard credentials.</p>

        <label className="lbl">
          <FiServer size={13} style={{ marginRight: 5, verticalAlign: 'middle' }} />
          API Base URL
        </label>
        <input
          className="inp"
          value={apiBase}
          onChange={(e) => setApiBase(e.target.value)}
          placeholder={DEFAULT_API_BASE}
          autoCapitalize="none"
          autoCorrect="off"
        />

        <label className="lbl">
          <FiUser size={13} style={{ marginRight: 5, verticalAlign: 'middle' }} />
          Login ID
        </label>
        <input
          className="inp"
          value={loginId}
          onChange={(e) => setLoginId(e.target.value)}
          placeholder="operator_rub043"
          autoCapitalize="none"
          autoCorrect="off"
        />

        <label className="lbl">
          <FiLock size={13} style={{ marginRight: 5, verticalAlign: 'middle' }} />
          Password
        </label>
        <input
          className="inp"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter password"
          onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
        />

        <button className="primary-btn" onClick={handleLogin} disabled={busy}>
          <FiLogIn size={15} style={{ marginRight: 6, verticalAlign: 'middle' }} />
          {busy ? 'Signing in…' : 'Login'}
        </button>

        <p className="hint">Access can be granted or withdrawn by super admin from dashboard.</p>

        <div className="build-info-panel">
          <div className="build-info-title">App Version</div>
          <div className="build-info-line">
            <span>v{APP_RELEASE_INFO.version}</span>
            <span className="build-info-sep">|</span>
            <span>Released {APP_RELEASE_INFO.releasedLabel}</span>
          </div>
        </div>

        {error && <div className="err">{error}</div>}
      </div>
    </section>
  );
}
