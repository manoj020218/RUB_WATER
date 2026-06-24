import React, { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useApp } from '@/context/AppContext';
import Toast from '@/components/Toast';
import BottomNav from '@/components/BottomNav';
import Topbar from '@/components/Topbar';
import ForcePwModal from '@/components/ForcePwModal';
import { playDangerGong, isDangerEvent } from '@/utils/dangerSound';

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
    let cleanup: (() => void) | undefined;
    import('@capacitor/push-notifications').then(({ PushNotifications }) => {
      const handle = PushNotifications.addListener('pushNotificationReceived', (notification) => {
        const data = notification.data as Record<string, string> | undefined;
        if (isDangerEvent(data)) {
          playDangerGong();
          showToast(`DANGER ALERT: ${data?.location_id || 'site'} — water level critical!`, true);
        }
      });
      cleanup = () => { handle.then((h) => h.remove()); };
    }).catch(() => {});
    return () => { cleanup?.(); };
  }, [showToast]);

  return (
    <div className="app-shell">
      {isLoggedIn && <Topbar />}
      <main className="main">
        <Suspense fallback={<div style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>Loading…</div>}>
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
