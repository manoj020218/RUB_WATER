import React, { createContext, useContext, useReducer, useCallback, useRef } from 'react';
import { AppState, User, Session, Location, Telemetry, Incident, DeviceConfig, AdminUser, Complaint, ReportRow, AppRelease, BleDevice, WifiNetwork, WifiDiscoveryResult } from '@/types';
import { STORAGE_KEY } from '@/constants';
import { configureClient, setClientToken, normalizeApiBase } from '@/api/client';
import { refreshToken as apiRefreshToken } from '@/api/auth';

// ── Default state ─────────────────────────────────────────────────────────────
const defaultInstall = {
  appCloudReachable: false,
  deviceCloudReachable: false,
  localReachable: false,
  localUrl: '',
  localIp: '',
  lastCloudReason: '--',
  tokenExpiresAt: '',
  provisionKey: '',
  lastDeviceBatteryVoltage: null,
  adcDividerRatio: 5.0,
  adcCalibrationFactor: 1.0,
  pendingBindDeviceId: '',
  bleTargetLocationId: '',
  wifiDiscovery: { running: false, scanned: 0, total: 0, networkLabel: '', summary: '', results: [] },
};

const defaultBle = {
  initialized: false,
  scanResults: [] as BleDevice[],
  selectedDeviceId: '',
  connectedDeviceId: '',
  wifiNetworks: [] as WifiNetwork[],
  phoneWifiSsid: '',
  scanTriggered: false,
  scanInProgress: false,
  provisioningComplete: false,
  provisionInProgress: false,
};

const initialState: AppState = {
  apiBase: '',
  token: '',
  user: null,
  session: null,
  appUpdate: { latest: null, lastCheckedAt: '' },
  locations: [],
  selectedLocationId: null,
  selectedDeviceId: null,
  activeIncident: null,
  latestTelemetry: null,
  deviceConfig: null,
  deviceConfigHistory: [],
  configDeviceId: null,
  adminUsers: [],
  complaints: [],
  complaintsLocationId: null,
  report: { rows: [], loaded: false },
  install: defaultInstall,
  ble: defaultBle,
  currentView: 'login',
};

// ── Actions ───────────────────────────────────────────────────────────────────
type Action =
  | { type: 'LOGIN'; apiBase: string; token: string; user: User; session: Session }
  | { type: 'LOGOUT' }
  | { type: 'SET_TOKEN'; token: string }
  | { type: 'SET_LOCATIONS'; locations: Location[] }
  | { type: 'SELECT_LOCATION'; locationId: string | null; deviceId: string | null }
  | { type: 'SET_TELEMETRY'; telemetry: Telemetry }
  | { type: 'SET_INCIDENT'; incident: Incident | null }
  | { type: 'SET_DEVICE_CONFIG'; config: DeviceConfig | null }
  | { type: 'SET_DEVICE_CONFIG_HISTORY'; history: DeviceConfig[] }
  | { type: 'SET_CONFIG_DEVICE_ID'; deviceId: string | null }
  | { type: 'SET_ADMIN_USERS'; users: AdminUser[] }
  | { type: 'SET_COMPLAINTS'; complaints: Complaint[]; locationId: string }
  | { type: 'SET_REPORT'; rows: ReportRow[] }
  | { type: 'SET_APP_RELEASE'; latest: AppRelease }
  | { type: 'SET_INSTALL'; patch: Partial<AppState['install']> }
  | { type: 'SET_BLE'; patch: Partial<AppState['ble']> }
  | { type: 'SET_VIEW'; view: string }
  | { type: 'SET_WIFI_DISCOVERY'; patch: Partial<AppState['install']['wifiDiscovery']> };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'LOGIN':
      return { ...state, apiBase: action.apiBase, token: action.token, user: action.user, session: action.session };
    case 'LOGOUT':
      return { ...initialState };
    case 'SET_TOKEN':
      return { ...state, token: action.token };
    case 'SET_LOCATIONS':
      return { ...state, locations: action.locations };
    case 'SELECT_LOCATION':
      return { ...state, selectedLocationId: action.locationId, selectedDeviceId: action.deviceId };
    case 'SET_TELEMETRY':
      return { ...state, latestTelemetry: action.telemetry };
    case 'SET_INCIDENT':
      return { ...state, activeIncident: action.incident };
    case 'SET_DEVICE_CONFIG':
      return { ...state, deviceConfig: action.config };
    case 'SET_DEVICE_CONFIG_HISTORY':
      return { ...state, deviceConfigHistory: action.history };
    case 'SET_CONFIG_DEVICE_ID':
      return { ...state, configDeviceId: action.deviceId };
    case 'SET_ADMIN_USERS':
      return { ...state, adminUsers: action.users };
    case 'SET_COMPLAINTS':
      return { ...state, complaints: action.complaints, complaintsLocationId: action.locationId };
    case 'SET_REPORT':
      return { ...state, report: { rows: action.rows, loaded: true } };
    case 'SET_APP_RELEASE':
      return { ...state, appUpdate: { latest: action.latest, lastCheckedAt: new Date().toISOString() } };
    case 'SET_INSTALL':
      return { ...state, install: { ...state.install, ...action.patch } };
    case 'SET_BLE':
      return { ...state, ble: { ...state.ble, ...action.patch } };
    case 'SET_VIEW':
      return { ...state, currentView: action.view };
    case 'SET_WIFI_DISCOVERY':
      return { ...state, install: { ...state.install, wifiDiscovery: { ...state.install.wifiDiscovery, ...action.patch } } };
    default:
      return state;
  }
}

// ── Context ───────────────────────────────────────────────────────────────────
interface AppContextValue {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  logout: () => void;
  isSuperAdmin: () => boolean;
  isDemoSuperAdmin: () => boolean;
  canOperate: () => boolean;
  canViewConfig: () => boolean;
  canEditConfig: () => boolean;
  canVendorInstall: () => boolean;
  canUseTransferPipeline: () => boolean;
  isNativeApp: () => boolean;
  selectedLocation: () => Location | undefined;
  showToast: (message: string, isError?: boolean) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState, (init) => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return init;
      const saved = JSON.parse(raw) as Partial<AppState>;
      if (!saved.token || !saved.user) return init;
      return { ...init, ...saved, ble: defaultBle, install: defaultInstall };
    } catch (_) {
      return init;
    }
  });

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string, isError = false) => {
    const el = document.getElementById('fg-toast');
    if (!el) return;
    el.textContent = message;
    el.style.background = isError ? 'rgba(127,29,29,0.98)' : 'rgba(15,23,42,0.96)';
    el.style.display = 'block';
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => { if (el) el.style.display = 'none'; }, 3200);
  }, []);

  // Keep client configured when state changes
  React.useEffect(() => {
    if (state.apiBase && state.token) {
      configureClient({
        apiBase: state.apiBase,
        token: state.token,
        onUnauthorized: () => dispatch({ type: 'LOGOUT' }),
        silentRefresh: async () => {
          if (!state.session?.refreshToken) return null;
          try {
            const r = await apiRefreshToken(state.session.refreshToken);
            dispatch({ type: 'SET_TOKEN', token: r.token });
            setClientToken(r.token);
            return r.token;
          } catch (_) {
            return null;
          }
        },
      });
    }
  }, [state.apiBase, state.token, state.session]);

  // Persist auth to localStorage
  React.useEffect(() => {
    if (state.token && state.user) {
      const toSave = {
        apiBase: state.apiBase,
        token: state.token,
        user: state.user,
        session: state.session,
        selectedLocationId: state.selectedLocationId,
        selectedDeviceId: state.selectedDeviceId,
        install: { localUrl: state.install.localUrl, localIp: state.install.localIp },
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [state.token, state.user, state.apiBase, state.session, state.selectedLocationId, state.selectedDeviceId, state.install.localUrl, state.install.localIp]);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    dispatch({ type: 'LOGOUT' });
  }, []);

  const userRole = () => state.user?.role || '';
  const isSuperAdmin = () => ['VENDOR_SUPER_ADMIN', 'DEPARTMENT_SUPER_ADMIN'].includes(userRole());
  const isDemoSuperAdmin = () => state.user?.loginId === 'demo';
  const canOperate = () => ['VENDOR_SUPER_ADMIN', 'DEPARTMENT_SUPER_ADMIN', 'DEPARTMENT_ADMIN', 'LOCATION_ADMIN', 'OPERATOR', 'VENDOR_MONITORING_USER'].includes(userRole());
  const canViewConfig = () => ['VENDOR_SUPER_ADMIN', 'DEPARTMENT_SUPER_ADMIN', 'DEPARTMENT_ADMIN', 'LOCATION_ADMIN', 'VENDOR_MONITORING_USER'].includes(userRole());
  const canEditConfig = () => ['VENDOR_SUPER_ADMIN', 'DEPARTMENT_SUPER_ADMIN', 'DEPARTMENT_ADMIN', 'VENDOR_MONITORING_USER'].includes(userRole());
  const canVendorInstall = () => ['VENDOR_SUPER_ADMIN', 'VENDOR_MONITORING_USER'].includes(userRole());
  const canUseTransferPipeline = () => userRole() === 'VENDOR_SUPER_ADMIN';
  const isNativeApp = () => !!(window as unknown as Record<string, unknown>).Capacitor;
  const selectedLocation = () => state.locations.find((l) => l.location_id === state.selectedLocationId || l.id === state.selectedLocationId);

  return (
    <AppContext.Provider value={{ state, dispatch, logout, isSuperAdmin, isDemoSuperAdmin, canOperate, canViewConfig, canEditConfig, canVendorInstall, canUseTransferPipeline, isNativeApp, selectedLocation, showToast }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
