(function () {
  const STORAGE_KEY = 'fg_mobile_session_v1';
  const REFRESH_INTERVAL_MS = 10000;
  const REQUEST_TIMEOUT_MS = 12000;
  const IST_TIMEZONE = 'Asia/Kolkata';
  const BLE_SERVICE_UUID = '0000ff00-0000-1000-8000-00805f9b34fb';
  const BLE_CHARACTERISTIC_UUID = '0000ff01-0000-1000-8000-00805f9b34fb';
  const BLE_NAME_PREFIX = 'JNX-FG';

  const state = {
    apiBase: '',
    token: '',
    user: null,
    session: null,
    locations: [],
    selectedLocationId: null,
    selectedDeviceId: null,
    activeIncident: null,
    adminUsers: [],
    refreshTimer: null,
    incidentTimer: null,
    loading: false,
    ble: {
      initialized: false,
      scanResults: [],
      selectedDeviceId: '',
      connectedDeviceId: '',
      wifiNetworks: []
    }
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function setText(id, text) {
    const el = byId(id);
    if (el) {
      el.textContent = text;
    }
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeApiBase(value) {
    let next = String(value || '').trim();
    if (!next) {
      next = 'https://api.floodguard.iotsoft.in/api';
    }

    if (!/^https?:\/\//i.test(next) && next[0] !== '/') {
      next = `https://${next}`;
    }
    next = next.replace(/\/+$/, '');
    if (!/\/api$/i.test(next)) {
      next = `${next}/api`;
    }
    return next;
  }

  function showToast(message, isError = false) {
    const toast = byId('toast');
    if (!toast) {
      return;
    }

    toast.style.display = 'block';
    toast.textContent = message;
    toast.style.background = isError ? 'rgba(127, 29, 29, 0.98)' : 'rgba(15, 23, 42, 0.96)';
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => {
      toast.style.display = 'none';
    }, 3200);
  }

  function saveSession() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        apiBase: state.apiBase,
        token: state.token,
        user: state.user,
        session: state.session
      }));
    } catch (error) {
      // ignore
    }
  }

  function loadSession() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function clearSession() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      // ignore
    }
  }

  function setLoggedInUi(isLoggedIn) {
    byId('logout-btn').style.display = isLoggedIn ? 'inline-block' : 'none';
    byId('bottom-nav').style.display = isLoggedIn ? 'grid' : 'none';
  }

  function openView(viewId) {
    if (viewId === 'view-install' && !canVendorInstall()) {
      showToast('Vendor install tools are available only for vendor logins.', true);
      return;
    }

    document.querySelectorAll('.view').forEach((view) => {
      view.classList.toggle('active', view.id === viewId);
    });

    document.querySelectorAll('.nav-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.view === viewId);
    });

    if (viewId === 'view-install') {
      refreshVendorInstallStatus().catch(() => {
        // handled internally
      });
    }
  }

  function formatTime(iso) {
    if (!iso) {
      return '--';
    }
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) {
      return '--';
    }
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: IST_TIMEZONE,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(dt);
  }

  function formatDateTime(iso) {
    if (!iso) {
      return '--';
    }
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) {
      return '--';
    }
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: IST_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(dt);
  }

  function statusMeta(rawStatus) {
    const status = String(rawStatus || 'OFFLINE').toUpperCase();
    if (status.includes('DANGER')) {
      return { label: 'DANGER', cls: 'danger' };
    }
    if (status.includes('ALERT') || status.includes('WATER_DETECTED') || status.includes('CLEAR_PENDING')) {
      return { label: 'ALERT', cls: 'warn' };
    }
    if (status.includes('OFFLINE') || status.includes('FAULT')) {
      return { label: 'OFFLINE', cls: 'off' };
    }
    return { label: 'NORMAL', cls: 'ok' };
  }

  function requestUrl(path) {
    const base = state.apiBase || normalizeApiBase('');
    if (/^https?:\/\//i.test(path)) {
      return path;
    }
    if (path.startsWith('/')) {
      return `${base}${path}`;
    }
    return `${base}/${path}`;
  }

  async function apiRequest(path, options = {}) {
    const {
      method = 'GET',
      body,
      auth = true
    } = options;

    const headers = {
      'content-type': 'application/json'
    };
    if (auth && state.token) {
      headers.authorization = `Bearer ${state.token}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(requestUrl(path), {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    const raw = await response.text();
    let parsed = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch (error) {
      parsed = null;
    }

    if (!response.ok || !parsed || parsed.ok !== true) {
      const err = new Error(parsed?.error?.message || parsed?.message || raw || `HTTP ${response.status}`);
      err.status = response.status;
      throw err;
    }

    return parsed.data;
  }

  function handleApiError(error, fallbackMessage) {
    if (error?.status === 401) {
      logoutApp(true, 'Access revoked by super admin or session expired. Please login again.');
      return;
    }
    if (/failed to fetch/i.test(String(error?.message || ''))) {
      showToast(
        `Cannot reach API. Check API Base URL and backend availability. Current: ${state.apiBase || 'not set'}`,
        true
      );
      setText(
        'login-error',
        `Cannot reach API (${state.apiBase || 'not set'}). If testing on USB phone, use adb reverse and keep backend running on port 4080.`
      );
      return;
    }
    showToast(`${fallbackMessage}: ${error.message}`, true);
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function getBlePlugin() {
    return window?.Capacitor?.Plugins?.BluetoothLe || null;
  }

  function textToHex(input) {
    return Array.from(new TextEncoder().encode(String(input || '')))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join(' ');
  }

  function hexToText(input) {
    if (!input) {
      return '';
    }

    if (typeof input !== 'string') {
      if (input instanceof DataView) {
        return new TextDecoder().decode(new Uint8Array(input.buffer, input.byteOffset, input.byteLength));
      }
      return String(input);
    }

    const clean = input.replace(/[^0-9a-fA-F]/g, '');
    const bytes = [];
    for (let i = 0; i < clean.length; i += 2) {
      const pair = clean.slice(i, i + 2);
      if (pair.length === 2) {
        bytes.push(parseInt(pair, 16));
      }
    }
    return new TextDecoder().decode(Uint8Array.from(bytes));
  }

  function prettyJson(data) {
    try {
      return JSON.stringify(data, null, 2);
    } catch (error) {
      return String(data ?? '');
    }
  }

  function normalizeDeviceName(scanResult) {
    return scanResult?.localName || scanResult?.device?.name || scanResult?.device?.deviceId || 'Unknown';
  }

  async function ensureBleReady() {
    const ble = getBlePlugin();
    if (!ble) {
      throw new Error('Bluetooth LE plugin not available in this build.');
    }

    if (!state.ble.initialized) {
      await ble.initialize({ androidNeverForLocation: false });
      state.ble.initialized = true;
    }

    const enabled = await ble.isEnabled();
    if (!enabled?.value) {
      await ble.requestEnable();
    }

    return ble;
  }

  function findSelectedBleDevice() {
    return state.ble.scanResults.find((item) => item.deviceId === state.ble.selectedDeviceId) || null;
  }

  function renderBleDeviceList() {
    const list = byId('ble-device-list');
    if (!list) {
      return;
    }

    if (!Array.isArray(state.ble.scanResults) || state.ble.scanResults.length === 0) {
      list.innerHTML = '<div class="empty">No BLE devices found yet.</div>';
      return;
    }

    list.innerHTML = state.ble.scanResults.map((device) => {
      const selected = state.ble.selectedDeviceId === device.deviceId;
      const connected = state.ble.connectedDeviceId === device.deviceId;
      return `
        <div class="ble-device-row">
          <div class="ble-device-name">${escapeHtml(device.name || 'Unknown')} ${selected ? '• Selected' : ''}</div>
          <div class="ble-device-meta">${escapeHtml(device.deviceId)} · RSSI ${escapeHtml(String(device.rssi ?? '--'))}</div>
          <div class="row" style="margin-top:8px;justify-content:flex-end">
            <button class="ghost-btn" style="padding:6px 10px" onclick="selectBleDeviceApp('${escapeHtml(device.deviceId)}')">
              ${selected ? 'Selected' : 'Use Device'}
            </button>
            ${connected ? '<span class="chip">CONNECTED</span>' : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  function renderBleWifiList() {
    const list = byId('ble-wifi-list');
    if (!list) {
      return;
    }

    if (!Array.isArray(state.ble.wifiNetworks) || state.ble.wifiNetworks.length === 0) {
      list.innerHTML = '<div class="empty">No Wi-Fi network list available.</div>';
      return;
    }

    list.innerHTML = state.ble.wifiNetworks.map((network) => `
      <div class="ble-wifi-row">
        <div class="ble-wifi-name">${escapeHtml(network.ssid || '--')}</div>
        <div class="ble-wifi-meta">RSSI ${escapeHtml(String(network.rssi ?? '--'))} · ${escapeHtml(network.auth || 'UNKNOWN')} · CH ${escapeHtml(String(network.channel ?? '--'))}</div>
        <div class="row" style="margin-top:8px;justify-content:flex-end">
          <button class="ghost-btn" style="padding:6px 10px" onclick="pickBleWifiSsidApp('${escapeHtml(network.ssid || '')}')">Use SSID</button>
        </div>
      </div>
    `).join('');
  }

  function setBleOutputs(healthText, provisionText) {
    if (byId('ble-health-output') && typeof healthText === 'string') {
      byId('ble-health-output').textContent = healthText;
    }
    if (byId('ble-provision-output') && typeof provisionText === 'string') {
      byId('ble-provision-output').textContent = provisionText;
    }
  }

  async function checkAppVpsHealth() {
    const statusEl = byId('ble-app-vps-status');
    if (!statusEl || !canVendorInstall()) {
      return;
    }

    const healthUrl = defaultVpsHealthUrl();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(healthUrl, { signal: controller.signal });
      clearTimeout(timeout);
      statusEl.textContent = res.ok ? `UP (${res.status})` : `DOWN (${res.status})`;
      statusEl.style.color = res.ok ? '#059669' : '#b91c1c';
    } catch (error) {
      statusEl.textContent = 'DOWN';
      statusEl.style.color = '#b91c1c';
    }
  }

  async function ensureBleConnected() {
    const ble = await ensureBleReady();
    const selected = findSelectedBleDevice();
    if (!selected) {
      throw new Error('Select BLE device first.');
    }

    if (state.ble.connectedDeviceId !== selected.deviceId) {
      await ble.connect({ deviceId: selected.deviceId, timeout: 12000 });
      state.ble.connectedDeviceId = selected.deviceId;
      await ble.discoverServices({ deviceId: selected.deviceId, timeout: 10000 });
      setText('ble-link-status', `CONNECTED (${selected.name || selected.deviceId})`);
    }

    return {
      ble,
      device: selected
    };
  }

  async function bleSendCommand(command) {
    const { ble, device } = await ensureBleConnected();
    const payload = JSON.stringify(command || {});

    await ble.write({
      deviceId: device.deviceId,
      service: BLE_SERVICE_UUID,
      characteristic: BLE_CHARACTERISTIC_UUID,
      value: textToHex(payload),
      timeout: 10000
    });

    await delay(350);
    const read = await ble.read({
      deviceId: device.deviceId,
      service: BLE_SERVICE_UUID,
      characteristic: BLE_CHARACTERISTIC_UUID,
      timeout: 10000
    });

    const text = hexToText(read?.value || '');
    if (!text) {
      throw new Error('Empty response from device over BLE.');
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new Error(`Invalid BLE response: ${text}`);
    }

    if (parsed?.ok !== true) {
      throw new Error(parsed?.error || 'Device returned error');
    }
    return parsed;
  }

  function updateVpsUrlInput() {
    if (byId('ble-vps-url') && !String(byId('ble-vps-url').value || '').trim()) {
      byId('ble-vps-url').value = defaultVpsHealthUrl();
    }
  }

  async function refreshVendorInstallStatus() {
    if (!canVendorInstall()) {
      return;
    }
    updateVpsUrlInput();
    await checkAppVpsHealth();
    renderBleDeviceList();
    renderBleWifiList();
  }

  function isSuperAdmin() {
    const role = String(state.user?.role || '').toUpperCase();
    return role === 'VENDOR_SUPER_ADMIN' || role === 'DEPARTMENT_SUPER_ADMIN';
  }

  function canVendorInstall() {
    const role = String(state.user?.role || '').toUpperCase();
    return role === 'VENDOR_SUPER_ADMIN' || role === 'VENDOR_MONITORING_USER';
  }

  function rootUrlFromApiBase() {
    const base = state.apiBase || normalizeApiBase('');
    return base.replace(/\/api$/i, '');
  }

  function defaultVpsHealthUrl() {
    return `${rootUrlFromApiBase()}/health`;
  }

  function applyAdminPanelVisibility() {
    const panel = byId('mobile-user-admin-panel');
    if (!panel) {
      return;
    }
    panel.style.display = isSuperAdmin() ? 'block' : 'none';
  }

  function applyVendorInstallVisibility() {
    const tab = byId('vendor-install-tab');
    const nav = byId('bottom-nav');
    const installView = byId('view-install');
    const roleChip = byId('ble-role-chip');
    const enabled = canVendorInstall();

    if (tab) {
      tab.style.display = enabled ? 'inline-block' : 'none';
    }
    if (nav) {
      nav.style.setProperty('--nav-count', enabled ? '5' : '4');
    }
    if (installView) {
      installView.style.display = enabled ? '' : 'none';
    }
    if (roleChip) {
      roleChip.textContent = enabled ? String(state.user?.role || 'VENDOR') : 'LOCKED';
      roleChip.classList.toggle('danger', !enabled);
    }

    if (!enabled) {
      state.ble.scanResults = [];
      state.ble.selectedDeviceId = '';
      state.ble.wifiNetworks = [];
      renderBleDeviceList();
      renderBleWifiList();
      setText('ble-selected-device', 'Selected: --');
      setText('ble-link-status', 'DISCONNECTED');
    }
  }

  function renderLocations() {
    const list = byId('location-list');
    if (!list) {
      return;
    }

    setText('location-count', `${state.locations.length} sites`);

    if (state.locations.length === 0) {
      list.innerHTML = '<div class="empty">No locations assigned for this login.</div>';
      return;
    }

    list.innerHTML = state.locations.map((loc) => {
      const meta = statusMeta(loc.status);
      const selected = loc.location_id === state.selectedLocationId;
      const level = Number.isFinite(loc.water_level_mm) ? Math.round(loc.water_level_mm) : '--';
      return `
        <button class="loc-card ${selected ? 'sel' : ''}" onclick="selectLocation('${escapeHtml(loc.location_id)}')">
          <div class="loc-top">
            <div>
              <div class="loc-name">${escapeHtml(loc.location_name || loc.location_id)}</div>
              <div class="loc-id">${escapeHtml(loc.location_id)}</div>
            </div>
            <span class="chip ${meta.cls === 'danger' ? 'danger' : ''}">${escapeHtml(meta.label)}</span>
          </div>
          <div class="loc-level">${escapeHtml(String(level))} mm</div>
          <div class="loc-meta">${escapeHtml(String(loc.device_status || 'UNKNOWN'))} · Updated ${escapeHtml(formatTime(loc.last_update))}</div>
        </button>
      `;
    }).join('');
  }

  function startIncidentTimer(incident) {
    if (state.incidentTimer) {
      clearInterval(state.incidentTimer);
      state.incidentTimer = null;
    }

    if (!incident || incident.status !== 'ACTIVE' || !incident.started_at) {
      setText('dash-incident', 'Incident: --:--:--');
      return;
    }

    const tick = () => {
      const start = new Date(incident.started_at);
      const elapsed = Math.max(0, Math.floor((Date.now() - start.getTime()) / 1000));
      const hh = String(Math.floor(elapsed / 3600)).padStart(2, '0');
      const mm = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
      const ss = String(elapsed % 60).padStart(2, '0');
      setText('dash-incident', `Incident: ${hh}:${mm}:${ss}`);
    };

    tick();
    state.incidentTimer = setInterval(tick, 1000);
  }

  function renderDashboard(location, dashboardData, incident) {
    const latest = dashboardData?.latest || null;
    const meta = statusMeta(latest?.status || location?.status || 'OFFLINE');
    const waterLevel = Number.isFinite(latest?.water_level_mm) ? Math.round(latest.water_level_mm) : 0;
    const distance = Number.isFinite(latest?.distance_mm) ? Math.round(latest.distance_mm) : 0;
    const mountHeight = Number(dashboardData?.location?.sensor_mount_height_mm || 1200);
    const fillPercent = Math.max(0, Math.min(100, (waterLevel / mountHeight) * 100));

    setText('dash-location-name', location?.location_name || location?.location_id || '--');
    setText('dash-location-sub', `Device: ${location?.device_id || '--'} · Last update ${formatDateTime(latest?.timestamp || location?.last_update)}`);

    const badge = byId('dash-status-badge');
    if (badge) {
      badge.textContent = meta.label;
      badge.classList.toggle('danger', meta.cls === 'danger');
    }

    setText('dash-water-level', String(waterLevel));
    setText('dash-distance', `Distance: ${distance} mm`);
    setText('dash-battery', Number.isFinite(latest?.battery_voltage) ? `${latest.battery_voltage.toFixed(1)}V` : '--');
    setText('dash-solar', Number.isFinite(latest?.solar_voltage) ? `${latest.solar_voltage.toFixed(1)}V` : '--');
    setText('dash-rssi', Number.isFinite(latest?.wifi_rssi) ? `${Math.round(latest.wifi_rssi)} dBm` : '--');
    setText('dash-heartbeat', String(location?.device_status || 'UNKNOWN').toUpperCase());
    setText('control-user-role', `Logged in as: ${state.user?.name || state.user?.login_id || '--'} (${state.user?.role || 'UNKNOWN'})`);
    applyAdminPanelVisibility();
    applyVendorInstallVisibility();

    const fill = byId('vessel-fill');
    if (fill) {
      fill.style.height = `${fillPercent.toFixed(1)}%`;
      fill.style.background = meta.cls === 'danger'
        ? 'linear-gradient(0deg,#b91c1c,#ef4444)'
        : meta.cls === 'warn'
          ? 'linear-gradient(0deg,#b45309,#f59e0b)'
          : 'linear-gradient(0deg,#047857,#34d399)';
    }

    state.activeIncident = incident;
    startIncidentTimer(incident);
  }

  function renderAudit(logs) {
    const list = byId('audit-list');
    if (!list) {
      return;
    }

    if (!Array.isArray(logs) || logs.length === 0) {
      list.innerHTML = '<div class="empty">No logs available.</div>';
      return;
    }

    list.innerHTML = logs.slice(0, 20).map((log) => {
      const details = [];
      if (log.details?.reason) {
        details.push(`Reason: ${log.details.reason}`);
      }
      if (log.details?.command_id) {
        details.push(`Command: ${log.details.command_id}`);
      }
      return `
        <div class="audit-item">
          <div class="audit-event">${escapeHtml(String(log.event_type || 'EVENT').toUpperCase())}</div>
          <div class="audit-detail">${escapeHtml(details.join(' | ') || 'Action logged')}</div>
          <div class="audit-time">${escapeHtml(formatDateTime(log.timestamp))} IST · ${escapeHtml(log.login_id || 'System')}</div>
        </div>
      `;
    }).join('');
  }

  function renderAdminUsersApp(users) {
    const list = byId('mobile-admin-user-list');
    if (!list) {
      return;
    }

    if (!Array.isArray(users) || users.length === 0) {
      list.innerHTML = '<div class="empty">No managed users found.</div>';
      return;
    }

    list.innerHTML = users.map((user) => {
      const isActive = Boolean(user.is_active);
      const statusLabel = isActive ? 'ACTIVE' : 'DEACTIVE';
      return `
        <div class="admin-user-row">
          <div class="admin-user-head">
            <div>
              <div class="admin-user-name">${escapeHtml(user.login_id)} (${escapeHtml(user.role || '--')})</div>
              <div class="admin-user-meta">${escapeHtml(user.name || '--')} · Sessions: ${escapeHtml(String(user.active_session_count ?? 0))}</div>
            </div>
            <span class="chip ${isActive ? '' : 'danger'}">${statusLabel}</span>
          </div>
          <div class="row" style="margin-top:8px;justify-content:flex-end">
            <button class="ghost-btn" style="padding:6px 10px" onclick="toggleAdminUserAccessApp('${escapeHtml(user.user_id)}', ${isActive ? 'false' : 'true'})">
              ${isActive ? 'Set Deactive' : 'Set Active'}
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  async function refreshAdminUsersApp() {
    if (!isSuperAdmin()) {
      return;
    }

    try {
      const users = await apiRequest('/admin/users', { auth: true });
      state.adminUsers = Array.isArray(users) ? users : [];
      renderAdminUsersApp(state.adminUsers);
    } catch (error) {
      handleApiError(error, 'Failed loading user list');
    }
  }

  async function createAdminUserApp() {
    if (!isSuperAdmin()) {
      showToast('Only super admin can create users.', true);
      return;
    }

    const loginId = String(byId('mobile-ua-login-id')?.value || '').trim();
    const name = String(byId('mobile-ua-name')?.value || '').trim();
    const password = String(byId('mobile-ua-password')?.value || '').trim();
    const role = String(byId('mobile-ua-role')?.value || 'OPERATOR').trim().toUpperCase();
    const activeMode = String(byId('mobile-ua-active-mode')?.value || 'active').trim().toLowerCase();
    const isActive = activeMode !== 'deactive';
    const assignedRaw = String(byId('mobile-ua-assigned-locations')?.value || '').trim();
    const assigned = assignedRaw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    if (!loginId || !name || !password) {
      showToast('login_id, name and password are required.', true);
      return;
    }

    try {
      await apiRequest('/admin/users', {
        method: 'POST',
        body: {
          login_id: loginId,
          name,
          password,
          role,
          assigned_location_ids: assigned,
          is_active: isActive
        }
      });

      if (byId('mobile-ua-password')) {
        byId('mobile-ua-password').value = '';
      }
      showToast(`User ${loginId} created (${isActive ? 'active' : 'deactive'}).`);
      await refreshAdminUsersApp();
    } catch (error) {
      handleApiError(error, 'Create user failed');
    }
  }

  async function toggleAdminUserAccessApp(userId, shouldActivate) {
    if (!isSuperAdmin()) {
      showToast('Only super admin can manage users.', true);
      return;
    }

    const isActive = Boolean(shouldActivate);
    let reason = '';
    if (!isActive) {
      reason = String(window.prompt('Reason to set deactive (min 5 chars):', '') || '').trim();
      if (reason.length < 5) {
        showToast('Reason required (min 5 chars).', true);
        return;
      }
    }

    try {
      await apiRequest(`/admin/users/${encodeURIComponent(userId)}/access`, {
        method: 'PATCH',
        body: {
          is_active: isActive,
          reason
        }
      });
      showToast(isActive ? 'User set active.' : 'User set deactive.');
      await refreshAdminUsersApp();
    } catch (error) {
      handleApiError(error, 'Update user status failed');
    }
  }

  function selectBleDeviceApp(deviceId) {
    state.ble.selectedDeviceId = String(deviceId || '');
    const selected = findSelectedBleDevice();
    setText('ble-selected-device', selected ? `Selected: ${selected.name || selected.deviceId}` : 'Selected: --');
    renderBleDeviceList();
  }

  function pickBleWifiSsidApp(ssid) {
    if (byId('ble-wifi-ssid')) {
      byId('ble-wifi-ssid').value = String(ssid || '');
    }
  }

  async function bleScanDevicesApp() {
    if (!canVendorInstall()) {
      showToast('Vendor login is required for BLE provisioning.', true);
      return;
    }

    try {
      const ble = await ensureBleReady();
      const discovered = new Map();
      const listener = await ble.addListener('onScanResult', (result) => {
        const deviceId = String(result?.device?.deviceId || '').trim();
        if (!deviceId) {
          return;
        }
        const name = String(normalizeDeviceName(result) || '').trim();
        if (!name.toUpperCase().startsWith(BLE_NAME_PREFIX)) {
          return;
        }
        discovered.set(deviceId, {
          deviceId,
          name,
          rssi: Number.isFinite(result?.rssi) ? Math.round(result.rssi) : null
        });
      });

      setText('ble-link-status', 'SCANNING...');
      await ble.requestLEScan({
        namePrefix: BLE_NAME_PREFIX,
        allowDuplicates: false
      });
      await delay(7000);
      await ble.stopLEScan();
      await listener.remove();

      state.ble.scanResults = Array.from(discovered.values()).sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999));
      if (!state.ble.scanResults.some((item) => item.deviceId === state.ble.selectedDeviceId)) {
        state.ble.selectedDeviceId = state.ble.scanResults[0]?.deviceId || '';
      }

      const selected = findSelectedBleDevice();
      setText('ble-selected-device', selected ? `Selected: ${selected.name || selected.deviceId}` : 'Selected: --');
      setText('ble-link-status', state.ble.connectedDeviceId ? 'CONNECTED' : 'DISCONNECTED');
      renderBleDeviceList();
      showToast(state.ble.scanResults.length > 0 ? `Found ${state.ble.scanResults.length} BLE device(s).` : 'No BLE device found.');
    } catch (error) {
      setText('ble-link-status', 'SCAN FAILED');
      showToast(`BLE scan failed: ${error.message}`, true);
    }
  }

  async function bleDisconnectApp() {
    const deviceId = state.ble.connectedDeviceId;
    if (!deviceId) {
      setText('ble-link-status', 'DISCONNECTED');
      return;
    }

    try {
      const ble = await ensureBleReady();
      await ble.disconnect({ deviceId, timeout: 6000 });
    } catch (error) {
      // best effort
    } finally {
      state.ble.connectedDeviceId = '';
      setText('ble-link-status', 'DISCONNECTED');
      renderBleDeviceList();
    }
  }

  async function bleReadHealthApp() {
    if (!canVendorInstall()) {
      showToast('Vendor login is required for BLE provisioning.', true);
      return;
    }

    try {
      updateVpsUrlInput();
      const vpsUrl = String(byId('ble-vps-url')?.value || '').trim() || defaultVpsHealthUrl();
      const response = await bleSendCommand({
        cmd: 'health',
        vps_url: vpsUrl,
        check_vps: true
      });
      setBleOutputs(prettyJson(response), null);
      setText('ble-link-status', 'CONNECTED');
      showToast('Device health received.');
    } catch (error) {
      setBleOutputs(`Error: ${error.message}`, null);
      showToast(`Health read failed: ${error.message}`, true);
    }
  }

  async function bleScanWifiApp() {
    if (!canVendorInstall()) {
      showToast('Vendor login is required for BLE provisioning.', true);
      return;
    }

    try {
      const response = await bleSendCommand({ cmd: 'scan_wifi' });
      state.ble.wifiNetworks = Array.isArray(response.networks) ? response.networks : [];
      if (state.ble.wifiNetworks[0]?.ssid && byId('ble-wifi-ssid') && !byId('ble-wifi-ssid').value) {
        byId('ble-wifi-ssid').value = state.ble.wifiNetworks[0].ssid;
      }
      renderBleWifiList();
      showToast(`Wi-Fi scan complete (${state.ble.wifiNetworks.length} network(s)).`);
    } catch (error) {
      showToast(`Wi-Fi scan failed: ${error.message}`, true);
    }
  }

  async function bleProvisionWifiApp() {
    if (!canVendorInstall()) {
      showToast('Vendor login is required for BLE provisioning.', true);
      return;
    }

    const ssid = String(byId('ble-wifi-ssid')?.value || '').trim();
    const password = String(byId('ble-wifi-password')?.value || '');
    const vpsUrl = String(byId('ble-vps-url')?.value || '').trim() || defaultVpsHealthUrl();

    if (!ssid) {
      showToast('SSID is required for provisioning.', true);
      return;
    }

    try {
      const response = await bleSendCommand({
        cmd: 'set_wifi',
        ssid,
        password,
        vps_url: vpsUrl,
        check_vps: true
      });
      setBleOutputs(null, prettyJson(response));
      setText('ble-link-status', 'CONNECTED');
      showToast('Wi-Fi provision command completed.');
      await checkAppVpsHealth();
    } catch (error) {
      setBleOutputs(null, `Error: ${error.message}`);
      showToast(`Provisioning failed: ${error.message}`, true);
    }
  }

  async function fetchLocations() {
    const locations = await apiRequest('/locations', { auth: true });
    state.locations = Array.isArray(locations) ? locations : [];

    if (!state.selectedLocationId || !state.locations.some((item) => item.location_id === state.selectedLocationId)) {
      const first = state.locations[0];
      state.selectedLocationId = first?.location_id || null;
      state.selectedDeviceId = first?.device_id || null;
    }
  }

  async function fetchLocationDetails(locationId) {
    const [dashboardData, incidents, auditLogs] = await Promise.all([
      apiRequest(`/locations/${encodeURIComponent(locationId)}/dashboard`, { auth: true }),
      apiRequest(`/incidents?location_id=${encodeURIComponent(locationId)}`, { auth: true }),
      apiRequest(`/audit-logs?location_id=${encodeURIComponent(locationId)}`, { auth: true })
    ]);

    return {
      dashboardData,
      incidents: Array.isArray(incidents) ? incidents : [],
      auditLogs: Array.isArray(auditLogs) ? auditLogs : []
    };
  }

  async function refreshAppData() {
    if (state.loading || !state.token) {
      return;
    }

    state.loading = true;
    try {
      await fetchLocations();
      renderLocations();

      if (!state.selectedLocationId) {
        return;
      }

      const selectedLocation = state.locations.find((item) => item.location_id === state.selectedLocationId) || null;
      state.selectedDeviceId = selectedLocation?.device_id || null;

      const details = await fetchLocationDetails(state.selectedLocationId);
      const activeIncident = details.incidents.find((item) => item.status === 'ACTIVE') || null;

      renderDashboard(selectedLocation, details.dashboardData, activeIncident);
      renderAudit(details.auditLogs);
      if (isSuperAdmin()) {
        await refreshAdminUsersApp();
      }
      if (canVendorInstall() && byId('view-install')?.classList.contains('active')) {
        await refreshVendorInstallStatus();
      }
    } catch (error) {
      handleApiError(error, 'Refresh failed');
    } finally {
      state.loading = false;
    }
  }

  function startPolling() {
    if (state.refreshTimer) {
      clearInterval(state.refreshTimer);
    }
    state.refreshTimer = setInterval(() => {
      refreshAppData().catch(() => {
        // handled inside refreshAppData
      });
    }, REFRESH_INTERVAL_MS);
  }

  async function verifySession() {
    if (!state.token) {
      return false;
    }
    try {
      const me = await apiRequest('/auth/me', { auth: true });
      state.user = me.user;
      state.session = me.session;
      saveSession();
      return true;
    } catch (error) {
      return false;
    }
  }

  async function loginApp() {
    const apiBase = normalizeApiBase(byId('login-api-base')?.value || '');
    const loginId = String(byId('login-id')?.value || '').trim();
    const password = String(byId('login-password')?.value || '').trim();

    setText('login-error', '');

    if (!loginId || !password) {
      setText('login-error', 'Login ID and password are required.');
      return;
    }

    state.apiBase = apiBase;

    try {
      const result = await apiRequest('/auth/login', {
        auth: false,
        method: 'POST',
        body: {
          login_id: loginId,
          password,
          app_type: 'ANDROID',
          device_name: `FloodGuard Android (${navigator.userAgent || 'web'})`
        }
      });

      state.token = result.token;
      state.user = result.user;
      state.session = result.session;
      saveSession();

      setLoggedInUi(true);
      openView('view-locations');
      applyAdminPanelVisibility();
      applyVendorInstallVisibility();
      showToast('Login successful');
      await refreshAppData();
      startPolling();
    } catch (error) {
      setText('login-error', `Login failed: ${error.message}`);
    }
  }

  function logoutApp(isAuto = false, message = 'Session cleared. Please login again.') {
    state.token = '';
    state.user = null;
    state.session = null;
    state.locations = [];
    state.selectedLocationId = null;
    state.selectedDeviceId = null;
    state.activeIncident = null;
    state.adminUsers = [];

    if (state.refreshTimer) {
      clearInterval(state.refreshTimer);
      state.refreshTimer = null;
    }
    if (state.incidentTimer) {
      clearInterval(state.incidentTimer);
      state.incidentTimer = null;
    }

    clearSession();
    setLoggedInUi(false);
    openView('view-login');
    applyAdminPanelVisibility();
    applyVendorInstallVisibility();
    renderAdminUsersApp([]);
    showToast(message, isAuto);
  }

  function selectLocation(locationId) {
    state.selectedLocationId = locationId;
    const selected = state.locations.find((item) => item.location_id === locationId) || null;
    state.selectedDeviceId = selected?.device_id || null;
    renderLocations();
    refreshAppData().catch(() => {
      // handled
    });
  }

  async function muteAlarmApp() {
    if (!state.selectedLocationId || !state.selectedDeviceId) {
      showToast('Select a valid location first.', true);
      return;
    }
    try {
      await apiRequest('/commands/mute', {
        method: 'POST',
        body: {
          location_id: state.selectedLocationId,
          device_id: state.selectedDeviceId
        }
      });
      showToast('Mute command submitted.');
      await refreshAppData();
    } catch (error) {
      handleApiError(error, 'Mute failed');
    }
  }

  async function dryRunApp() {
    if (!state.selectedLocationId || !state.selectedDeviceId) {
      showToast('Select a valid location first.', true);
      return;
    }
    try {
      await apiRequest('/commands/dry-run', {
        method: 'POST',
        body: {
          location_id: state.selectedLocationId,
          device_id: state.selectedDeviceId,
          outputs: ['siren', 'beacon', 'voice']
        }
      });
      showToast('Dry run submitted.');
      await refreshAppData();
    } catch (error) {
      handleApiError(error, 'Dry run failed');
    }
  }

  async function forceClearApp() {
    const reason = String(byId('force-clear-reason')?.value || '').trim();
    if (reason.length < 5) {
      showToast('Force clear reason is required (min 5 chars).', true);
      return;
    }
    if (!state.selectedLocationId || !state.selectedDeviceId) {
      showToast('Select a valid location first.', true);
      return;
    }

    try {
      await apiRequest('/commands/force-clear', {
        method: 'POST',
        body: {
          location_id: state.selectedLocationId,
          device_id: state.selectedDeviceId,
          reason
        }
      });

      if (byId('force-clear-reason')) {
        byId('force-clear-reason').value = '';
      }
      showToast('Force clear submitted.');
      await refreshAppData();
    } catch (error) {
      handleApiError(error, 'Force clear failed');
    }
  }

  async function bootstrap() {
    setLoggedInUi(false);
    openView('view-login');
    applyVendorInstallVisibility();

    const saved = loadSession();
    if (saved) {
      state.apiBase = normalizeApiBase(saved.apiBase || '');
      state.token = String(saved.token || '');
      state.user = saved.user || null;
      state.session = saved.session || null;
    }

    if (!state.apiBase) {
      state.apiBase = normalizeApiBase('');
    }
    if (byId('login-api-base')) {
      byId('login-api-base').value = state.apiBase;
    }
    if (byId('login-id') && !byId('login-id').value) {
      byId('login-id').value = 'demo';
    }
    if (byId('login-password') && !byId('login-password').value) {
      byId('login-password').value = '123456';
    }

    const ok = await verifySession();
    if (!ok) {
      applyAdminPanelVisibility();
      applyVendorInstallVisibility();
      return;
    }

    setLoggedInUi(true);
    openView('view-locations');
    applyAdminPanelVisibility();
    applyVendorInstallVisibility();
    await refreshAppData();
    startPolling();
  }

  window.openView = openView;
  window.loginApp = loginApp;
  window.logoutApp = logoutApp;
  window.selectLocation = selectLocation;
  window.muteAlarmApp = muteAlarmApp;
  window.dryRunApp = dryRunApp;
  window.forceClearApp = forceClearApp;
  window.refreshAdminUsersApp = refreshAdminUsersApp;
  window.createAdminUserApp = createAdminUserApp;
  window.toggleAdminUserAccessApp = toggleAdminUserAccessApp;
  window.selectBleDeviceApp = selectBleDeviceApp;
  window.pickBleWifiSsidApp = pickBleWifiSsidApp;
  window.bleScanDevicesApp = bleScanDevicesApp;
  window.bleDisconnectApp = bleDisconnectApp;
  window.bleReadHealthApp = bleReadHealthApp;
  window.bleScanWifiApp = bleScanWifiApp;
  window.bleProvisionWifiApp = bleProvisionWifiApp;

  window.addEventListener('load', () => {
    bootstrap().catch((error) => {
      showToast(`Initialization error: ${error.message}`, true);
    });
  });
})();
