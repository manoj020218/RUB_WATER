import { NavLink } from 'react-router-dom';
import { useApp } from '@/context/AppContext';

interface NavItem { to: string; label: string; show?: boolean }

export default function BottomNav() {
  const { canOperate, canViewConfig, canVendorInstall, canUseTransferPipeline, isSuperAdmin, state } = useApp();
  const role = state.user?.role || '';

  const canViewReports = ['VENDOR_SUPER_ADMIN', 'DEPARTMENT_SUPER_ADMIN', 'VENDOR_MONITORING_USER'].includes(role);
  const canViewUsers = ['VENDOR_SUPER_ADMIN', 'DEPARTMENT_SUPER_ADMIN', 'DEPARTMENT_ADMIN'].includes(role);
  const canViewComplaints = canOperate();

  const items: NavItem[] = [
    { to: '/locations', label: 'Locations' },
    { to: '/dashboard', label: 'Live' },
    { to: '/controls', label: 'Controls', show: canOperate() },
    { to: '/install', label: 'Install', show: canVendorInstall() },
    { to: '/config', label: 'Config', show: canViewConfig() },
    { to: '/audit', label: 'Audit' },
    { to: '/complaints', label: 'Complaints', show: canViewComplaints },
    { to: '/users', label: 'Users', show: canViewUsers },
    { to: '/reports', label: 'Reports', show: canViewReports },
    { to: '/transfer', label: 'Transfer', show: canUseTransferPipeline() },
    { to: '/settings', label: 'Settings' },
  ];

  return (
    <nav className="bottom-nav">
      {items.filter((i) => i.show !== false).map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) => `nav-btn${isActive ? ' active' : ''}`}
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
