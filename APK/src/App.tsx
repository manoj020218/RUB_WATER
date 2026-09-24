import React, { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useApp } from '@/context/AppContext';
import Toast from '@/components/Toast';
import BottomNav from '@/components/BottomNav';
import Topbar from '@/components/Topbar';
import UpdateBanner from '@/components/UpdateBanner';
import ForcePwModal from '@/components/ForcePwModal';
import { playDangerGong, isDangerEvent } from '@/utils/dangerSound';
import { ensurePushRegistration, setPushForegroundHandler } from '@/utils/pushNotifications';

const LoginPage = lazy(() => import('@/pages/LoginPage'));
const LocationsPage = lazy(() => import('@/pages/LocationsPage'));
const DashboardPage = lazy(() => import('@/pages/DashboardPage'));
const ControlsPage = lazy(() => import('@/pages/ControlsPage'));
const InstallPage = lazy(() => import('@/pages/InstallPage'));
const ConfigPage = lazy(() => import('@/pages/ConfigPage'));
const AuditPage = lazy(() => import('@/pages/AuditPage'));
const ComplaintsPage = lazy(() => import('@/pages/ComplaintsPage'));
const UsersPage = lazy(() => import('@/pages/UsersPage'));
const ReportsPage = lazy(() => import('@/pages/ReportsPage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));
const TransferPage = lazy(() => import('@/pages/TransferPage'));

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { state } = useApp();
  if (!state.token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  const { state, showToast } = useApp();
  const isLoggedIn = !!state.token;

  useEffect(() => {
    setPushForegroundHandler(({ title, body, data }) => {
      if (isDangerEvent(data)) {
        playDangerGong();
        showToast(`DANGER ALERT: ${data?.location_id || 'site'} - water level critical!`, true);
        return;
      }

      const line = body || title;
      if (line) {
        showToast(title && body ? `${title}: ${body}` : line);
      }
    });

    return () => { setPushForegroundHandler(null); };
  }, [showToast]);

  useEffect(() => {
    if (!state.apiBase || !state.token) return;
    ensurePushRegistration({
      apiBase: state.apiBase,
      authToken: state.token,
    }).catch((error) => {
      console.warn('[FCM] Initialization failed:', error instanceof Error ? error.message : error);
    });
  }, [state.apiBase, state.token]);

  return (
    <div className="app-shell">
      {isLoggedIn && <Topbar />}
      {isLoggedIn && <UpdateBanner />}
      <main className="main">
        <Suspense fallback={<div style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>Loading...</div>}>
          <Routes>
            <Route path="/login" element={isLoggedIn ? <Navigate to="/locations" replace /> : <LoginPage />} />
            <Route path="/locations" element={<RequireAuth><LocationsPage /></RequireAuth>} />
            <Route path="/dashboard" element={<RequireAuth><DashboardPage /></RequireAuth>} />
            <Route path="/controls" element={<RequireAuth><ControlsPage /></RequireAuth>} />
            <Route path="/install" element={<RequireAuth><InstallPage /></RequireAuth>} />
            <Route path="/config" element={<RequireAuth><ConfigPage /></RequireAuth>} />
            <Route path="/audit" element={<RequireAuth><AuditPage /></RequireAuth>} />
            <Route path="/complaints" element={<RequireAuth><ComplaintsPage /></RequireAuth>} />
            <Route path="/users" element={<RequireAuth><UsersPage /></RequireAuth>} />
            <Route path="/reports" element={<RequireAuth><ReportsPage /></RequireAuth>} />
            <Route path="/settings" element={<RequireAuth><SettingsPage /></RequireAuth>} />
            <Route path="/transfer" element={<RequireAuth><TransferPage /></RequireAuth>} />
            <Route path="*" element={<Navigate to={isLoggedIn ? '/locations' : '/login'} replace />} />
          </Routes>
        </Suspense>
      </main>
      {isLoggedIn && <BottomNav />}
      <Toast />
      {isLoggedIn && <ForcePwModal />}
    </div>
  );
}
