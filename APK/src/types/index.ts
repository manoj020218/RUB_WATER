// ── Auth ─────────────────────────────────────────────────────────────────────
export interface User {
  id: string;
  loginId: string;
  name: string;
  role: string;
  assignedLocations?: string[];
}

export interface Session {
  token: string;
  refreshToken?: string;
  expiresAt?: string;
}

// ── Location / Device ─────────────────────────────────────────────────────────
export interface Location {
  id: string;
  location_id: string;
  location_name: string;
  description?: string;
  mount_height_mm?: number;
  device_id?: string;
  device_status?: string;
  lifecycle_status?: string;
  lifecycle_note?: string;
  lifecycle_updated_at?: string;
}

export interface DeviceConfig {
  device_id: string;
  location_id?: string;
  alert_level_mm?: number;
  danger_level_mm?: number;
  clear_level_mm?: number;
  trigger_delay_s?: number;
  clear_delay_s?: number;
  sensor_mount_height_mm?: number;
  rs485_enabled?: boolean;
  switch_enabled?: boolean;
  switch_level_1_mm?: number;
  switch_level_2_mm?: number;
  version?: number;
  last_ack_at?: string;
  reported_at?: string;
}

// ── Telemetry ─────────────────────────────────────────────────────────────────
export interface RtuStatus {
  online: boolean;
  batt: 'OK' | 'LOW' | '--';
  siren: boolean;
  flash: boolean;
  voice: boolean;
}

export interface Telemetry {
  device_id?: string;
  water_level_mm?: number;
  distance_mm?: number;
  sensor_valid?: boolean;
  sensor_detected?: boolean;
  flood_state?: string;
  l1_active?: boolean;
  l2_active?: boolean;
  relay_siren?: boolean;
  relay_flash?: boolean;
  relay_pump?: boolean;
  battery_v?: number | string;
  battery_ma?: number | string;
  batt_low?: boolean;
  rssi?: number;
  uptime_ms?: number;
  firmware?: string;
  remote_left?: RtuStatus;
  remote_right?: RtuStatus;
  ts?: string;
  received_at?: string;
}

export interface Incident {
  id?: string;
  location_id?: string;
  started_at?: string;
  flood_state?: string;
  water_level_mm?: number;
  muted?: boolean;
  muted_at?: string;
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
export interface DashboardData {
  location?: Location;
  device?: { id: string; status: string; lifecycle_status?: string; lifecycle_note?: string; lifecycle_updated_at?: string };
  latest?: Telemetry;
  heartbeat?: { received_at?: string };
  config?: DeviceConfig;
  incident?: Incident | null;
  auditLogs?: AuditLog[];
}

// ── Audit ─────────────────────────────────────────────────────────────────────
export interface AuditLog {
  id?: string;
  event_type?: string;
  location_id?: string;
  device_id?: string;
  user_id?: string;
  created_at?: string;
  details?: Record<string, unknown>;
}

// ── Complaint ─────────────────────────────────────────────────────────────────
export interface Complaint {
  id: string;
  location_id?: string;
  complaint_type?: string;
  priority?: string;
  description?: string;
  status?: string;
  created_at?: string;
  resolved_at?: string;
  created_by?: string;
}

// ── Admin user ────────────────────────────────────────────────────────────────
export interface AdminUser {
  id: string;
  login_id: string;
  name: string;
  role: string;
  is_active: boolean;
  assigned_locations?: string[];
  created_at?: string;
}

// ── Report ────────────────────────────────────────────────────────────────────
export interface ReportRow {
  event_type?: string;
  location_id?: string;
  device_id?: string;
  created_at?: string;
  details?: Record<string, unknown>;
  user_id?: string;
}

// ── App release ───────────────────────────────────────────────────────────────
export interface AppRelease {
  version: string;
  versionCode?: number;
  releasedAt?: string;
  releasedLabel?: string;
  notes?: string[];
  downloadUrl?: string;
  forceUpdate?: boolean;
}

// ── Install / BLE state ───────────────────────────────────────────────────────
export interface WifiNetwork {
  ssid: string;
  rssi?: number;
  secure?: boolean;
}

export interface BleDevice {
  deviceId: string;
  name?: string;
  rssi?: number;
}

export interface WifiDiscoveryResult {
  ip: string;
  device_id?: string;
  product?: string;
  mac?: string;
  firmware?: string;
  wifi_connected?: boolean;
  mqtt_connected?: boolean;
}

export interface InstallState {
  appCloudReachable: boolean;
  deviceCloudReachable: boolean;
  localReachable: boolean;
  localUrl: string;
  localIp: string;
  lastCloudReason: string;
  tokenExpiresAt: string;
  provisionKey: string;
  lastDeviceBatteryVoltage: number | null;
  adcDividerRatio: number;
  adcCalibrationFactor: number;
  pendingBindDeviceId: string;
  bleTargetLocationId: string;
  wifiDiscovery: {
    running: boolean;
    scanned: number;
    total: number;
    networkLabel: string;
    summary: string;
    results: WifiDiscoveryResult[];
  };
}

export interface BleState {
  initialized: boolean;
  scanResults: BleDevice[];
  selectedDeviceId: string;
  connectedDeviceId: string;
  wifiNetworks: WifiNetwork[];
  phoneWifiSsid: string;
  scanTriggered: boolean;
  scanInProgress: boolean;
  provisioningComplete: boolean;
  provisionInProgress: boolean;
}

// ── Global App State ──────────────────────────────────────────────────────────
export interface AppState {
  apiBase: string;
  token: string;
  user: User | null;
  session: Session | null;
  appUpdate: { latest: AppRelease | null; lastCheckedAt: string };
  locations: Location[];
  selectedLocationId: string | null;
  selectedDeviceId: string | null;
  activeIncident: Incident | null;
  latestTelemetry: Telemetry | null;
  deviceConfig: DeviceConfig | null;
  deviceConfigHistory: DeviceConfig[];
  configDeviceId: string | null;
  adminUsers: AdminUser[];
  complaints: Complaint[];
  complaintsLocationId: string | null;
  report: { rows: ReportRow[]; loaded: boolean };
  install: InstallState;
  ble: BleState;
  currentView: string;
}
