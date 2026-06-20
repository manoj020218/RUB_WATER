import React, { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useApp } from '@/context/AppContext';
import Toast from '@/components/Toast';
import BottomNav from '@/components/BottomNav';
import Topbar from '@/components/Topbar';
import ForcePwModal from '@/components/ForcePwModal';

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

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { state } = useApp();
  if (!state.token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  const { state } = useApp();
  const isLoggedIn = !!state.token;

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
