import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/context/AppContext';
import { logout as apiLogout } from '@/api/auth';

export default function Topbar() {
  const { state, logout, showToast } = useApp();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function close(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    if (menuOpen) document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  async function handleLogout() {
    setMenuOpen(false);
    try { await apiLogout(); } catch (_) {}
    logout();
    navigate('/login', { replace: true });
  }

  return (
    <header className="topbar">
      <div className="brand-wrap">
        <img className="app-logo" src="/app-icon-192.png" alt="FloodGuard logo" />
        <div>
          <div className="brand">FloodGuard by Jenix</div>
          <div className="subtitle">Real-time RUB flood monitoring</div>
        </div>
      </div>
      <div className="top-menu-wrap" ref={menuRef}>
        <button
          className="ghost-btn menu-trigger"
          onClick={() => setMenuOpen((o) => !o)}
          title="Menu"
        >
          ⋮
        </button>
        {menuOpen && (
          <div className="top-menu" style={{ display: 'block' }}>
            <div className="top-menu-list">
              {state.user && (
                <div style={{ padding: '10px 14px', fontSize: 13, color: '#334155', borderBottom: '1px solid #e2e8f0' }}>
                  <div style={{ fontWeight: 700 }}>{state.user.name}</div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{state.user.role?.replace(/_/g, ' ')}</div>
                </div>
              )}
            </div>
            <button className="top-menu-logout" onClick={handleLogout}>Logout</button>
          </div>
        )}
      </div>
    </header>
  );
}
