(function () {
  const STORAGE_KEY = 'fg_mobile_session_v1';

  // ── Firebase / FCM ──────────────────────────────────────────────
  const FCM_CONFIG = {
    apiKey: 'AIzaSyDNLaSUaBiC52mFrHsOIwkmahJbAtK2E-U',
    authDomain: 'floodguard-f84ac.firebaseapp.com',
    projectId: 'floodguard-f84ac',
    storageBucket: 'floodguard-f84ac.firebasestorage.app',
    messagingSenderId: '488469166284',
    appId: '1:488469166284:web:bd34ad115167061f17aa69',
    measurementId: 'G-7JVD25ZNN5'
  };
  const FCM_VAPID_KEY = 'BEKxuTUJtugFJheypzEVBZhs1HSs7FXDoC0NcHLCEvo98g0e9qKOL0695JHebudeoovV1b5_yOSTb9obkIcRoqU';
  // ────────────────────────────────────────────────────────────────
  const REFRESH_INTERVAL_MS = 10000;
  const REQUEST_TIMEOUT_MS = 12000;
  const IST_TIMEZONE = 'Asia/Kolkata';
  const BLE_SERVICE_UUID = '0000ff00-0000-1000-8000-00805f9b34fb';
  const BLE_CHARACTERISTIC_UUID = '0000ff01-0000-1000-8000-00805f9b34fb';
  const BLE_NAME_PREFIX = 'JNX-FG';
  const DEFAULT_VPS_HEALTH_URL = 'https://api.floodguard.iotsoft.in/health';
  const MAX_BOTTOM_PRIMARY_TABS = 6;

  const state = {
    apiBase: '',
    token: '',
    user: null,
    session: null,
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
    vendors: [],
    vendorsFiltered: [],
    refreshTimer: null,
    incidentTimer: null,
    loading: false,
    install: {
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
      bleTargetLocationId: ''
    },
    alarm: {
      enabled: false,
      active: false,
      intervalId: null,
      audioCtx: null,
      beepStep: 0
    },
    ble: {
      initialized: false,
      scanResults: [],
      selectedDeviceId: '',
      connectedDeviceId: '',
      wifiNetworks: [],
      phoneWifiSsid: '',
      scanTriggered: false,
      scanInProgress: false,
      provisioningComplete: false,
      provisionInProgress: false,
      commandQueue: null
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

  function triggerTouchFeedback() {
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(12);
      }
    } catch (error) {
      // ignore unsupported vibration API
    }

    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) {
        return;
      }
      if (!triggerTouchFeedback.ctx) {
        triggerTouchFeedback.ctx = new Ctx();
      }
      const ctx = triggerTouchFeedback.ctx;
      if (!ctx) {
        return;
      }
      const now = ctx.currentTime;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.05, now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.07);
    } catch (error) {
      // ignore audio feedback failures
    }
  }

  function installButtonPressFeedback() {
    if (installButtonPressFeedback.bound) {
      return;
    }
    document.addEventListener('click', (event) => {
      const btn = event?.target?.closest?.('button');
      if (!btn) {
        return;
      }
      btn.classList.add('pressed-feedback');
      setTimeout(() => btn.classList.remove('pressed-feedback'), 150);
      triggerTouchFeedback();
    });
    installButtonPressFeedback.bound = true;
  }

  function saveSession() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        apiBase: state.apiBase,
        token: state.token,
        user: state.user,
        session: state.session,
        install: {
          localUrl: state.install.localUrl || '',
          provisionKey: String(state.install.provisionKey || ''),
          adcDividerRatio: Number(state.install.adcDividerRatio || 5.0),
          adcCalibrationFactor: Number(state.install.adcCalibrationFactor || 1.0)
        },
        ble: {
          phoneWifiSsid: String(state.ble.phoneWifiSsid || '')
        }
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
    const menuBtn = byId('top-menu-btn');
    const bottomNav = byId('bottom-nav');
    if (menuBtn) {
      menuBtn.style.display = isLoggedIn ? 'inline-flex' : 'none';
    }
    if (bottomNav) {
      bottomNav.style.display = isLoggedIn ? 'grid' : 'none';
    }
    if (!isLoggedIn) {
      closeHeaderMenu();
    }
    renderHeaderMenu();
  }

  function openView(viewId) {
    if (viewId === 'view-install' && !canVendorInstall()) {
      showToast('Vendor install tools are available only for vendor logins.', true);
      return;
    }
    if (viewId === 'view-config' && !canViewConfig()) {
      showToast('Configuration screen is not available for this role.', true);
      return;
    }
    if (viewId === 'view-users' && !isSuperAdmin()) {
      showToast('User management is only available for super admins.', true);
      return;
    }
    if (viewId === 'view-vendors' && userRole() !== 'VENDOR_SUPER_ADMIN') {
      showToast('Vendor management is only available for Vendor Super Admin.', true);
      return;
    }
    closeHeaderMenu();

    document.querySelectorAll('.view').forEach((view) => {
      view.classList.toggle('active', view.id === viewId);
    });

    document.querySelectorAll('.nav-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.view === viewId);
    });

    if (viewId === 'view-install') {
      renderInstallDeviceTable();
      populateBleTargetLocationSection();
      if (isSuperAdmin()) refreshAdminDevicesApp().catch(() => {});
      refreshVendorInstallStatus().catch(() => {
        // handled internally
      });
    }
    if (viewId === 'view-config') {
      refreshDeviceConfigApp().catch(() => {
        // handled internally
      });
      if (isSuperAdmin()) refreshAllDeviceConfigsApp().catch(() => {});
    }
    if (viewId === 'view-complaints') {
      populateComplaintLocationSelect();
      refreshComplaintsApp().catch(() => {});
    }
    if (viewId === 'view-reports') {
      populateReportLocationSelect();
    }
    if (viewId === 'view-users') {
      refreshAdminUsersApp().catch(() => {});
    }
    if (viewId === 'view-locations' && isSuperAdmin()) {
      populateDeviceLocationSelect();
      refreshAdminDevicesApp().catch(() => {});
    }
    if (viewId === 'view-vendors') {
      populateVendorProjectSelects().catch(() => {});
      loadVendorsApp().catch(() => {});
    }
    renderHeaderMenu();
  }

  function closeHeaderMenu() {
    const menu = byId('top-menu');
    const trigger = byId('top-menu-btn');
    if (menu) {
      menu.style.display = 'none';
    }
    if (trigger) {
      trigger.setAttribute('aria-expanded', 'false');
    }
  }

  function toggleHeaderMenuApp(event) {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }
    const menu = byId('top-menu');
    const trigger = byId('top-menu-btn');
    if (!menu || !trigger || !state.token || !state.user) {
      return;
    }
    const open = menu.style.display !== 'none';
    if (open) {
      closeHeaderMenu();
    } else {
      renderHeaderMenu();
      menu.style.display = 'block';
      trigger.setAttribute('aria-expanded', 'true');
    }
  }

  function openMenuViewApp(viewId) {
    closeHeaderMenu();
    openView(viewId);
  }

  function logoutFromMenuApp() {
    closeHeaderMenu();
    logoutApp();
  }

  function renderHeaderMenu() {
    const list = byId('top-menu-list');
    if (!list) {
      return;
    }
    if (!state.token || !state.user) {
      list.innerHTML = '';
      return;
    }

    const nav = byId('bottom-nav');
    if (!nav) {
      list.innerHTML = '';
      return;
    }

    const currentViewId = document.querySelector('.view.active')?.id || '';
    const buttons = Array.from(nav.querySelectorAll('.nav-btn'))
      .filter((btn) => btn.style.display !== 'none');

    list.innerHTML = buttons.map((btn) => {
      const viewId = String(btn.dataset.view || '');
      const label = escapeHtml((btn.textContent || '').trim() || viewId);
      const activeClass = currentViewId === viewId ? ' active' : '';
      return `<button class="top-menu-item${activeClass}" onclick="openMenuViewApp('${escapeHtml(viewId)}')">${label}</button>`;
    }).join('');
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

  function normalizeLocalDeviceUrl(raw, fallbackIp = '') {
    let next = String(raw || '').trim();
    if (!next && fallbackIp) {
      next = `http://${fallbackIp}`;
    }
    if (!next) {
      return '';
    }
    if (!/^https?:\/\//i.test(next)) {
      next = `http://${next}`;
    }
    return next.replace(/\/+$/, '');
  }

  function withTimeoutMs(ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return {
      controller,
      clear: () => clearTimeout(timer)
    };
  }

  function getCapacitorHttpPlugin() {
    if (window?.Capacitor?.Plugins?.CapacitorHttp) {
      return window.Capacitor.Plugins.CapacitorHttp;
    }
    if (window?.CapacitorHttp) {
      return window.CapacitorHttp;
    }
    return null;
  }

  async function requestViaNativeHttp(options) {
    const plugin = getCapacitorHttpPlugin();
    if (!plugin || typeof plugin.request !== 'function') {
      return null;
    }
    try {
      return await plugin.request(options);
    } catch (error) {
      return null;
    }
  }

  function setInstallMetric(id, text, tone = 'neutral') {
    const el = byId(id);
    if (!el) {
      return;
    }
    el.textContent = text;
    if (tone === 'good') {
      el.style.color = '#059669';
    } else if (tone === 'bad') {
      el.style.color = '#b91c1c';
    } else if (tone === 'warn') {
      el.style.color = '#b45309';
    } else {
      el.style.color = '';
    }
  }

  function setConfigActionStatus(target, message, tone = 'neutral') {
    const normalizedTarget = String(target || '').trim().toLowerCase();
    const id = normalizedTarget === 'local' ? 'cfg-local-status' : 'cfg-cloud-status';
    const prefix = normalizedTarget === 'local' ? 'Local LAN status' : 'Cloud push status';
    const el = byId(id);
    if (!el) {
      return;
    }

    const msg = String(message || '').trim() || '--';
    el.textContent = `${prefix}: ${msg}`;
    if (tone === 'good') {
      el.style.color = '#059669';
    } else if (tone === 'bad') {
      el.style.color = '#b91c1c';
    } else if (tone === 'warn') {
      el.style.color = '#b45309';
    } else {
      el.style.color = '#334155';
    }
  }

  function readableActionError(error) {
    const raw = String(error?.message || error || '').trim();
    if (!raw) {
      return 'Unknown error';
    }
    if (/failed to fetch|networkerror|network request failed/i.test(raw)) {
      return 'Network unreachable. Check connectivity and retry.';
    }
    if (/timed out|timeout|aborted|aborterror/i.test(raw)) {
      return 'Request timed out. Retry.';
    }
    if (/connection refused|econnrefused/i.test(raw)) {
      return 'Connection refused by target server.';
    }
    if (/unauthorized|forbidden|http 401|http 403/i.test(raw)) {
      return 'Access denied. Login again or verify permissions.';
    }
    return raw;
  }

  function setLocalCheckButtonAttention(active) {
    const btn = byId('ble-local-check-btn');
    if (!btn) {
      return;
    }
    btn.classList.toggle('local-check-attn', Boolean(active));
  }

  function setBleCardDimmed(dimmed) {
    const card = byId('ble-device-ble-card');
    if (!card) {
      return;
    }
    card.classList.toggle('dim', Boolean(dimmed));
  }

  function updateBleStatusLabel() {
    const isConnected = Boolean(state.ble.connectedDeviceId);
    const cloudLinked = Boolean(state.install.deviceCloudReachable);
    const cloudVerifiedByLocal = state.install.localReachable === true && state.install.deviceCloudReachable === true;
    const bleCard = byId('ble-device-ble-card');
    if (bleCard) {
      // Hide BLE card only after explicit success and local device confirms cloud is up.
      const hideCard = cloudVerifiedByLocal && state.ble.provisioningComplete;
      bleCard.style.display = hideCard ? 'none' : '';
    }
    if (cloudLinked && !isConnected) {
      setInstallMetric('ble-link-status', 'NOT REQUIRED', 'warn');
      setBleCardDimmed(true);
      return;
    }

    if (isConnected) {
      const selected = findSelectedBleDevice();
      const label = selected?.name ? `CONNECTED (${selected.name})` : 'CONNECTED';
      setInstallMetric('ble-link-status', label, 'good');
      setBleCardDimmed(false);
      return;
    }

    setInstallMetric('ble-link-status', 'DISCONNECTED', 'bad');
    setBleCardDimmed(cloudLinked);
  }

  function selectedLocationRecord() {
    return state.locations.find((item) => item.location_id === state.selectedLocationId) || null;
  }

  function selectedProvisionDeviceId() {
    const selected = String(state.selectedDeviceId || '').trim();
    if (selected) {
      return selected;
    }
    const fromLocation = String(selectedLocationRecord()?.device_id || '').trim();
    return fromLocation;
  }

  async function requestDeviceProvisionProfile() {
    const deviceId = selectedProvisionDeviceId();
    if (!deviceId) {
      throw new Error('Select a location mapped to a device before provisioning.');
    }

    const profile = await apiRequest(`/devices/${encodeURIComponent(deviceId)}/provision-profile`, {
      method: 'POST',
      auth: true
    });

    if (!profile?.device_token) {
      throw new Error('Provision profile is missing device token.');
    }
    return profile;
  }

  function evaluateDeviceCloudHealth() {
    const location = selectedLocationRecord();
    const latest = state.latestTelemetry || null;

    if (!location || !state.selectedDeviceId) {
      return {
        healthy: false,
        reason: 'Select a location first'
      };
    }

    const status = String(location.device_status || '').toUpperCase();
    if (status !== 'ONLINE') {
      return {
        healthy: false,
        reason: `Device status ${status || 'UNKNOWN'}`
      };
    }

    const lastUpdateMs = new Date(location.last_update || 0).getTime();
    const ageSec = Number.isFinite(lastUpdateMs)
      ? Math.max(0, Math.floor((Date.now() - lastUpdateMs) / 1000))
      : 999999;
    if (ageSec > 180) {
      return {
        healthy: false,
        reason: `Last telemetry ${ageSec}s ago`
      };
    }

    if (latest && latest.wifi_connected === false) {
      return {
        healthy: false,
        reason: 'Device Wi-Fi disconnected'
      };
    }
    if (latest && latest.internet_available === false) {
      return {
        healthy: false,
        reason: 'Device internet unavailable'
      };
    }

    return {
      healthy: true,
      reason: `Healthy (${ageSec}s freshness)`
    };
  }

  function renderInstallDeviceTable() {
    const section = byId('install-device-table-section');
    if (!section) return;
    if (!isSuperAdmin()) {
      section.style.display = 'none';
      return;
    }
    section.style.display = '';
    const tbody = byId('install-device-table-body');
    const countEl = byId('install-device-table-count');
    if (!tbody) return;

    const adminDevices = state.adminDevices || [];
    const locs = state.locations || [];

    // Build a map of locationId → location for quick lookup
    const locMap = {};
    locs.forEach((l) => { locMap[l.location_id] = l; });

    // Unbound VPS devices: registered but no location assigned — newest first
    const unbound = adminDevices
      .filter((d) => !d.location_id)
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    // Bound: all locations (which implies a device is bound)
    const bound = locs.filter((l) => l.device_id);

    const totalCount = unbound.length + bound.length;
    if (countEl) countEl.textContent = `${totalCount} device${totalCount !== 1 ? 's' : ''}`;

    if (totalCount === 0 && adminDevices.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="padding:14px 10px;color:#9e9e9e;text-align:center">No devices registered yet.</td></tr>';
      return;
    }

    let rows = [];
    let idx = 1;

    // --- UNBOUND DEVICES (top, highlighted) ---
    unbound.forEach((dev) => {
      const deviceId = dev.device_id || '';
      const isOnline = String(dev.status || '').toUpperCase() === 'ONLINE';
      const statusBadge = isOnline
        ? '<span style="color:#2e7d32;font-weight:600;background:#e8f5e9;padding:2px 8px;border-radius:10px;font-size:11px">UP</span>'
        : '<span style="color:#c62828;font-weight:600;background:#ffebee;padding:2px 8px;border-radius:10px;font-size:11px">DOWN</span>';
      const diagBtn = (!isOnline && deviceId)
        ? `<button class="ghost-btn" style="padding:4px 10px;font-size:11px" onclick="diagDownDeviceApp('${escapeHtml(deviceId)}')">Check Health</button>`
        : '';
      rows.push(`<tr class="install-row-unbound" style="border-bottom:1px solid #e3f2fd">
        <td style="padding:8px 10px;color:#9e9e9e">${idx++}</td>
        <td style="padding:8px 10px;font-family:monospace;font-size:12px">
          <span class="install-dev-link" onclick="openLocationViewWithDevice('${escapeHtml(deviceId)}')" title="Go to Locations to bind this device">${escapeHtml(deviceId)}</span>
          <span style="font-size:10px;color:#1565c0;margin-left:4px">↑ not bound</span>
        </td>
        <td style="padding:8px 10px">
          <span class="install-dev-link" onclick="openLocationViewWithDevice('${escapeHtml(deviceId)}')" style="color:#1565c0;font-size:12px">Connect to Location →</span>
        </td>
        <td style="padding:8px 10px">${statusBadge}</td>
        <td style="padding:8px 10px;text-align:right">${diagBtn}</td>
      </tr>`);
    });

    // --- BOUND DEVICES ---
    bound.forEach((loc) => {
      const deviceId = loc.device_id || '';
      const locationName = loc.location_name || loc.name || '—';
      const isOnline = String(loc.device_status || '').toUpperCase() === 'ONLINE';
      const statusBadge = isOnline
        ? '<span style="color:#2e7d32;font-weight:600;background:#e8f5e9;padding:2px 8px;border-radius:10px;font-size:11px">UP</span>'
        : '<span style="color:#c62828;font-weight:600;background:#ffebee;padding:2px 8px;border-radius:10px;font-size:11px">DOWN</span>';
      const diagBtn = (!isOnline && deviceId)
        ? `<button class="ghost-btn" style="padding:4px 10px;font-size:11px" onclick="diagDownDeviceApp('${escapeHtml(deviceId)}')">Check Health</button>`
        : '';
      const rowBg = !isOnline ? 'background:#fffde7' : '';
      rows.push(`<tr style="border-bottom:1px solid #f5f5f5;${rowBg}">
        <td style="padding:8px 10px;color:#9e9e9e">${idx++}</td>
        <td style="padding:8px 10px;font-family:monospace;font-size:12px">${escapeHtml(deviceId)}</td>
        <td style="padding:8px 10px">${escapeHtml(locationName)}</td>
        <td style="padding:8px 10px">${statusBadge}</td>
        <td style="padding:8px 10px;text-align:right">${diagBtn}</td>
      </tr>`);
    });

    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="padding:14px 10px;color:#9e9e9e;text-align:center">No devices registered yet.</td></tr>';
    } else {
      tbody.innerHTML = rows.join('');
    }
  }

  function diagDownDeviceApp(deviceId) {
    if (!deviceId) return;
    const bleSection = byId('ble-content');
    if (bleSection) bleSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const selectedEl = byId('ble-selected-device');
    if (selectedEl) selectedEl.textContent = `Diagnosing: ${deviceId} — scan BLE, connect, then tap "Check Device Health + VPS"`;
    showToast(`Scan BLE to connect to ${deviceId}, then tap "Check Device Health + VPS" to diagnose.`);
  }

  function renderInstallCloudStatuses() {
    const cloud = evaluateDeviceCloudHealth();
    const localCloudHintUp = state.install.localReachable === true && state.install.deviceCloudReachable === true;
    const effectiveCloudUp = cloud.healthy || localCloudHintUp;
    state.install.deviceCloudReachable = effectiveCloudUp;
    state.install.lastCloudReason = cloud.healthy
      ? cloud.reason
      : (localCloudHintUp ? `${cloud.reason} | local device reports cloud UP` : cloud.reason);
    setInstallMetric('ble-device-cloud-status', effectiveCloudUp ? 'UP' : 'DOWN', effectiveCloudUp ? 'good' : 'bad');
    updateBleStatusLabel();
    updateBleProvisionSectionVisibility();
  }

  function statusMeta(rawStatus) {
    const status = String(rawStatus || 'OFFLINE').toUpperCase();
    const statusMap = {
      NORMAL: { label: 'NORMAL', cls: 'ok' },
      ALERT_PENDING_VERIFICATION: { label: 'ALERT PENDING', cls: 'warn' },
      ALERT_ORANGE: { label: 'ORANGE ALERT', cls: 'warn' },
      ALERT_ORANGE_CONFIRMED: { label: 'ALERT CONFIRMED', cls: 'warn' },
      ALERT_SENSOR_MISMATCH: { label: 'ALERT MISMATCH', cls: 'warn' },
      ALERT_WITH_RS485_FAULT: { label: 'ALERT RS485 FAULT', cls: 'warn' },
      DANGER_PENDING: { label: 'DANGER PENDING', cls: 'danger' },
      DANGER_CONFIRMED: { label: 'DANGER', cls: 'danger' },
      DANGER_WITH_SENSOR_MISMATCH: { label: 'DANGER MISMATCH', cls: 'danger' },
      DANGER_WITH_RS485_FAULT: { label: 'DANGER RS485 FAULT', cls: 'danger' },
      CLEAR_PENDING: { label: 'CLEAR PENDING', cls: 'warn' },
      SENSOR_FAULT: { label: 'SENSOR FAULT', cls: 'off' },
      OFFLINE_LOCAL_MODE: { label: 'OFFLINE LOCAL', cls: 'off' }
    };
    if (statusMap[status]) {
      return statusMap[status];
    }
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

  let _tokenRefreshInProgress = false;

  async function silentRefreshTokenApp() {
    if (!state.token || _tokenRefreshInProgress) return false;
    _tokenRefreshInProgress = true;
    try {
      const base = state.apiBase || normalizeApiBase('');
      const resp = await fetch(`${base}/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${state.token}` }
      });
      if (!resp.ok) return false;
      const body = await resp.json();
      if (!body.ok || !body.data?.token) return false;
      state.token = body.data.token;
      if (body.data.user) state.user = body.data.user;
      if (body.data.session) state.session = body.data.session;
      saveSession();
      return true;
    } catch (error) {
      return false;
    } finally {
      _tokenRefreshInProgress = false;
    }
  }

  function handleApiError(error, fallbackMessage) {
    if (error?.status === 401) {
      silentRefreshTokenApp().then((refreshed) => {
        if (!refreshed) {
          logoutApp(true, 'Access revoked or session expired. Please login again.');
        }
      });
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

  function setBleScanProgress(active, label = '') {
    state.ble.scanInProgress = Boolean(active);
    const scanBtn = byId('ble-scan-btn');
    const spinner = byId('ble-scan-spinner');
    const labelEl = byId('ble-scan-label');
    if (scanBtn) {
      scanBtn.disabled = Boolean(active);
    }
    if (spinner) {
      spinner.classList.toggle('on', Boolean(active));
    }
    if (labelEl) {
      labelEl.textContent = label || (active ? 'Scanning BLE...' : 'Scan BLE Devices');
    }
  }

  function nativeBridge() {
    if (typeof window === 'undefined') {
      return null;
    }
    if (window.FGAndroid && typeof window.FGAndroid.getCurrentWifiSsid === 'function') {
      return window.FGAndroid;
    }
    return null;
  }

  function readPhoneWifiSsid() {
    const bridge = nativeBridge();
    if (!bridge) {
      return '';
    }
    try {
      const value = String(bridge.getCurrentWifiSsid() || '').trim();
      if (!value || /^<unknown ssid>$/i.test(value) || value === '0x') {
        return '';
      }
      return value.replace(/^"+|"+$/g, '');
    } catch (error) {
      return '';
    }
  }

  function renderPhoneWifiSsid() {
    const el = byId('ble-phone-wifi-ssid');
    if (!el) {
      return;
    }
    const value = String(state.ble.phoneWifiSsid || '').trim();
    el.value = value || '';
    el.placeholder = value ? 'Phone Wi-Fi detected' : 'Phone Wi-Fi not detected';
  }

  function choosePreferredSsid(candidateList = [], fallback = '') {
    const phone = String(state.ble.phoneWifiSsid || '').trim();
    const seen = new Set();
    const normalizedCandidates = [];
    for (const item of candidateList) {
      const ssid = String(item || '').trim();
      if (!ssid || seen.has(ssid)) {
        continue;
      }
      seen.add(ssid);
      normalizedCandidates.push(ssid);
    }

    if (phone && normalizedCandidates.includes(phone)) {
      return phone;
    }

    const current = String(byId('ble-wifi-ssid')?.value || '').trim();
    if (current && normalizedCandidates.includes(current)) {
      return current;
    }

    if (phone) {
      return phone;
    }

    const fallbackTrimmed = String(fallback || '').trim();
    if (fallbackTrimmed) {
      return fallbackTrimmed;
    }

    return normalizedCandidates[0] || '';
  }

  function renderBleDeviceList() {
    const list = byId('ble-device-list');
    if (!list) {
      return;
    }

    if (state.ble.provisioningComplete) {
      list.innerHTML = '<div class="empty">Provisioning complete. BLE device picker is hidden.</div>';
      setText('ble-selected-device', 'Selected: hidden after successful apply');
      return;
    }

    if (state.ble.scanInProgress === true) {
      list.innerHTML = '<div class="empty scan-empty"><span class="scan-spinner on" aria-hidden="true"></span>Scanning for nearby FloodGuard BLE devices...</div>';
      return;
    }

    if (!Array.isArray(state.ble.scanResults) || state.ble.scanResults.length === 0) {
      list.innerHTML = '<div class="empty">No BLE devices found yet.</div>';
      return;
    }

    list.innerHTML = state.ble.scanResults.map((device) => {
      const selected = state.ble.selectedDeviceId === device.deviceId;
      const connected = state.ble.connectedDeviceId === device.deviceId;
      const rowClass = [
        'ble-device-row',
        selected ? 'selected' : '',
        connected ? 'connected' : ''
      ].filter(Boolean).join(' ');
      return `
        <div class="${rowClass}" onclick="selectBleDeviceApp('${escapeHtml(device.deviceId)}')">
          <div class="ble-device-name">${escapeHtml(device.name || 'Unknown')} ${selected ? '• Selected' : ''}</div>
          <div class="ble-device-meta">${escapeHtml(device.deviceId)} · RSSI ${escapeHtml(String(device.rssi ?? '--'))}</div>
          <div class="row" style="margin-top:8px;justify-content:flex-end">
            <button class="ghost-btn" style="padding:6px 10px" onclick="selectBleDeviceApp('${escapeHtml(device.deviceId)}')">
              ${selected ? 'Selected' : 'Use Device'}
            </button>
            ${connected ? '<span class="chip">CONNECTED</span>' : ''}
            ${selected && !connected ? '<span class="chip">TOUCH CONFIRMED</span>' : ''}
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

  function setBleWifiSsidValue(ssid) {
    const value = String(ssid || '').trim();
    if (byId('ble-wifi-ssid')) {
      byId('ble-wifi-ssid').value = value;
    }
    if (byId('ble-wifi-ssid-select')) {
      byId('ble-wifi-ssid-select').value = value;
    }
  }

  function renderBleWifiSelect() {
    const select = byId('ble-wifi-ssid-select');
    if (!select) {
      return;
    }

    const currentInput = String(byId('ble-wifi-ssid')?.value || '').trim();
    const unique = [];
    const seen = new Set();
    for (const network of Array.isArray(state.ble.wifiNetworks) ? state.ble.wifiNetworks : []) {
      const ssid = String(network?.ssid || '').trim();
      if (!ssid || seen.has(ssid)) {
        continue;
      }
      seen.add(ssid);
      unique.push(network);
    }

    if (unique.length === 0) {
      select.innerHTML = '<option value="">Scan Wi-Fi to load SSIDs</option>';
      select.disabled = true;
      const preferredFallback = choosePreferredSsid([], '');
      if (preferredFallback) {
        setBleWifiSsidValue(preferredFallback);
      }
      return;
    }

    select.disabled = false;
    const ssidList = unique.map((network) => String(network.ssid || '').trim()).filter(Boolean);
    const preferredSsid = choosePreferredSsid(ssidList, String(unique[0]?.ssid || '').trim());
    select.innerHTML = unique.map((network, idx) => {
      const ssid = String(network.ssid || '').trim();
      const rssi = Number.isFinite(network.rssi) ? ` (${Math.round(network.rssi)} dBm)` : '';
      const selected = preferredSsid
        ? (preferredSsid === ssid ? ' selected' : '')
        : (currentInput
          ? (currentInput === ssid ? ' selected' : '')
          : (idx === 0 ? ' selected' : ''));
      return `<option value="${escapeHtml(ssid)}"${selected}>${escapeHtml(ssid + rssi)}</option>`;
    }).join('');

    const effective = preferredSsid || currentInput || String(unique[0]?.ssid || '').trim();
    if (effective) {
      setBleWifiSsidValue(effective);
    }
  }

  function selectBleWifiOptionApp() {
    const selected = String(byId('ble-wifi-ssid-select')?.value || '').trim();
    if (selected) {
      setBleWifiSsidValue(selected);
    }
  }

  function toggleBleWifiPasswordVisibility() {
    const passInput = byId('ble-wifi-password');
    const toggleBtn = byId('ble-pass-toggle-btn');
    if (!passInput || !toggleBtn) {
      return;
    }
    const nextType = passInput.type === 'password' ? 'text' : 'password';
    passInput.type = nextType;
    toggleBtn.textContent = nextType === 'password' ? 'Show' : 'Hide';
  }

  function setBleOutputs(healthText, provisionText) {
    if (byId('ble-health-output') && typeof healthText === 'string') {
      byId('ble-health-output').textContent = healthText;
    }
    if (byId('ble-provision-output') && typeof provisionText === 'string') {
      byId('ble-provision-output').textContent = provisionText;
    }
  }

  function updateBleProvisionSectionVisibility() {
    const section = byId('ble-wifi-provision-section');
    if (!section) {
      return;
    }

    const selectedDeviceReady = Boolean(findSelectedBleDevice());
    const canShow = canVendorInstall()
      && state.ble.scanTriggered === true
      && Array.isArray(state.ble.scanResults)
      && state.ble.scanResults.length > 0
      && selectedDeviceReady
      && state.ble.provisioningComplete !== true;

    section.style.display = canShow ? 'block' : 'none';
    renderPhoneWifiSsid();
  }

  function setProvisionModalVisible(visible) {
    const modal = byId('provision-progress-modal');
    if (!modal) {
      return;
    }
    modal.style.display = visible ? 'flex' : 'none';
  }

  function setProvisionModalNote(note) {
    const el = byId('provision-modal-note');
    if (el) {
      el.textContent = String(note || '').trim() || '--';
    }
  }

  function setProvisionCloseEnabled(enabled) {
    const closeBtn = byId('provision-modal-close');
    if (closeBtn) {
      closeBtn.disabled = !enabled;
    }
  }

  function setProvisionStep(stepNo, status, note) {
    const row = byId(`prov-step-${stepNo}`);
    const noteEl = byId(`prov-step-note-${stepNo}`);
    if (row) {
      row.classList.remove('active', 'done', 'error');
      if (status === 'active' || status === 'done' || status === 'error') {
        row.classList.add(status);
      }
    }
    if (noteEl && typeof note === 'string') {
      noteEl.textContent = note;
    }
  }

  function setProvisionFinalStepTitle(outcome) {
    const titleEl = byId('prov-step-title-4');
    if (!titleEl) {
      return;
    }
    const normalized = String(outcome || '').trim().toLowerCase();
    if (normalized === 'success') {
      titleEl.textContent = '4. Success';
      return;
    }
    if (normalized === 'failed') {
      titleEl.textContent = '4. Failed';
      return;
    }
    titleEl.textContent = '4. Pending';
  }

  function startProvisionModal(ssid) {
    clearTimeout(startProvisionModal.autoCloseTimer);
    startProvisionModal.autoCloseTimer = null;
    try {
      if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
      }
    } catch (error) {
      // ignore blur failures
    }
    const passInput = byId('ble-wifi-password');
    if (passInput && typeof passInput.blur === 'function') {
      passInput.blur();
    }
    setProvisionModalVisible(true);
    setProvisionCloseEnabled(true);
    setProvisionModalNote(`Provisioning SSID "${ssid}"...`);
    setProvisionFinalStepTitle('pending');
    const _s1 = byId('prov-step-1');
    const _s2 = byId('prov-step-2');
    if (_s1) _s1.style.display = '';
    if (_s2) _s2.style.display = '';
    setProvisionStep(1, 'active', 'Sending Wi-Fi details to device...');
    setProvisionStep(2, '', 'Waiting...');
    setProvisionStep(3, '', 'Waiting...');
    setProvisionStep(4, '', 'Waiting...');
  }

  function scheduleProvisionModalAutoClose(ms = 1600) {
    clearTimeout(startProvisionModal.autoCloseTimer);
    startProvisionModal.autoCloseTimer = setTimeout(() => {
      setProvisionModalVisible(false);
      startProvisionModal.autoCloseTimer = null;
    }, ms);
  }

  function closeProvisionProgressModalApp() {
    clearTimeout(startProvisionModal.autoCloseTimer);
    startProvisionModal.autoCloseTimer = null;
    setProvisionModalVisible(false);
  }

  function cancelBleProvisionFlowApp() {
    clearTimeout(startProvisionModal.autoCloseTimer);
    startProvisionModal.autoCloseTimer = null;
    setProvisionModalVisible(false);
    const passInput = byId('ble-wifi-password');
    if (passInput) {
      passInput.value = '';
    }
    showToast('Apply cancelled.');
  }

  async function checkAppVpsHealth() {
    if (!byId('ble-app-cloud-status') || !canVendorInstall()) {
      return false;
    }

    const primaryHealthUrl = resolveVpsHealthUrl();
    const fallbackHealthUrl = alternateVpsHealthUrl(primaryHealthUrl);
    const candidates = [primaryHealthUrl];
    if (fallbackHealthUrl && fallbackHealthUrl !== primaryHealthUrl) {
      candidates.push(fallbackHealthUrl);
    }

    let lastStatus = null;
    for (const healthUrl of candidates) {
      try {
        const t = withTimeoutMs(6000);
        const res = await fetch(healthUrl, { signal: t.controller.signal });
        t.clear();
        if (res.ok) {
          state.install.appCloudReachable = true;
          setInstallMetric('ble-app-cloud-status', `UP (${res.status})`, 'good');
          return true;
        }
        lastStatus = res.status;
      } catch (error) {
        // try fallback URL if available
      }
    }

    state.install.appCloudReachable = false;
    setInstallMetric('ble-app-cloud-status', lastStatus === null ? 'DOWN' : `DOWN (${lastStatus})`, 'bad');
    return false;
  }

  function updateLocalUrlFromState(ipCandidate = '') {
    const localInput = byId('ble-local-url');
    if (!localInput) {
      return '';
    }

    const fallbackIp = String(ipCandidate || state.install.localIp || '').trim();
    let preferredUrl = localInput.value || state.install.localUrl || '';
    if (fallbackIp) {
      // When device reports a fresh IP after provisioning, prefer that over stale cached local URLs.
      preferredUrl = `http://${fallbackIp}`;
    }
    const normalized = normalizeLocalDeviceUrl(preferredUrl, fallbackIp);
    if (normalized) {
      localInput.value = normalized;
      state.install.localUrl = normalized;
      saveSession();
    }
    return normalized;
  }

  function applyLocalStatus(statusPayload, localUrl) {
    const ip = String(statusPayload?.ip || '').trim();
    if (ip) {
      state.install.localIp = ip;
    }
    if (localUrl) {
      state.install.localUrl = localUrl;
    }

    state.install.localReachable = true;
    applyVoltageSettingsFromPayload(statusPayload);
    setInstallMetric('ble-device-local-status', 'UP', 'good');
    const addressText = ip || localUrl || '--';
    setText('ble-device-local-address', `Address: ${addressText}`);
    if (typeof statusPayload?.mqtt_connected === 'boolean') {
      state.install.deviceCloudReachable = statusPayload.mqtt_connected;
      setInstallMetric('ble-device-cloud-status', statusPayload.mqtt_connected ? 'UP' : 'DOWN', statusPayload.mqtt_connected ? 'good' : 'bad');
    }
    updateBleStatusLabel();
    syncVoltageInputsFromState();
    saveSession();
    setLocalCheckButtonAttention(false);
  }

  async function fetchLocalDeviceStatus(localUrl) {
    const nativeResponse = await requestViaNativeHttp({
      url: `${localUrl}/status`,
      method: 'GET',
      connectTimeout: 5000,
      readTimeout: 5000,
      responseType: 'json'
    });
    if (nativeResponse && Number(nativeResponse.status) >= 200 && Number(nativeResponse.status) < 300) {
      if (nativeResponse.data && typeof nativeResponse.data === 'object') {
        return nativeResponse.data;
      }
      if (typeof nativeResponse.data === 'string' && nativeResponse.data.trim()) {
        return JSON.parse(nativeResponse.data);
      }
    }

    const t = withTimeoutMs(5000);
    try {
      const res = await fetch(`${localUrl}/status`, { signal: t.controller.signal });
      t.clear();
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return await res.json();
    } catch (error) {
      t.clear();
      throw error;
    }
  }

  async function refreshLocalDeviceStatusApp(silent = false) {
    if (!canVendorInstall()) {
      return false;
    }

    const localUrl = updateLocalUrlFromState();
    if (!localUrl) {
      state.install.localReachable = false;
      setInstallMetric('ble-device-local-status', 'SET URL', 'warn');
      setText('ble-device-local-address', 'Address: --');
      setLocalCheckButtonAttention(true);
      if (!silent) {
        showToast('Set Device Local URL first.', true);
      }
      return false;
    }

    try {
      const payload = await fetchLocalDeviceStatus(localUrl);
      applyLocalStatus(payload, localUrl);
      return true;
    } catch (error) {
      if (silent && state.install.localReachable === true) {
        // Do not downgrade UI cards on transient background/local-network hiccups.
        return false;
      }
      state.install.localReachable = false;
      setInstallMetric('ble-device-local-status', 'DOWN', 'bad');
      setText('ble-device-local-address', `Address: ${state.install.localIp || localUrl}`);
      updateBleStatusLabel();
      setLocalCheckButtonAttention(true);
      if (!silent) {
        showToast(`Local device check failed: ${error.message}`, true);
      }
      return false;
    }
  }

  async function ensureBleConnected(options = {}) {
    const { forceReconnect = false } = options;
    const ble = await ensureBleReady();
    const selected = findSelectedBleDevice();
    if (!selected) {
      throw new Error('Select BLE device first.');
    }

    if (forceReconnect && state.ble.connectedDeviceId) {
      try {
        await ble.disconnect({ deviceId: state.ble.connectedDeviceId, timeout: 3000 });
      } catch (error) {
        // ignore cleanup failure for stale BLE links
      }
      state.ble.connectedDeviceId = '';
    }

    if (state.ble.connectedDeviceId !== selected.deviceId || forceReconnect) {
      await ble.connect({ deviceId: selected.deviceId, timeout: 12000 });
      state.ble.connectedDeviceId = selected.deviceId;
      await ble.discoverServices({ deviceId: selected.deviceId, timeout: 10000 });
      updateBleStatusLabel();
    }

    return {
      ble,
      device: selected
    };
  }

  function bleCommandName(payload) {
    return String(payload?.cmd || payload?.op || '').trim().toLowerCase();
  }

  function shouldRetryBleConnection(error) {
    const text = String(error?.message || '').toLowerCase();
    return text.includes('not connected')
      || text.includes('disconnected')
      || text.includes('device was disconnected')
      || text.includes('gatt')
      || text.includes('status 133');
  }

  function isBleNoResponseError(error) {
    const text = String(error?.message || '').toLowerCase();
    return text.includes('no response received from device over ble')
      || text.includes('no matching ble response')
      || text.includes('ble read timeout')
      || text.includes('not connected to device')
      || text.includes('connection timeout');
  }

  function enqueueBleCommand(task) {
    const previous = state.ble.commandQueue || Promise.resolve();
    const run = previous.then(() => task());
    state.ble.commandQueue = run.catch(() => {
      // Keep queue alive after failures so next command can still run.
    });
    return run;
  }

  function wifiStatusTextFromCode(code) {
    const n = Number(code);
    switch (n) {
      case 0: return 'IDLE';
      case 1: return 'NO_SSID';
      case 2: return 'SCAN_COMPLETED';
      case 3: return 'CONNECTED';
      case 4: return 'CONNECT_FAILED';
      case 5: return 'CONNECTION_LOST';
      case 6: return 'DISCONNECTED';
      default: return 'UNKNOWN';
    }
  }

  function bleErrorMessage(parsed) {
    if (!parsed || typeof parsed !== 'object') {
      return 'Device returned error';
    }
    const rawCode = String(parsed.error || parsed.code || '').trim();
    const code = rawCode.toLowerCase();
    if (code.startsWith('device_register_failed')) {
      const detail = rawCode.includes(':')
        ? rawCode.split(':').slice(1).join(':').trim()
        : '';
      return detail
        ? `Device register failed: ${detail}`
        : 'Device register failed. Check provision key and VPS endpoint.';
    }
    const map = {
      invalid_json: 'Device could not parse request payload.',
      missing_cmd: 'Device did not receive a command field.',
      ssid_required: 'SSID is missing. Please select or enter SSID.',
      wifi_scan_failed: 'Device Wi-Fi scan failed. Try again near router.',
      unknown_cmd: 'Device firmware rejected command (unknown_cmd).'
    };
    if (code && map[code]) {
      return `${map[code]} [${code}]`;
    }

    const message = parsed.error || parsed.message || parsed.reason;
    if (message && String(message).trim()) {
      return String(message).trim();
    }
    try {
      return `Device returned error: ${JSON.stringify(parsed).slice(0, 220)}`;
    } catch (error) {
      return 'Device returned error';
    }
  }

  async function bleSendCommand(command, options = {}) {
    const {
      expectCmd = bleCommandName(command),
      readTimeoutMs = 5000,
      maxWaitMs = 15000,
      initialDelayMs = 450,
      pollIntervalMs = 550,
      errorGraceMs = 2500
    } = options;

    const payload = JSON.stringify(command || {});

    const runCommandOnce = async (forceReconnect) => {
      const { ble, device } = await ensureBleConnected({ forceReconnect });
      await ble.write({
        deviceId: device.deviceId,
        service: BLE_SERVICE_UUID,
        characteristic: BLE_CHARACTERISTIC_UUID,
        value: textToHex(payload),
        timeout: 10000
      });

      const started = Date.now();
      let lastNonEmptyText = '';
      await delay(initialDelayMs);

      while (Date.now() - started < maxWaitMs) {
        let text = '';
        try {
          const read = await ble.read({
            deviceId: device.deviceId,
            service: BLE_SERVICE_UUID,
            characteristic: BLE_CHARACTERISTIC_UUID,
            timeout: readTimeoutMs
          });
          text = String(hexToText(read?.value || '') || '').trim();
        } catch (error) {
          if (shouldRetryBleConnection(error)) {
            throw error;
          }
          if (Date.now() - started >= maxWaitMs) {
            throw new Error(`BLE read timeout: ${error.message}`);
          }
          await delay(pollIntervalMs);
          continue;
        }

        if (!text) {
          await delay(pollIntervalMs);
          continue;
        }
        lastNonEmptyText = text;

        let parsed = null;
        try {
          parsed = JSON.parse(text);
        } catch (error) {
          if (Date.now() - started >= maxWaitMs) {
            throw new Error(`Invalid BLE response: ${text}`);
          }
          await delay(pollIntervalMs);
          continue;
        }

        const responseCmd = bleCommandName(parsed);
        if (expectCmd && responseCmd && responseCmd !== expectCmd) {
          await delay(pollIntervalMs);
          continue;
        }

        if (parsed?.ok !== true) {
          const hasErrorDetail = Boolean(parsed?.error || parsed?.message || parsed?.reason);
          const looksLikeEcho = !hasErrorDetail
            && responseCmd
            && expectCmd
            && responseCmd === expectCmd
            && parsed?.ok === undefined;
          if (looksLikeEcho) {
            // Some stacks return the just-written characteristic value before firmware overwrites it.
            // Ignore these echo frames and keep polling for the real response.
            await delay(pollIntervalMs);
            continue;
          }

          // Some firmware error payloads do not include cmd and can be stale characteristic data.
          // Give the device a short grace window to overwrite with the current command response.
          const noCmdInError = !responseCmd;
          if (expectCmd && noCmdInError && (Date.now() - started) < errorGraceMs) {
            await delay(pollIntervalMs);
            continue;
          }

          const err = new Error(bleErrorMessage(parsed));
          err.rawResponse = parsed;
          throw err;
        }
        return parsed;
      }

      throw new Error(lastNonEmptyText
        ? `No matching BLE response yet. Last response: ${lastNonEmptyText.slice(0, 200)}`
        : 'No response received from device over BLE.');
    };

    return enqueueBleCommand(async () => {
      try {
        return await runCommandOnce(false);
      } catch (error) {
        if (shouldRetryBleConnection(error)) {
          state.ble.connectedDeviceId = '';
          await delay(300);
          return runCommandOnce(true);
        }
        throw error;
      }
    });
  }

  function updateVpsUrlInput() {
    const vpsInput = byId('ble-vps-url');
    if (vpsInput) {
      const autoUrl = resolveVpsHealthUrl();
      if (String(vpsInput.value || '').trim() !== autoUrl) {
        vpsInput.value = autoUrl;
      }
    }
    if (byId('ble-local-url') && !String(byId('ble-local-url').value || '').trim()) {
      const candidate = normalizeLocalDeviceUrl(state.install.localUrl || '', state.install.localIp || '');
      if (candidate) {
        byId('ble-local-url').value = candidate;
      }
    }
  }

  function safeInstallNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function applyVoltageSettingsFromPayload(payload) {
    if (!payload || typeof payload !== 'object') {
      return;
    }

    const divider = Number(payload.battery_adc_divider_ratio);
    if (Number.isFinite(divider) && divider >= 1.0 && divider <= 25.0) {
      state.install.adcDividerRatio = divider;
    }

    const calibration = Number(payload.battery_adc_calibration_factor);
    if (Number.isFinite(calibration) && calibration >= 0.5 && calibration <= 1.8) {
      state.install.adcCalibrationFactor = calibration;
    }

    const batteryVoltage = Number(payload.battery_voltage);
    if (Number.isFinite(batteryVoltage) && batteryVoltage >= 0) {
      state.install.lastDeviceBatteryVoltage = batteryVoltage;
    }
  }

  function syncVoltageInputsFromState() {
    const dividerInput = byId('ble-adc-divider-ratio');
    if (dividerInput) {
      dividerInput.value = safeInstallNumber(state.install.adcDividerRatio, 5.0).toFixed(2);
    }

    const calibrationInput = byId('ble-adc-calibration-factor');
    if (calibrationInput) {
      calibrationInput.value = safeInstallNumber(state.install.adcCalibrationFactor, 1.0).toFixed(3);
    }

    const note = byId('ble-adc-calibration-note');
    if (note) {
      const v = Number(state.install.lastDeviceBatteryVoltage);
      note.textContent = Number.isFinite(v)
        ? `Device voltage now: ${v.toFixed(2)}V. Tip: calibration = Multimeter / Device voltage.`
        : 'Tip: calibration = Multimeter / Device voltage.';
    }
  }

  function readVoltageSettingsFromForm() {
    const divider = Number(byId('ble-adc-divider-ratio')?.value || state.install.adcDividerRatio || 5.0);
    const calibration = Number(byId('ble-adc-calibration-factor')?.value || state.install.adcCalibrationFactor || 1.0);

    if (!Number.isFinite(divider) || divider < 1.0 || divider > 25.0) {
      throw new Error('ADC divider ratio must be between 1.0 and 25.0');
    }
    if (!Number.isFinite(calibration) || calibration < 0.5 || calibration > 1.8) {
      throw new Error('ADC calibration factor must be between 0.5 and 1.8');
    }

    state.install.adcDividerRatio = divider;
    state.install.adcCalibrationFactor = calibration;
    saveSession();
    syncVoltageInputsFromState();

    return {
      divider,
      calibration
    };
  }

  function autoCalibrateVoltageFactorApp() {
    const measured = Number(byId('ble-adc-measured-voltage')?.value || '');
    const device = Number(state.install.lastDeviceBatteryVoltage);
    if (!Number.isFinite(measured) || measured <= 0) {
      showToast('Enter measured multimeter voltage first.', true);
      return;
    }
    if (!Number.isFinite(device) || device <= 0) {
      showToast('Read device health first to get device voltage.', true);
      return;
    }

    const nextFactor = measured / device;
    if (!Number.isFinite(nextFactor) || nextFactor < 0.5 || nextFactor > 1.8) {
      showToast('Calculated factor is outside allowed range (0.5 to 1.8).', true);
      return;
    }

    state.install.adcCalibrationFactor = nextFactor;
    syncVoltageInputsFromState();
    saveSession();
    showToast(`Calibration factor set to ${nextFactor.toFixed(3)}.`);
  }

  async function refreshVendorInstallStatus() {
    if (!canVendorInstall()) {
      return;
    }
    const phoneSsid = readPhoneWifiSsid();
    state.ble.phoneWifiSsid = phoneSsid;
    renderPhoneWifiSsid();
    syncVoltageInputsFromState();
    updateVpsUrlInput();
    if (state.ble.provisionInProgress) {
      updateBleStatusLabel();
      return;
    }
    await checkAppVpsHealth();
    renderInstallCloudStatuses();
    renderBleDeviceList();
    renderBleWifiList();
    renderBleWifiSelect();
    updateBleProvisionSectionVisibility();
    updateBleStatusLabel();
  }

  function isSuperAdmin() {
    const role = String(state.user?.role || '').toUpperCase();
    return role === 'VENDOR_SUPER_ADMIN' || role === 'DEPARTMENT_SUPER_ADMIN';
  }

  function isNativeApp() {
    return Boolean(window?.Capacitor?.isNativePlatform?.() || window?.Capacitor?.isNative);
  }

  function applyBrowserModeUi() {
    if (isNativeApp()) return;
    const notice = byId('install-pwa-notice');
    if (notice) notice.style.display = 'block';
    const bleContent = byId('ble-content');
    if (bleContent) bleContent.style.display = 'none';
  }

  function userRole() {
    return String(state.user?.role || '').toUpperCase();
  }

  function canViewConfig() {
    const role = userRole();
    return Boolean(role) && role !== 'VIEWER';
  }

  function canEditConfig() {
    return ['VENDOR_SUPER_ADMIN', 'DEPARTMENT_SUPER_ADMIN', 'DEPARTMENT_ADMIN'].includes(userRole());
  }

  function selectedConfigDeviceId() {
    return String(state.selectedDeviceId || '').trim();
  }

  function setConfigInputsDisabled(disabled) {
    [
      'cfg-alert-level',
      'cfg-danger-level',
      'cfg-clear-level',
      'cfg-trigger-delay',
      'cfg-clear-delay',
      'cfg-sensor-mount-height',
      'cfg-rs485-enabled',
      'cfg-switch-enabled',
      'cfg-switch-level-1-mm',
      'cfg-switch-level-2-mm',
      'cfg-local-pin'
    ].forEach((id) => {
      const el = byId(id);
      if (el) {
        el.disabled = disabled;
      }
    });
  }

  function setConfigButtonDisabled(disabled) {
    const saveBtn = byId('cfg-save-btn');
    const pushBtn = byId('cfg-push-btn');
    const localSaveBtn = byId('cfg-local-save-btn');
    if (saveBtn) {
      saveBtn.disabled = disabled;
    }
    if (pushBtn) {
      pushBtn.disabled = disabled;
    }
    if (localSaveBtn) {
      localSaveBtn.disabled = disabled;
    }
  }

  function setConfigInputValue(id, value) {
    const el = byId(id);
    if (el) {
      el.value = value == null ? '' : String(value);
    }
  }

  function defaultConfigForView() {
    const latestConfig = state.latestTelemetry?.config || {};
    return {
      alert_level_mm: Number(latestConfig.alert_level_mm ?? 200),
      danger_level_mm: Number(latestConfig.danger_level_mm ?? 500),
      clear_level_mm: Number(latestConfig.clear_level_mm ?? 450),
      trigger_delay_seconds: Number(latestConfig.trigger_delay_seconds ?? 60),
      clear_delay_seconds: Number(latestConfig.clear_delay_seconds ?? 300),
      sensor_mount_height_mm: Number(latestConfig.sensor_mount_height_mm ?? 1200),
      rs485_sensor_enabled: latestConfig.rs485_sensor_enabled !== false,
      switch_sensor_enabled: latestConfig.switch_sensor_enabled !== false,
      switch_level_1_mm: Number(latestConfig.switch_level_1_mm ?? 300),
      switch_level_2_mm: Number(latestConfig.switch_level_2_mm ?? 500),
      config_version: Number(latestConfig.config_version ?? 1),
      state: 'ACTIVE',
      last_ack_at: null,
      last_ack_status: null,
      last_ack_message: null
    };
  }

  function renderDeviceConfigHistory(items = []) {
    const list = byId('cfg-history-list');
    if (!list) {
      return;
    }

    if (!Array.isArray(items) || items.length === 0) {
      list.innerHTML = '<div class="empty">No config history loaded.</div>';
      return;
    }

    list.innerHTML = items.slice(0, 20).map((entry) => {
      const requestedBy = entry.requested_by || 'unknown';
      const stateLabel = String(entry.state || '--').toUpperCase();
      const ackStatus = entry.ack?.status ? `ACK ${entry.ack.status}` : 'ACK --';
      const ackAt = entry.ack?.at ? formatDateTime(entry.ack.at) : '--';
      const cfg = entry.config || {};
      const summary = [
        `A:${cfg.alert_level_mm ?? '--'}`,
        `D:${cfg.danger_level_mm ?? '--'}`,
        `C:${cfg.clear_level_mm ?? '--'}`,
        `T:${cfg.trigger_delay_seconds ?? '--'}s/${cfg.clear_delay_seconds ?? '--'}s`
      ].join(' | ');

      return `
        <div class="audit-item">
          <div class="audit-event">V${escapeHtml(String(entry.config_version ?? '--'))} · ${escapeHtml(stateLabel)}</div>
          <div class="audit-detail">${escapeHtml(summary)}</div>
          <div class="audit-detail">${escapeHtml(ackStatus)} · ${escapeHtml(entry.command_id || '--')}</div>
          <div class="audit-time">${escapeHtml(formatDateTime(entry.requested_at))} IST · ${escapeHtml(requestedBy)} · ACK ${escapeHtml(ackAt)}</div>
          ${entry.ack?.message ? `<div class="audit-time">${escapeHtml(String(entry.ack.message))}</div>` : ''}
        </div>
      `;
    }).join('');
  }

  function renderDeviceConfig(configLike) {
    const canView = canViewConfig();
    const canEdit = canEditConfig();
    const deviceId = selectedConfigDeviceId();
    const accessNote = byId('cfg-access-note');

    if (!canView) {
      if (accessNote) {
        accessNote.textContent = 'Access: Viewer role cannot access device configuration.';
      }
      setConfigInputsDisabled(true);
      setConfigButtonDisabled(true);
      setConfigActionStatus('cloud', 'Locked for current role.', 'bad');
      setConfigActionStatus('local', 'Locked for current role.', 'bad');
      return;
    }

    const config = configLike || defaultConfigForView();
    setConfigInputValue('cfg-alert-level', config.alert_level_mm);
    setConfigInputValue('cfg-danger-level', config.danger_level_mm);
    setConfigInputValue('cfg-clear-level', config.clear_level_mm);
    setConfigInputValue('cfg-trigger-delay', config.trigger_delay_seconds);
    setConfigInputValue('cfg-clear-delay', config.clear_delay_seconds);
    setConfigInputValue('cfg-sensor-mount-height', config.sensor_mount_height_mm);
    setConfigInputValue('cfg-rs485-enabled', config.rs485_sensor_enabled ? 'true' : 'false');
    setConfigInputValue('cfg-switch-enabled', config.switch_sensor_enabled ? 'true' : 'false');
    setConfigInputValue('cfg-switch-level-1-mm', config.switch_level_1_mm);
    setConfigInputValue('cfg-switch-level-2-mm', config.switch_level_2_mm);
    setText('cfg-meta-version', `Version: ${config.config_version ?? '--'} · State: ${config.state || '--'}`);
    const ackStatus = config.last_ack_status || '--';
    const ackTime = config.last_ack_at ? formatDateTime(config.last_ack_at) : '--';
    const ackMsg = config.last_ack_message ? ` · ${config.last_ack_message}` : '';
    setText('cfg-meta-ack', `Last ACK: ${ackStatus} at ${ackTime}${ackMsg}`);

    if (accessNote) {
      const loc = state.locations.find((l) => l.location_id === state.selectedLocationId);
      const locLabel = loc ? `${loc.location_name || loc.location_id} · ${deviceId}` : '';
      if (!deviceId) {
        accessNote.textContent = `Configuring: — · Select a location in the Locations tab first.`;
      } else if (canEdit) {
        accessNote.textContent = `Configuring: ${locLabel} · Editable`;
      } else {
        accessNote.textContent = `Configuring: ${locLabel} · Read only`;
      }
    }

    const shouldDisableInputs = !canEdit || !deviceId;
    setConfigInputsDisabled(shouldDisableInputs);
    setConfigButtonDisabled(shouldDisableInputs);
    if (!deviceId) {
      setConfigActionStatus('cloud', 'Select a location/device first.', 'warn');
      setConfigActionStatus('local', 'Select a location/device first.', 'warn');
    } else if (!canEdit) {
      setConfigActionStatus('cloud', 'Read-only access for this role.', 'warn');
      setConfigActionStatus('local', 'Read-only access for this role.', 'warn');
    }
  }

  function parseConfigInt(id, label) {
    const raw = String(byId(id)?.value || '').trim();
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      throw new Error(`${label} is required.`);
    }
    return Math.round(parsed);
  }

  function collectDeviceConfigFromForm() {
    const cfg = {
      alert_level_mm: parseConfigInt('cfg-alert-level', 'Alert threshold'),
      danger_level_mm: parseConfigInt('cfg-danger-level', 'Danger threshold'),
      clear_level_mm: parseConfigInt('cfg-clear-level', 'Clear threshold'),
      trigger_delay_seconds: parseConfigInt('cfg-trigger-delay', 'Trigger delay'),
      clear_delay_seconds: parseConfigInt('cfg-clear-delay', 'Clear delay'),
      sensor_mount_height_mm: parseConfigInt('cfg-sensor-mount-height', 'Sensor mount height'),
      rs485_sensor_enabled: String(byId('cfg-rs485-enabled')?.value || 'true') === 'true',
      switch_sensor_enabled: String(byId('cfg-switch-enabled')?.value || 'true') === 'true',
      switch_level_1_mm: parseConfigInt('cfg-switch-level-1-mm', 'Level 1 switch height'),
      switch_level_2_mm: parseConfigInt('cfg-switch-level-2-mm', 'Level 2 switch height')
    };

    if (cfg.alert_level_mm <= 0) {
      throw new Error('Alert threshold must be greater than 0.');
    }
    if (cfg.danger_level_mm <= cfg.alert_level_mm) {
      throw new Error('Danger threshold must be greater than alert threshold.');
    }
    if (cfg.clear_level_mm >= cfg.danger_level_mm) {
      throw new Error('Clear threshold must be lower than danger threshold.');
    }
    if (cfg.trigger_delay_seconds < 10 || cfg.trigger_delay_seconds > 600) {
      throw new Error('Trigger delay must be between 10 and 600 seconds.');
    }
    if (cfg.clear_delay_seconds < 30 || cfg.clear_delay_seconds > 1800) {
      throw new Error('Clear delay must be between 30 and 1800 seconds.');
    }
    if (!cfg.rs485_sensor_enabled && !cfg.switch_sensor_enabled) {
      throw new Error('At least one sensor input must stay enabled.');
    }
    if (cfg.sensor_mount_height_mm <= cfg.danger_level_mm) {
      throw new Error('Sensor mount height must be greater than danger threshold.');
    }

    return cfg;
  }

  function ensureCloudPushAllowed() {
    const health = evaluateDeviceCloudHealth();
    state.install.deviceCloudReachable = health.healthy;
    setInstallMetric('ble-device-cloud-status', health.healthy ? 'UP' : 'DOWN', health.healthy ? 'good' : 'bad');
    updateBleStatusLabel();
    if (!health.healthy) {
      showToast(`Cloud health warning: ${health.reason}. Trying cloud push anyway.`, true);
    }
    return true;
  }

  async function refreshAllDeviceConfigsApp() {
    const section = byId('all-device-configs-section');
    if (!section) return;
    if (!isSuperAdmin()) { section.style.display = 'none'; return; }
    section.style.display = '';
    const tbody = byId('all-device-configs-body');
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="padding:12px 8px;color:#9e9e9e;text-align:center">Loading...</td></tr>';
    try {
      const configs = await apiRequest('/admin/device-configs');
      const list = Array.isArray(configs) ? configs : [];
      if (!tbody) return;
      if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="padding:12px 8px;color:#9e9e9e;text-align:center">No device configs found.</td></tr>';
        return;
      }
      tbody.innerHTML = list.map((c) => {
        const ackBadge = c.last_ack_status === 'ACK'
          ? '<span style="color:#2e7d32;font-size:10px">ACK</span>'
          : (c.last_ack_status ? `<span style="color:#c62828;font-size:10px">${c.last_ack_status}</span>` : '<span style="color:#9e9e9e;font-size:10px">—</span>');
        return `<tr style="border-bottom:1px solid #f5f5f5">
          <td style="padding:7px 8px;font-family:monospace;font-size:11px">${escapeHtml(c.device_id)}</td>
          <td style="padding:7px 8px;font-size:11px">${escapeHtml(c.location_name || c.location_id || '—')}</td>
          <td style="padding:7px 8px">${c.alert_level_mm ?? '—'} / ${c.danger_level_mm ?? '—'}</td>
          <td style="padding:7px 8px;color:#555">v${c.config_version ?? '?'}</td>
          <td style="padding:7px 8px">${ackBadge}</td>
          <td style="padding:7px 8px;text-align:right;white-space:nowrap">
            <button class="ghost-btn" style="padding:3px 8px;font-size:11px;margin-right:4px" onclick="selectDeviceConfigForEditingApp('${escapeHtml(c.device_id)}','${escapeHtml(c.location_id || '')}')">Select</button>
            <button class="ghost-btn" style="padding:3px 8px;font-size:11px;color:#c62828;border-color:#c62828" onclick="resetDeviceConfigToDefaultApp('${escapeHtml(c.device_id)}')">Reset Default</button>
          </td>
        </tr>`;
      }).join('');
    } catch (error) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="padding:12px 8px;color:#c62828;text-align:center">Failed to load configs.</td></tr>';
    }
  }

  function selectDeviceConfigForEditingApp(deviceId, locationId) {
    const loc = state.locations.find((l) => l.location_id === locationId || l.device_id === deviceId);
    if (loc) {
      state.selectedLocationId = loc.location_id;
      state.selectedDeviceId = loc.device_id || deviceId;
      saveSession();
    } else {
      state.selectedDeviceId = deviceId;
    }
    refreshDeviceConfigApp().catch(() => {});
    refreshDeviceConfigHistoryApp().catch(() => {});
    byId('cfg-access-note')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    showToast(`Config loaded for ${deviceId}.`);
  }

  async function resetDeviceConfigToDefaultApp(deviceId) {
    if (!confirm(`Reset config for ${deviceId} to factory defaults? This cannot be undone.`)) return;
    try {
      await apiRequest(`/admin/devices/${encodeURIComponent(deviceId)}/config/reset`, { method: 'POST' });
      showToast(`${deviceId} config reset to defaults.`);
      refreshAllDeviceConfigsApp().catch(() => {});
      if (state.selectedDeviceId === deviceId) refreshDeviceConfigApp().catch(() => {});
    } catch (error) {
      showToast(`Reset failed: ${error.message}`, true);
    }
  }

  async function refreshDeviceConfigHistoryApp() {
    if (!canViewConfig()) {
      return;
    }
    const deviceId = selectedConfigDeviceId();
    if (!deviceId) {
      state.deviceConfigHistory = [];
      renderDeviceConfigHistory([]);
      return;
    }

    try {
      const history = await apiRequest(`/devices/${encodeURIComponent(deviceId)}/config/history`, { auth: true });
      if (deviceId !== state.selectedDeviceId) {
        return;
      }
      state.deviceConfigHistory = Array.isArray(history) ? history : [];
      state.configDeviceId = deviceId;
      renderDeviceConfigHistory(state.deviceConfigHistory);
    } catch (error) {
      handleApiError(error, 'Failed loading config history');
    }
  }

  async function refreshDeviceConfigApp() {
    if (!canViewConfig()) {
      renderDeviceConfig(null);
      renderDeviceConfigHistory([]);
      return;
    }

    const deviceId = selectedConfigDeviceId();
    if (!deviceId) {
      state.deviceConfig = null;
      state.deviceConfigHistory = [];
      state.configDeviceId = null;
      renderDeviceConfig(null);
      renderDeviceConfigHistory([]);
      return;
    }

    try {
      const [config, history] = await Promise.all([
        apiRequest(`/devices/${encodeURIComponent(deviceId)}/config`, { auth: true }),
        apiRequest(`/devices/${encodeURIComponent(deviceId)}/config/history`, { auth: true })
      ]);
      if (deviceId !== state.selectedDeviceId) {
        return;
      }
      state.deviceConfig = config || null;
      state.deviceConfigHistory = Array.isArray(history) ? history : [];
      state.configDeviceId = deviceId;
      renderDeviceConfig(state.deviceConfig);
      renderDeviceConfigHistory(state.deviceConfigHistory);
    } catch (error) {
      handleApiError(error, 'Failed loading device config');
    }
  }

  async function saveDeviceConfigApp() {
    if (!canEditConfig()) {
      showToast('Your role has read-only access for configuration.', true);
      return;
    }

    const deviceId = selectedConfigDeviceId();
    if (!deviceId) {
      showToast('Select a valid location/device first.', true);
      return;
    }

    let payload;
    try {
      payload = collectDeviceConfigFromForm();
    } catch (error) {
      showToast(error.message, true);
      return;
    }
    if (!ensureCloudPushAllowed()) {
      return;
    }

    try {
      setConfigActionStatus('cloud', 'Sending save request to VPS...', 'warn');
      const response = await apiRequest(`/devices/${encodeURIComponent(deviceId)}/config`, {
        method: 'PUT',
        body: payload
      });
      showToast(`Config queued. Command: ${response.command_id || '--'}`);
      setConfigActionStatus('cloud', `Queued successfully (command ${response.command_id || '--'})`, 'good');
      await refreshDeviceConfigApp();
      if (!state.loading) {
        await refreshAppData();
      }
    } catch (error) {
      setConfigActionStatus('cloud', readableActionError(error), 'bad');
      handleApiError(error, 'Save config failed');
    }
  }

  async function pushDeviceConfigApp() {
    if (!canEditConfig()) {
      showToast('Your role has read-only access for configuration.', true);
      return;
    }

    const deviceId = selectedConfigDeviceId();
    if (!deviceId) {
      showToast('Select a valid location/device first.', true);
      return;
    }
    if (!ensureCloudPushAllowed()) {
      return;
    }

    try {
      setConfigActionStatus('cloud', 'Sending re-push request to VPS...', 'warn');
      const response = await apiRequest(`/devices/${encodeURIComponent(deviceId)}/config/push`, {
        method: 'POST',
        body: {}
      });
      showToast(`Config re-push queued. Command: ${response.command_id || '--'}`);
      setConfigActionStatus('cloud', `Re-push queued (command ${response.command_id || '--'})`, 'good');
      await refreshDeviceConfigApp();
      if (!state.loading) {
        await refreshAppData();
      }
    } catch (error) {
      setConfigActionStatus('cloud', readableActionError(error), 'bad');
      handleApiError(error, 'Config re-push failed');
    }
  }

  async function saveDeviceConfigLocalLanApp() {
    if (!canEditConfig()) {
      showToast('Your role has read-only access for configuration.', true);
      return;
    }

    const deviceId = selectedConfigDeviceId();
    if (!deviceId) {
      showToast('Select a valid location/device first.', true);
      return;
    }

    let payload;
    try {
      payload = collectDeviceConfigFromForm();
    } catch (error) {
      showToast(error.message, true);
      return;
    }

    const localPin = String(byId('cfg-local-pin')?.value || '').trim();
    if (localPin.length < 4) {
      showToast('Local Admin PIN is required for Local LAN save.', true);
      return;
    }

    const localUrl = updateLocalUrlFromState();
    if (!localUrl) {
      setConfigActionStatus('local', 'Set Device Local URL in Install tab first.', 'bad');
      showToast('Set Device Local URL in Install tab first.', true);
      return;
    }

    try {
      setConfigActionStatus('local', 'Checking device in Local LAN...', 'warn');
      let status = null;
      try {
        status = await fetchLocalDeviceStatus(localUrl);
      } catch (statusError) {
        setConfigActionStatus('local', `Status pre-check skipped (${readableActionError(statusError)}). Continuing save...`, 'warn');
      }

      if (status) {
        applyLocalStatus(status, localUrl);
        if (status?.device_id && String(status.device_id) !== String(deviceId)) {
          const mismatchMessage = `Local device mismatch. Selected ${deviceId}, local is ${status.device_id}.`;
          setConfigActionStatus('local', mismatchMessage, 'bad');
          showToast(mismatchMessage, true);
          return;
        }
      }

      const saveUrl = `${localUrl}/save-config?pin=${encodeURIComponent(localPin)}`;
      let parsed = null;
      let responseStatus = 0;
      setConfigActionStatus('local', 'Saving configuration directly on device...', 'warn');

      const nativeSave = await requestViaNativeHttp({
        url: saveUrl,
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        data: payload,
        connectTimeout: 8000,
        readTimeout: 8000,
        responseType: 'json'
      });

      if (nativeSave) {
        responseStatus = Number(nativeSave.status || 0);
        if (nativeSave.data && typeof nativeSave.data === 'object') {
          parsed = nativeSave.data;
        } else if (typeof nativeSave.data === 'string' && nativeSave.data.trim()) {
          try {
            parsed = JSON.parse(nativeSave.data);
          } catch (error) {
            parsed = null;
          }
        }
      } else {
        const t = withTimeoutMs(8000);
        let response;
        try {
          response = await fetch(saveUrl, {
            method: 'POST',
            headers: {
              'content-type': 'application/json'
            },
            body: JSON.stringify(payload),
            signal: t.controller.signal
          });
        } finally {
          t.clear();
        }

        responseStatus = Number(response.status || 0);
        const raw = await response.text();
        try {
          parsed = raw ? JSON.parse(raw) : null;
        } catch (error) {
          parsed = null;
        }
      }

      if (!(responseStatus >= 200 && responseStatus < 300) || parsed?.ok !== true) {
        throw new Error(parsed?.error || parsed?.message || `HTTP ${responseStatus || 'ERR'}`);
      }

      const cfgJsonRaw = String(parsed?.config_json || '').trim();
      if (cfgJsonRaw) {
        try {
          const cfg = JSON.parse(cfgJsonRaw);
          state.deviceConfig = {
            ...(state.deviceConfig || {}),
            ...cfg,
            state: 'ACTIVE',
            last_ack_status: 'LOCAL_SAVED',
            last_ack_at: new Date().toISOString(),
            last_ack_message: 'Saved directly on device'
          };
        } catch (error) {
          state.deviceConfig = {
            ...(state.deviceConfig || {}),
            ...payload,
            state: 'ACTIVE',
            last_ack_status: 'LOCAL_SAVED',
            last_ack_at: new Date().toISOString(),
            last_ack_message: 'Saved directly on device'
          };
        }
      }

      renderDeviceConfig(state.deviceConfig);
      await refreshLocalDeviceStatusApp(true);
      setConfigActionStatus('local', 'Saved to device NVS successfully.', 'good');
      showToast('Local LAN save successful. Configuration saved to device NVS.');
    } catch (error) {
      setConfigActionStatus('local', readableActionError(error), 'bad');
      showToast(`Local LAN save failed: ${error.message}`, true);
    }
  }

  function canVendorInstall() {
    const role = userRole();
    return role === 'VENDOR_SUPER_ADMIN' || role === 'VENDOR_MONITORING_USER';
  }

  function canOperate() {
    return ['VENDOR_SUPER_ADMIN', 'DEPARTMENT_SUPER_ADMIN', 'DEPARTMENT_ADMIN', 'OPERATOR'].includes(userRole());
  }

  function rootUrlFromApiBase() {
    const base = state.apiBase || normalizeApiBase('');
    return base.replace(/\/api$/i, '');
  }

  function defaultVpsHealthUrl() {
    const root = String(rootUrlFromApiBase() || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(root)) {
      return DEFAULT_VPS_HEALTH_URL;
    }
    return `${root}/health`;
  }

  function alternateVpsHealthUrl(healthUrl) {
    const normalized = String(healthUrl || '').trim().replace(/\/+$/, '');
    if (!normalized) {
      return '';
    }
    if (/\/api\/health$/i.test(normalized)) {
      return normalized.replace(/\/api\/health$/i, '/health');
    }
    if (/\/health$/i.test(normalized)) {
      return normalized.replace(/\/health$/i, '/api/health');
    }
    if (/\/api$/i.test(normalized)) {
      return `${normalized}/health`;
    }
    return `${normalized}/api/health`;
  }

  function isPrivateOrLocalHost(hostname) {
    const host = String(hostname || '').trim().toLowerCase();
    if (!host) {
      return true;
    }
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
      return true;
    }
    if (/^10\./.test(host) || /^192\.168\./.test(host)) {
      return true;
    }
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) {
      return true;
    }
    return false;
  }

  function resolveVpsHealthUrl() {
    try {
      const fallback = new URL(DEFAULT_VPS_HEALTH_URL);
      const auto = new URL(defaultVpsHealthUrl());
      if (isPrivateOrLocalHost(auto.hostname)) {
        return fallback.toString();
      }
      auto.protocol = 'https:';
      auto.port = '';
      auto.pathname = '/health';
      auto.search = '';
      auto.hash = '';
      return auto.toString();
    } catch (error) {
      return DEFAULT_VPS_HEALTH_URL;
    }
  }

  function vpsBaseFromHealthUrl(rawUrl) {
    const raw = String(rawUrl || '').trim();
    if (!raw) {
      return '';
    }
    try {
      const parsed = new URL(raw);
      const path = String(parsed.pathname || '').replace(/\/+$/, '');
      if (/\/api\/health$/i.test(path)) {
        parsed.pathname = path.replace(/\/api\/health$/i, '');
      } else if (/\/health$/i.test(path)) {
        parsed.pathname = path.replace(/\/health$/i, '');
      }
      if (!parsed.pathname) {
        parsed.pathname = '/';
      }
      parsed.search = '';
      parsed.hash = '';
      return parsed.toString().replace(/\/+$/, '');
    } catch (error) {
      return raw.replace(/\/+$/, '').replace(/\/api\/health$/i, '').replace(/\/health$/i, '');
    }
  }

  function hostFromUrl(rawUrl) {
    const raw = String(rawUrl || '').trim();
    if (!raw) {
      return '';
    }
    try {
      return new URL(raw).hostname || '';
    } catch (error) {
      const noScheme = raw.replace(/^https?:\/\//i, '');
      return noScheme.split('/')[0].split(':')[0].trim();
    }
  }

  function applyAdminPanelVisibility() {
    const show = Boolean(state.token && state.user && isSuperAdmin());
    ['mobile-user-admin-panel', 'loc-admin-panel', 'dash-loc-admin'].forEach((id) => {
      const el = byId(id);
      if (el) el.style.display = show ? 'block' : 'none';
    });
  }

  function applyVendorLoginFieldsVisibility() {
    const row = byId('login-vendor-fields');
    if (!row) return;
    const role = String(state.user?.role || '').toUpperCase();
    const isVendor = !role || role === 'VENDOR_SUPER_ADMIN' || role === 'VENDOR_MONITORING_USER';
    row.style.display = isVendor ? '' : 'none';
  }

  function populateRoleDropdown() {
    const select = byId('ua-role');
    if (!select) return;
    const role = userRole();
    const vendorOptions = [
      { value: 'DEPARTMENT_SUPER_ADMIN', label: 'Dept Super Admin' },
      { value: 'DEPARTMENT_ADMIN', label: 'Department Admin' },
      { value: 'LOCATION_ADMIN', label: 'Location Admin' },
      { value: 'OPERATOR', label: 'Operator' },
      { value: 'VIEWER', label: 'Viewer' },
      { value: 'AUDITOR', label: 'Auditor' },
      { value: 'VENDOR_MONITORING_USER', label: 'Vendor Monitoring' }
    ];
    const deptOptions = [
      { value: 'DEPARTMENT_ADMIN', label: 'Department Admin' },
      { value: 'LOCATION_ADMIN', label: 'Location Admin' },
      { value: 'OPERATOR', label: 'Operator' },
      { value: 'VIEWER', label: 'Viewer' },
      { value: 'AUDITOR', label: 'Auditor' }
    ];
    const options = role === 'VENDOR_SUPER_ADMIN' ? vendorOptions : deptOptions;
    select.innerHTML = options
      .map((opt) => `<option value="${escapeHtml(opt.value)}">${escapeHtml(opt.label)}</option>`)
      .join('');
  }

  function applyVendorInstallVisibility() {
    const tab = byId('vendor-install-tab');
    const installView = byId('view-install');
    const roleChip = byId('ble-role-chip');
    const enabled = canVendorInstall();

    if (tab) {
      tab.style.display = enabled ? 'inline-block' : 'none';
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
      state.ble.connectedDeviceId = '';
      state.ble.wifiNetworks = [];
      state.ble.phoneWifiSsid = '';
      state.ble.scanTriggered = false;
      state.ble.scanInProgress = false;
      state.ble.provisioningComplete = false;
      state.ble.provisionInProgress = false;
      state.ble.commandQueue = null;
      state.install.tokenExpiresAt = '';
      setBleScanProgress(false);
      renderBleDeviceList();
      renderBleWifiList();
      renderBleWifiSelect();
      setText('ble-selected-device', 'Selected: --');
      setInstallMetric('ble-app-cloud-status', '--');
      setInstallMetric('ble-device-cloud-status', '--');
      setInstallMetric('ble-device-local-status', '--');
      setText('ble-device-local-address', 'Address: --');
      renderPhoneWifiSsid();
      updateBleStatusLabel();
    }

    updateBleProvisionSectionVisibility();
    updateNavButtonCount();
  }

  function applyConfigVisibility() {
    const canView = canViewConfig();
    const tab = byId('config-tab');
    const configView = byId('view-config');
    if (tab) {
      tab.style.display = canView ? 'inline-block' : 'none';
    }
    if (configView) {
      configView.style.display = canView ? '' : 'none';
    }

    if (!canView && byId('view-config')?.classList.contains('active')) {
      openView('view-locations');
    }

    updateNavButtonCount();
  }

  function applySettingsVisibility() {
    const tab = byId('settings-tab');
    const isLoggedIn = Boolean(state.token && state.user);
    if (tab) {
      tab.style.display = isLoggedIn ? 'inline-block' : 'none';
    }
    const userInfo = byId('settings-user-info');
    if (userInfo && state.user) {
      userInfo.textContent = `Logged in as: ${state.user.name || state.user.login_id || '--'} (${state.user.role || 'UNKNOWN'})`;
    }
    updateNavButtonCount();
  }

  function updateNavButtonCount() {
    const nav = byId('bottom-nav');
    if (!nav) {
      return;
    }
    const visibleButtons = Array.from(nav.querySelectorAll('.nav-btn'))
      .filter((btn) => btn.style.display !== 'none');
    visibleButtons.forEach((btn, idx) => {
      btn.classList.toggle('nav-btn-overflow-hidden', idx >= MAX_BOTTOM_PRIMARY_TABS);
    });
    const visibleCount = visibleButtons
      .filter((btn) => !btn.classList.contains('nav-btn-overflow-hidden'))
      .length;
    nav.style.setProperty('--nav-count', String(Math.max(1, visibleCount)));
    renderHeaderMenu();
  }

  function renderLocations() {
    const list = byId('location-list');
    if (!list) {
      return;
    }

    // Pending bind banner
    const pendingDeviceId = String(state.install?.pendingBindDeviceId || '').trim();
    const banner = byId('pending-bind-banner');
    if (banner) {
      if (pendingDeviceId) {
        setText('pending-bind-device-label', pendingDeviceId);
        banner.style.display = 'flex';
      } else {
        banner.style.display = 'none';
      }
    }

    setText('location-count', `${state.locations.length} sites`);

    if (state.locations.length === 0) {
      list.innerHTML = '<div class="empty">No locations assigned for this login.</div>';
      return;
    }

    list.innerHTML = state.locations.map((loc) => {
      const meta = statusMeta(loc.status);
      const selected = loc.location_id === state.selectedLocationId;
      const levelRaw = Number.isFinite(loc.water_level_mm) ? Math.round(loc.water_level_mm) : null;
      const levelStr = levelRaw !== null ? String(levelRaw) : '--';

      // Online dot
      const deviceId = loc.device_id || '';
      const devStatus = String(loc.device_status || 'UNKNOWN').toUpperCase();
      const isOnline = devStatus === 'ONLINE';
      const isWarn = !isOnline && devStatus !== 'OFFLINE' && devStatus !== 'UNKNOWN';
      const dotCls = deviceId ? (isOnline ? 'online' : (isWarn ? 'warn' : 'offline')) : 'offline';

      // Mini vessel fill
      const mountRef = Number(loc.sensor_mount_height_mm || 1000);
      const fillPct = levelRaw !== null ? Math.max(0, Math.min(100, (levelRaw / mountRef) * 100)).toFixed(1) : '0';
      const fillColor = meta.cls === 'danger'
        ? 'linear-gradient(0deg,#b91c1c,#ef4444)'
        : meta.cls === 'warn'
          ? 'linear-gradient(0deg,#b45309,#f59e0b)'
          : meta.cls === 'ok'
            ? 'linear-gradient(0deg,#047857,#34d399)'
            : 'linear-gradient(0deg,#64748b,#94a3b8)';

      // Status chip class
      const chipCls = meta.cls === 'danger' ? ' danger' : meta.cls === 'warn' ? ' warn' : meta.cls === 'off' ? ' off' : '';

      // Device pill — show device ID + status if bound, or bind button if unbound (super admin)
      const devPillCls = isOnline ? 'loc-dev-pill--online' : 'loc-dev-pill--offline';
      let deviceSection = '';
      if (deviceId) {
        deviceSection = `<span class="loc-dev-pill ${devPillCls}" title="Device ID: ${escapeHtml(deviceId)}">${escapeHtml(deviceId)} · ${escapeHtml(devStatus)}</span>`;
      } else if (isSuperAdmin()) {
        deviceSection = `<span class="loc-bind-btn" onclick="event.stopPropagation();toggleInlineBindApp('${escapeHtml(loc.location_id)}')" title="Bind a device to this location">Bind Device</span>`;
      } else {
        deviceSection = `<span class="loc-dev-pill loc-dev-pill--offline">NO DEVICE</span>`;
      }

      // Complaint badge
      const complaintCount = Number(loc.open_complaint_count || 0);
      const complaintBadge = complaintCount > 0
        ? `<span class="loc-complaint-pill">${complaintCount} open</span>`
        : '';

      // Lifecycle badge (FAULTY / UNDER_REPLACEMENT etc.)
      const opStatus = String(loc.operational_status || 'ACTIVE').toUpperCase();
      const lifecycleBadge = opStatus !== 'ACTIVE'
        ? `<span class="loc-lifecycle-pill loc-lifecycle-pill--${escapeHtml(opStatus.toLowerCase())}">${opStatus === 'UNDER_REPLACEMENT' ? 'UNDER REPAIR' : escapeHtml(opStatus)}</span>`
        : '';

      // Inline bind panel (only for unbound locations, super admin)
      const pendingId = String(state.install?.pendingBindDeviceId || '').trim();
      const panelOpenByDefault = !deviceId && isSuperAdmin() && Boolean(pendingId);
      const bindPanel = (!deviceId && isSuperAdmin()) ? `
        <div class="loc-bind-panel" id="bind-panel-${escapeHtml(loc.location_id)}" style="${panelOpenByDefault ? '' : 'display:none'}">
          <div class="loc-bind-panel-inner">
            <span class="loc-bind-panel-label">Bind device to <strong>${escapeHtml(loc.location_name || loc.location_id)}</strong></span>
            <div class="loc-bind-row">
              <select class="inp loc-bind-select" id="bind-sel-${escapeHtml(loc.location_id)}">
                <option value="">Select free device…</option>
                ${(state.adminDevices || []).filter((d) => !d.location_id).map((d) => `<option value="${escapeHtml(d.device_id)}"${pendingId && d.device_id === pendingId ? ' selected' : ''}>${escapeHtml(d.device_id)}${d.status ? ' (' + String(d.status).toUpperCase() + ')' : ''}</option>`).join('')}
              </select>
              <span class="loc-bind-or">or</span>
              <input class="inp loc-bind-input" id="bind-inp-${escapeHtml(loc.location_id)}" placeholder="Type Device ID…" value="${escapeHtml(pendingId)}" oninput="document.getElementById('bind-sel-${escapeHtml(loc.location_id)}').value=''">
              <button class="loc-bind-apply-btn" onclick="applyBindFromCardApp('${escapeHtml(loc.location_id)}')">Apply</button>
            </div>
          </div>
        </div>` : '';

      const deleteBtn = isSuperAdmin() ? `
        <div style="text-align:right;padding:4px 0 2px">
          <button class="ghost-btn" style="padding:4px 10px;font-size:11px;color:#b91c1c;border-color:#fca5a5"
            onclick="event.stopPropagation();deleteLocationApp('${escapeHtml(loc.location_id)}','${escapeHtml(loc.location_name || loc.location_id)}',${deviceId ? `'${escapeHtml(deviceId)}'` : 'null'})">
            Delete Location
          </button>
        </div>` : '';

      return `
        <div class="loc-item">
          <button class="loc-card${selected ? ' sel' : ''}${!deviceId ? ' loc-card--unbound' : ''}" onclick="selectLocation('${escapeHtml(loc.location_id)}')">
            <div class="loc-card-top">
              <div class="loc-name-row">
                <span class="loc-dot loc-dot--${dotCls}"></span>
                <div>
                  <div class="loc-name">${escapeHtml(loc.location_name || loc.location_id)}</div>
                  <div class="loc-id">${escapeHtml(loc.location_id)}</div>
                </div>
              </div>
              <span class="chip${chipCls}">${escapeHtml(meta.label)}</span>
            </div>
            <div class="loc-card-body">
              <div class="loc-vessel-mini">
                <div class="loc-vessel-fill-mini" style="height:${fillPct}%;background:${fillColor}"></div>
              </div>
              <div class="loc-stats">
                <div class="loc-level-row">
                  <span class="loc-level-num">${escapeHtml(levelStr)}</span>
                  <span class="loc-level-unit">mm</span>
                </div>
                <div class="loc-pill-row">
                  ${deviceSection}
                  ${complaintBadge}
                  ${lifecycleBadge}
                </div>
                <div class="loc-meta">Updated ${escapeHtml(formatTime(loc.last_update))}</div>
              </div>
            </div>
          </button>
          ${bindPanel}
          ${deleteBtn}
        </div>
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
    state.latestTelemetry = latest;
    const meta = statusMeta(latest?.status || location?.status || 'OFFLINE');
    const waterLevel = Number.isFinite(latest?.water_level_mm) ? Math.round(latest.water_level_mm) : 0;
    const distance = Number.isFinite(latest?.distance_mm) ? Math.round(latest.distance_mm) : 0;
    const liveConfig = latest?.config || state.deviceConfig || {};
    const alertLevel = Number(liveConfig.alert_level_mm ?? 200);
    const dangerLevel = Number(liveConfig.danger_level_mm ?? 500);
    const mountHeight = Number(liveConfig.sensor_mount_height_mm || dashboardData?.location?.sensor_mount_height_mm || 1200);
    const fillPercent = Math.max(0, Math.min(100, (waterLevel / mountHeight) * 100));

    setText('dash-location-name', location?.location_name || location?.location_id || '--');
    setText('dash-location-sub', `Device: ${location?.device_id || '--'} · Last update ${formatDateTime(latest?.timestamp || location?.last_update)}`);

    setText('dash-status-note', `Status note: ${latest?.status_note || 'No note available'}`);

    const badge = byId('dash-status-badge');
    if (badge) {
      badge.textContent = meta.label;
      badge.classList.remove('danger', 'warn', 'off');
      if (meta.cls === 'danger') badge.classList.add('danger');
      else if (meta.cls === 'warn') badge.classList.add('warn');
      else if (meta.cls === 'off') badge.classList.add('off');
    }

    setText('dash-water-level', String(waterLevel));
    setText('dash-distance', `Distance: ${distance} mm`);
    setText('dash-battery', Number.isFinite(latest?.battery_voltage) ? `${latest.battery_voltage.toFixed(1)}V` : '--');
    setText('dash-solar', Number.isFinite(latest?.solar_voltage) ? `${latest.solar_voltage.toFixed(1)}V` : '--');
    setText('dash-rssi', Number.isFinite(latest?.wifi_rssi) ? `${Math.round(latest.wifi_rssi)} dBm` : '--');
    setText('dash-heartbeat', String(location?.device_status || 'UNKNOWN').toUpperCase());
    setText('dash-rs485-status', String(latest?.rs485_status || latest?.primary_sensor_status || '--').toUpperCase());
    setText('dash-switch-l1', latest?.switch_level_1_closed === true || latest?.switch_300mm === true ? 'CLOSED' : 'OPEN');
    setText('dash-switch-l2', latest?.switch_level_2_closed === true || latest?.switch_500mm === true ? 'CLOSED' : 'OPEN');
    const rs485Enabled = latest?.rs485_sensor_enabled ?? liveConfig.rs485_sensor_enabled;
    const switchEnabled = latest?.switch_sensor_enabled ?? liveConfig.switch_sensor_enabled;
    const logicMode = rs485Enabled && switchEnabled ? 'Dual-sensor mode' : (rs485Enabled ? 'RS485 only' : 'Switch only');
    setText('dash-logic-mode', logicMode);
    setText('control-user-role', `Logged in as: ${state.user?.name || state.user?.login_id || '--'} (${state.user?.role || 'UNKNOWN'})`);
    applyAdminPanelVisibility();
    if (isSuperAdmin()) {
      const loc = state.locations.find((l) => l.location_id === state.selectedLocationId);
      const nameEl = byId('dash-loc-name');
      if (nameEl) nameEl.value = loc?.location_name || loc?.name || '';
      const descEl = byId('dash-loc-desc');
      if (descEl) descEl.value = loc?.description || '';
      const mountEl = byId('dash-loc-mount');
      if (mountEl) mountEl.value = loc?.sensor_mount_height_mm || '';
      setText('dash-device-bound-info', `Bound Device: ${state.selectedDeviceId || 'None'}`);
      setText('dash-bind-status', '');
      setText('dash-loc-save-status', '');
    }
    applyVendorInstallVisibility();
    applyConfigVisibility();
    applySettingsVisibility();
    applyComplaintsVisibility();
    applyReportsVisibility();
    applyUsersTabVisibility();
    applyVendorsTabVisibility();
    renderInstallCloudStatuses();

    const fill = byId('vessel-fill');
    if (fill) {
      fill.style.height = `${fillPercent.toFixed(1)}%`;
      fill.style.background = meta.cls === 'danger'
        ? 'linear-gradient(0deg,#b91c1c,#ef4444)'
        : meta.cls === 'warn'
          ? 'linear-gradient(0deg,#b45309,#f59e0b)'
          : 'linear-gradient(0deg,#047857,#34d399)';
    }

    const alertMarker = byId('dash-marker-alert');
    const dangerMarker = byId('dash-marker-danger');
    const alertBottom = Math.max(0, Math.min(100, (alertLevel / mountHeight) * 100));
    const dangerBottom = Math.max(0, Math.min(100, (dangerLevel / mountHeight) * 100));
    if (alertMarker) {
      alertMarker.textContent = `${Math.round(alertLevel)}mm`;
      alertMarker.style.bottom = `${alertBottom.toFixed(1)}%`;
    }
    if (dangerMarker) {
      dangerMarker.textContent = `${Math.round(dangerLevel)}mm`;
      dangerMarker.style.bottom = `${dangerBottom.toFixed(1)}%`;
    }

    // Device lifecycle banner + actions
    renderLifecycleBanner(location);

    // Live status dot
    const liveDot = byId('dash-live-dot');
    if (liveDot) {
      const devOnline = String(location?.device_status || '').toUpperCase() === 'ONLINE';
      liveDot.className = 'live-dot ' + (
        !devOnline ? 'live-dot--offline' :
        meta.cls === 'danger' ? 'live-dot--danger' :
        meta.cls === 'warn' ? 'live-dot--warn' :
        'live-dot--online'
      );
    }

    // SW1 threshold marker (dynamic position)
    const sw1Level = Number(liveConfig.switch_level_1_mm || 300);
    const sw1Bottom = Math.max(2, Math.min(95, (sw1Level / mountHeight) * 100));
    const sw1Marker = byId('dash-marker-sw1');
    if (sw1Marker) {
      sw1Marker.textContent = `${sw1Level}mm`;
      sw1Marker.style.bottom = `${sw1Bottom.toFixed(1)}%`;
    }

    // Relay/output indicators
    const outputs = latest?.outputs || {};
    const relayStates = {
      siren:   Boolean(outputs.siren   ?? latest?.relay_siren   ?? latest?.siren_active   ?? false),
      beacon:  Boolean(outputs.beacon  ?? latest?.relay_beacon  ?? latest?.beacon_active  ?? false),
      voice:   Boolean(outputs.voice   ?? latest?.relay_voice   ?? latest?.voice_active   ?? false),
      barrier: Boolean(outputs.barrier ?? latest?.relay_barrier ?? false)
    };
    Object.entries(relayStates).forEach(([key, isOn]) => {
      const item = byId(`relay-item-${key}`);
      const status = byId(`relay-${key}`);
      if (item) item.classList.toggle('relay-on', isOn);
      if (status) status.textContent = latest ? (isOn ? 'ON' : 'OFF') : '--';
    });

    // Quick controls visibility (OPERATOR+ roles)
    const qc = byId('dash-quick-controls');
    if (qc) qc.style.display = canOperate() ? 'block' : 'none';

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
      if (log.details?.reason) details.push(`Reason: ${log.details.reason}`);
      if (log.details?.command_id) details.push(`Cmd: ${log.details.command_id}`);
      if (log.details?.level) details.push(`Level: ${log.details.level}`);
      if (log.details?.water_level_mm != null) details.push(`Water: ${Math.round(log.details.water_level_mm)}mm`);
      const deviceId = log.details?.device_id || null;
      const locationLine = [log.location_id, deviceId].filter(Boolean).join(' · ');
      return `
        <div class="audit-item">
          <div class="audit-event">${escapeHtml(String(log.event_type || 'EVENT').toUpperCase())}</div>
          ${locationLine ? `<div class="audit-detail" style="color:#3949ab;font-size:12px">${escapeHtml(locationLine)}</div>` : ''}
          <div class="audit-detail">${escapeHtml(details.join(' | ') || 'Action logged')}</div>
          <div class="audit-time">${escapeHtml(formatDateTime(log.timestamp))} IST · ${escapeHtml(log.login_id || 'System')}</div>
        </div>
      `;
    }).join('');
  }

  function renderAdminUsersApp(users) {
    const list = byId('user-list');
    if (!list) return;

    const roleFilter = String(byId('user-filter-role')?.value || '');
    const statusFilter = String(byId('user-filter-status')?.value || '');

    let filtered = Array.isArray(users) ? users : [];
    if (roleFilter) filtered = filtered.filter((u) => u.role === roleFilter);
    if (statusFilter === 'active') filtered = filtered.filter((u) => u.is_active);
    if (statusFilter === 'inactive') filtered = filtered.filter((u) => !u.is_active);

    if (filtered.length === 0) {
      list.innerHTML = '<div class="empty">No users match the current filter.</div>';
      return;
    }

    list.innerHTML = filtered.map((user) => {
      const userId = escapeHtml(String(user.user_id || ''));
      const loginId = escapeHtml(user.login_id || '--');
      const name = escapeHtml(user.name || '--');
      const role = escapeHtml(String(user.role || 'UNKNOWN').toUpperCase());
      const roleClass = String(user.role || '').toLowerCase().replace(/_/g, '-');
      const isActive = Boolean(user.is_active);
      const sessions = Number(user.active_session_count ?? 0);
      const locs = Array.isArray(user.assigned_locations) && user.assigned_locations.length
        ? user.assigned_locations.map((l) => `<span class="user-loc-pill">${escapeHtml(l)}</span>`).join('')
        : '<span class="user-loc-none">No locations assigned</span>';

      return `
        <div class="user-card">
          <div class="user-card-head">
            <div>
              <div class="user-login-id">${loginId}</div>
              <div class="user-full-name">${name}</div>
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
              <span class="user-role-badge user-role-badge--${escapeHtml(roleClass)}">${role}</span>
              <span class="chip ${isActive ? '' : 'danger'}" style="font-size:10px">${isActive ? 'ACTIVE' : 'INACTIVE'}</span>
            </div>
          </div>
          <div class="user-meta-row">Sessions: ${sessions} · ${locs}</div>
          <div class="row" style="margin-top:8px;justify-content:flex-end;gap:6px">
            <button class="ghost-btn" style="padding:5px 10px;font-size:11px"
              onclick="toggleAdminUserAccessApp('${userId}', ${isActive ? 'false' : 'true'})">
              ${isActive ? 'Set Inactive' : 'Set Active'}
            </button>
            <button class="ghost-btn" style="padding:5px 10px;font-size:11px"
              onclick="toggleResetPwFormApp('${userId}')">Reset PW</button>
          </div>
          <div id="reset-pw-wrap-${userId}" class="user-reset-pw-wrap" style="display:none">
            <input class="inp" id="reset-pw-input-${userId}" type="password"
              placeholder="New password (min 6 chars)" style="margin-top:6px;font-size:13px">
            <button class="ghost-btn" style="margin-top:4px;width:100%;font-size:12px"
              onclick="submitResetPasswordApp('${userId}')">Confirm Reset Password</button>
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

  async function selectBleDeviceApp(deviceId) {
    state.ble.selectedDeviceId = String(deviceId || '');
    const selected = findSelectedBleDevice();
    setText(
      'ble-selected-device',
      selected ? `Selected: ${selected.name || selected.deviceId}` : 'Selected: tap a BLE device to continue'
    );
    renderBleDeviceList();
    updateBleStatusLabel();
    updateBleProvisionSectionVisibility();
    populateBleTargetLocationSection();

    const section = byId('ble-wifi-provision-section');
    if (section && section.style.display !== 'none') {
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    if (!selected) {
      return;
    }

    renderBleWifiList();
    renderBleWifiSelect();

    const preferred = choosePreferredSsid(
      state.ble.wifiNetworks.map((item) => String(item?.ssid || '').trim()),
      String(state.ble.phoneWifiSsid || '').trim()
    );
    if (preferred) {
      setBleWifiSsidValue(preferred);
    }
    showToast('Device selected. Enter Wi-Fi password and tap Apply.');
  }

  function pickBleWifiSsidApp(ssid) {
    setBleWifiSsidValue(ssid);
  }

  async function bleScanDevicesApp() {
    if (!canVendorInstall()) {
      showToast('Vendor login is required for BLE provisioning.', true);
      return;
    }

    state.ble.scanTriggered = true;
    state.ble.provisioningComplete = false;
    state.ble.scanResults = [];
    state.ble.selectedDeviceId = '';
    state.ble.connectedDeviceId = '';
    state.ble.wifiNetworks = [];
    state.ble.commandQueue = null;
    state.ble.phoneWifiSsid = readPhoneWifiSsid();
    renderPhoneWifiSsid();
    setText('ble-selected-device', 'Selected: tap a BLE device to continue');
    renderBleDeviceList();
    renderBleWifiList();
    renderBleWifiSelect();
    setBleOutputs(null, 'No provisioning response yet.');
    updateBleStatusLabel();
    updateBleProvisionSectionVisibility();
    setBleScanProgress(true, 'Scanning BLE...');
    renderBleDeviceList();

    try {
      const ble = await ensureBleReady();
      const discovered = new Map();
      const isLikelyFloodGuard = (result, name) => {
        const upperName = String(name || '').toUpperCase();
        if (upperName.startsWith(BLE_NAME_PREFIX) || upperName.includes('JNX-FG') || upperName.includes('FLOODGUARD')) {
          return true;
        }
        const serviceIds = []
          .concat(Array.isArray(result?.uuids) ? result.uuids : [])
          .concat(Array.isArray(result?.serviceUuids) ? result.serviceUuids : [])
          .map((item) => String(item || '').toLowerCase());
        return serviceIds.some((id) => id.includes('ff00'));
      };

      const runScanPass = async (scanOptions, strictPrefixOnly) => {
        const listener = await ble.addListener('onScanResult', (result) => {
          const deviceId = String(result?.device?.deviceId || '').trim();
          if (!deviceId) {
            return;
          }
          const rawName = String(normalizeDeviceName(result) || '').trim();
          const upperName = rawName.toUpperCase();
          const likely = isLikelyFloodGuard(result, rawName);
          if (strictPrefixOnly && !upperName.startsWith(BLE_NAME_PREFIX)) {
            return;
          }
          if (!strictPrefixOnly && !likely) {
            return;
          }
          const fallbackName = rawName && rawName !== 'Unknown'
            ? rawName
            : (likely ? `JNX-FG-${deviceId.slice(-4).toUpperCase()}` : deviceId);
          discovered.set(deviceId, {
            deviceId,
            name: fallbackName,
            rssi: Number.isFinite(result?.rssi) ? Math.round(result.rssi) : null
          });
        });

        try {
          await ble.requestLEScan(scanOptions);
          await delay(7000);
        } finally {
          try {
            await ble.stopLEScan();
          } catch (error) {
            // ignore stop errors
          }
          await listener.remove();
        }
      };

      setInstallMetric('ble-link-status', 'SCANNING...', 'warn');
      await runScanPass({ namePrefix: BLE_NAME_PREFIX, allowDuplicates: false }, true);
      if (discovered.size === 0) {
        setInstallMetric('ble-link-status', 'RETRYING...', 'warn');
        setBleScanProgress(true, 'Retrying BLE scan...');
        await runScanPass({ allowDuplicates: false }, false);
      }

      state.ble.scanResults = Array.from(discovered.values()).sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999));
      state.ble.selectedDeviceId = '';
      setText(
        'ble-selected-device',
        state.ble.scanResults.length > 0
          ? 'Selected: tap a BLE device to continue'
          : 'Selected: --'
      );
      updateBleStatusLabel();
      renderBleDeviceList();
      updateBleProvisionSectionVisibility();
      showToast(state.ble.scanResults.length > 0 ? `Found ${state.ble.scanResults.length} BLE device(s). Tap a device card to select.` : 'No BLE device found.');
    } catch (error) {
      setInstallMetric('ble-link-status', 'SCAN FAILED', 'bad');
      state.ble.scanResults = [];
      state.ble.selectedDeviceId = '';
      updateBleProvisionSectionVisibility();
      showToast(`BLE scan failed: ${error.message}`, true);
    } finally {
      setBleScanProgress(false);
    }
  }

  async function bleDisconnectApp() {
    const deviceId = state.ble.connectedDeviceId;
    if (!deviceId) {
      updateBleStatusLabel();
      return;
    }

    try {
      const ble = await ensureBleReady();
      await ble.disconnect({ deviceId, timeout: 6000 });
    } catch (error) {
      // best effort
    } finally {
      state.ble.connectedDeviceId = '';
      updateBleStatusLabel();
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
      const vpsUrl = resolveVpsHealthUrl();
      const response = await bleSendCommand({
        cmd: 'health',
        vps_url: vpsUrl,
        check_vps: true
      });
      setBleOutputs(prettyJson(response), null);
      applyVoltageSettingsFromPayload(response);
      syncVoltageInputsFromState();
      updateBleStatusLabel();
      if (response?.vps && typeof response.vps.reachable === 'boolean') {
        state.install.deviceCloudReachable = response.vps.reachable;
        setInstallMetric('ble-device-cloud-status', response.vps.reachable ? 'UP' : 'DOWN', response.vps.reachable ? 'good' : 'bad');
      } else if (typeof response?.mqtt_connected === 'boolean') {
        state.install.deviceCloudReachable = response.mqtt_connected;
        setInstallMetric('ble-device-cloud-status', response.mqtt_connected ? 'UP' : 'DOWN', response.mqtt_connected ? 'good' : 'bad');
      }
      const localUrl = updateLocalUrlFromState(response?.ip || '');
      if (localUrl) {
        applyLocalStatus(response, localUrl);
      }
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
      const phoneSsid = readPhoneWifiSsid();
      state.ble.phoneWifiSsid = phoneSsid;
      renderPhoneWifiSsid();
      const response = await bleSendCommand({ cmd: 'scan_wifi' });
      state.ble.wifiNetworks = Array.isArray(response.networks) ? response.networks : [];
      renderBleWifiList();
      renderBleWifiSelect();
      const preferred = choosePreferredSsid(
        state.ble.wifiNetworks.map((item) => String(item?.ssid || '').trim()),
        String(state.ble.phoneWifiSsid || '').trim()
      );
      if (preferred) {
        setBleWifiSsidValue(preferred);
      }
      if (state.ble.wifiNetworks.length > 0 && byId('ble-wifi-ssid-select')) {
        byId('ble-wifi-ssid-select').focus();
      }
      if (state.ble.phoneWifiSsid) {
        showToast(`Wi-Fi scan complete (${state.ble.wifiNetworks.length} network(s)). Phone Wi-Fi: ${state.ble.phoneWifiSsid}`);
      } else {
        showToast(`Wi-Fi scan complete (${state.ble.wifiNetworks.length} network(s)).`);
      }
    } catch (error) {
      showToast(`Wi-Fi scan failed: ${error.message}`, true);
    }
  }

  async function bleProvisionWifiApp() {
    if (!canVendorInstall()) {
      showToast('Vendor login is required for BLE provisioning.', true);
      return;
    }

    const suggestedSsid = choosePreferredSsid(
      state.ble.wifiNetworks.map((item) => String(item?.ssid || '').trim()),
      String(state.ble.phoneWifiSsid || '').trim()
    );
    if (!String(byId('ble-wifi-ssid')?.value || '').trim() && suggestedSsid) {
      setBleWifiSsidValue(suggestedSsid);
    }

    const ssid = String(byId('ble-wifi-ssid')?.value || '').trim();
    const password = String(byId('ble-wifi-password')?.value || '');
    const vpsUrl = resolveVpsHealthUrl();
    const provisionKey = String(byId('ble-provision-key')?.value || state.install.provisionKey || '').trim();
    state.install.provisionKey = provisionKey;
    saveSession();
    console.log(`[FG][PROVISION] apply tapped ssid=${ssid || '-'} vps=${vpsUrl || '-'}`);

    if (!ssid) {
      showToast('SSID not detected. Scan Wi-Fi once and retry.', true);
      return;
    }
    let voltageSettings;
    try {
      voltageSettings = readVoltageSettingsFromForm();
    } catch (error) {
      showToast(error.message, true);
      return;
    }

    const provisionBtn = byId('ble-provision-btn');
    if (provisionBtn) {
      provisionBtn.disabled = true;
    }
    state.ble.provisionInProgress = true;
    // Reset transient cloud flag for this provisioning run.
    state.install.deviceCloudReachable = false;
    updateBleStatusLabel();
    updateBleProvisionSectionVisibility();
    showToast('Starting provisioning...');
    startProvisionModal(ssid);

    let activeStep = 1;
    try {
      const preProvisionBackendUpdateMs = Number(new Date(selectedLocationRecord()?.last_update || 0).getTime()) || 0;
      await delay(220);
      let provisionProfile = null;
      let cloudVpsUrl = vpsBaseFromHealthUrl(vpsUrl) || String(vpsUrl || '').trim();
      let cloudVpsProbeUrl = String(vpsUrl || '').trim() || cloudVpsUrl;
      let mqttHost = hostFromUrl(cloudVpsUrl);
      let mqttPort = 1883;
      let mqttUser = '';
      let mqttPassword = '';
      let shouldSendMqttAuth = false;

      if (provisionKey) {
        setProvisionStep(1, 'active', 'Using provision key for device registration...');
        state.install.tokenExpiresAt = '';
        setProvisionStep(1, 'done', 'Provision key ready. Device will fetch x-device-key from VPS.');
      } else {
        const targetLocId = String(byId('ble-target-location-select')?.value || '').trim();
        if (targetLocId) {
          throw new Error('Provision Key is required to register a new device. Enter it in the "Provision Key" field.');
        }
        setProvisionStep(1, 'active', 'Provision key missing. Falling back to cloud token profile...');
        provisionProfile = await requestDeviceProvisionProfile();
        const cloud = provisionProfile?.cloud || {};
        cloudVpsUrl = String(cloud.vps_base_url || cloudVpsUrl || vpsUrl || '').trim() || cloudVpsUrl || vpsUrl;
        cloudVpsProbeUrl = String(cloud.vps_check_url || cloudVpsUrl || cloudVpsProbeUrl || '').trim() || cloudVpsUrl;
        mqttHost = String(cloud?.mqtt?.host || mqttHost || '').trim() || mqttHost;
        mqttPort = Number(cloud?.mqtt?.port || mqttPort || 1883);
        mqttUser = String(cloud?.mqtt?.username || '').trim();
        mqttPassword = String(cloud?.mqtt?.password || provisionProfile?.device_token || '').trim();
        const mqttAuthMode = String(cloud?.mqtt?.auth_mode || '').trim().toLowerCase();
        shouldSendMqttAuth = mqttAuthMode === 'token'
          || mqttAuthMode === 'credentials'
          || mqttAuthMode === 'password'
          || Boolean(mqttUser || mqttPassword);
        state.install.tokenExpiresAt = String(provisionProfile?.token_expires_at || '').trim();
        const expiryLabel = state.install.tokenExpiresAt ? formatDateTime(state.install.tokenExpiresAt) : '--';
        setProvisionStep(1, 'done', `Token ready (expires ${expiryLabel}).`);
      }
      activeStep = 2;
      setProvisionStep(2, 'active', `Checking current Wi-Fi state for "${ssid}"...`);

      let wifiResponse = null;
      let reusedWifiSession = false;
      let currentWifiSsid = '';
      try {
        const healthResponse = await bleSendCommand(
          { cmd: 'health', check_vps: false },
          {
            expectCmd: 'health',
            maxWaitMs: 12000,
            readTimeoutMs: 4500,
            initialDelayMs: 300,
            pollIntervalMs: 500
          }
        );
        currentWifiSsid = String(healthResponse?.wifi_ssid || '').trim();
        const alreadyConnected = healthResponse?.wifi_connected === true;
        const sameSsid = !currentWifiSsid || currentWifiSsid === ssid;
        if (alreadyConnected && sameSsid) {
          reusedWifiSession = true;
          wifiResponse = healthResponse;
          // WiFi already connected — hide steps 1 & 2 and go straight to cloud step
          const s1 = byId('prov-step-1');
          const s2 = byId('prov-step-2');
          if (s1) s1.style.display = 'none';
          if (s2) s2.style.display = 'none';
          setProvisionModalNote(`Wi-Fi already connected${currentWifiSsid ? ` (${currentWifiSsid})` : ''}. Applying cloud profile...`);
        }
      } catch (error) {
        // Health pre-check is best effort; continue with explicit Wi-Fi command.
      }

      if (!wifiResponse) {
        setProvisionStep(2, 'active', `Connecting to "${ssid}"...`);
        const commandPayload = {
          cmd: 'w',
          s: ssid,
          p: password
        };
        wifiResponse = await bleSendCommand(commandPayload, {
          expectCmd: 'w',
          maxWaitMs: 50000,
          readTimeoutMs: 6000,
          initialDelayMs: 500,
          pollIntervalMs: 700
        });
      }
      setBleOutputs(null, prettyJson(wifiResponse));
      applyVoltageSettingsFromPayload(wifiResponse);
      syncVoltageInputsFromState();
      updateBleStatusLabel();
      const localUrl = updateLocalUrlFromState(wifiResponse?.ip || '');
      if (localUrl) {
        applyLocalStatus(wifiResponse, localUrl);
      }

      const wifiConnected = (wifiResponse?.wifi_connected === true) || (wifiResponse?.wc === true);
      if (wifiConnected) {
        const ipText = String(wifiResponse?.ip || '').trim();
        if (reusedWifiSession) {
          setProvisionStep(2, 'done', ipText ? `Already connected. IP ${ipText}` : 'Already connected.');
        } else {
          setProvisionStep(2, 'done', ipText ? `Connected. IP ${ipText}` : 'Connected.');
        }
        setLocalCheckButtonAttention(true);
      } else {
        const wifiStatusCode = Number.isFinite(Number(wifiResponse?.wifi_status))
          ? Number(wifiResponse?.wifi_status)
          : Number(wifiResponse?.ws);
        const statusTextRaw = String(wifiResponse?.wifi_status_text || '').trim();
        const wifiStatusText = statusTextRaw || wifiStatusTextFromCode(wifiStatusCode);
        const statusLabel = wifiStatusText
          ? `${wifiStatusText}${Number.isFinite(wifiStatusCode) ? ` (${wifiStatusCode})` : ''}`
          : (Number.isFinite(wifiStatusCode) ? `STATUS_${wifiStatusCode}` : 'UNKNOWN');
        setProvisionFinalStepTitle('failed');
        setProvisionStep(2, 'error', `Device could not join Wi-Fi (${statusLabel}). Check SSID/password and 2.4GHz.`);
        setProvisionStep(3, 'error', 'Skipped because Wi-Fi is not connected.');
        setProvisionStep(4, 'error', 'Provision failed.');
        setProvisionModalNote('Provision failed at Wi-Fi step.');
        setProvisionCloseEnabled(true);
        showToast('Provisioning failed: device not connected to Wi-Fi.', true);
        return;
      }

      activeStep = 3;
      // Brief settling delay after WiFi radio activity before next BLE command
      if (!reusedWifiSession) {
        await delay(1500);
      }
      setProvisionStep(3, 'active', 'Applying cloud profile...');

      const cloudCommandPayload = {
        cmd: 'c',
        u: cloudVpsUrl,
        vu: cloudVpsProbeUrl,
        // Avoid long blocking probe inside BLE command; we verify cloud in following checks.
        cv: false,
        ar: voltageSettings.divider,
        ac: voltageSettings.calibration
      };
      if (provisionKey) {
        cloudCommandPayload.pk = provisionKey;
      } else if (provisionProfile?.device_token) {
        cloudCommandPayload.t = provisionProfile.device_token;
      }
      if (mqttHost) {
        cloudCommandPayload.mh = mqttHost;
      }
      if (Number.isFinite(mqttPort) && mqttPort > 0) {
        cloudCommandPayload.mp = mqttPort;
      }
      if (shouldSendMqttAuth && mqttUser) {
        cloudCommandPayload.mu = mqttUser;
      }
      if (shouldSendMqttAuth && mqttPassword) {
        cloudCommandPayload.mw = mqttPassword;
      }
      const cloudDebugPayload = { ...cloudCommandPayload };
      if (cloudDebugPayload.t) {
        cloudDebugPayload.t = '***';
      }
      if (cloudDebugPayload.pk) {
        cloudDebugPayload.pk = '***';
      }
      if (cloudDebugPayload.mw) {
        cloudDebugPayload.mw = '***';
      }
      console.log(`[FG][PROVISION] cloud command ${prettyJson(cloudDebugPayload)}`);

      let cloudResponse = null;
      let cloudCommandError = null;
      try {
        cloudResponse = await bleSendCommand(cloudCommandPayload, {
          expectCmd: 'c',
          maxWaitMs: 45000,
          readTimeoutMs: 6500,
          initialDelayMs: 450,
          pollIntervalMs: 700
        });
      } catch (error) {
        cloudCommandError = error;
      }

      let cloudReachable = false;
      let cloudNote = 'No cloud status from device.';
      let hasVpsFlag = false;
      let cloudProfileSaved = false;

      if (cloudResponse) {
        console.log(`[FG][PROVISION] cloud response ${prettyJson(cloudResponse)}`);
        setBleOutputs(null, prettyJson(cloudResponse));
        applyVoltageSettingsFromPayload(cloudResponse);
        syncVoltageInputsFromState();
        cloudProfileSaved = cloudResponse?.cs === true || cloudResponse?.cloud_saved === true;

        hasVpsFlag = typeof cloudResponse?.vps_reachable === 'boolean' || typeof cloudResponse?.vr === 'boolean';
        if (hasVpsFlag) {
          const vpsReachable = (typeof cloudResponse?.vps_reachable === 'boolean')
            ? cloudResponse.vps_reachable
            : cloudResponse.vr;
          state.install.deviceCloudReachable = vpsReachable;
          setInstallMetric('ble-device-cloud-status', vpsReachable ? 'UP' : 'DOWN', vpsReachable ? 'good' : 'bad');
          updateBleStatusLabel();
          cloudReachable = vpsReachable;
          const httpCode = Number.isFinite(Number(cloudResponse?.vps_http_code))
            ? Number(cloudResponse?.vps_http_code)
            : Number(cloudResponse?.vh);
          const code = Number.isFinite(httpCode) ? `HTTP ${httpCode}` : 'No HTTP code';
          const detail = String(cloudResponse?.vps_error || cloudResponse?.ve || '').trim();
          cloudNote = `${vpsReachable ? 'VPS reachable' : 'VPS not reachable'} (${code})${detail ? ` - ${detail}` : ''}`;
        } else if (typeof cloudResponse?.mqtt_connected === 'boolean') {
          state.install.deviceCloudReachable = cloudResponse.mqtt_connected;
          setInstallMetric('ble-device-cloud-status', cloudResponse.mqtt_connected ? 'UP' : 'DOWN', cloudResponse.mqtt_connected ? 'good' : 'bad');
          updateBleStatusLabel();
          cloudReachable = cloudResponse.mqtt_connected;
          cloudNote = cloudResponse.mqtt_connected ? 'MQTT connected.' : 'MQTT not connected.';
        } else {
          state.install.deviceCloudReachable = false;
          cloudNote = cloudProfileSaved
            ? 'Cloud profile saved on device. Waiting for cloud connection signal...'
            : 'Cloud response received. Waiting for cloud connection signal...';
        }
      } else {
        if (!isBleNoResponseError(cloudCommandError)) {
          throw cloudCommandError;
        }
        const msg = String(cloudCommandError?.message || 'BLE response timeout');
        setBleOutputs(null, `Cloud response pending: ${msg}`);
        setProvisionStep(3, 'active', 'BLE response delayed. Verifying via local + backend...');
        cloudNote = `No BLE cloud response (${msg}).`;

        // Recovery path: ask a compact health response to confirm MQTT link after cloud apply.
        try {
          const bleHealth = await bleSendCommand(
            { cmd: 'health', check_vps: false },
            {
              expectCmd: 'health',
              maxWaitMs: 12000,
              readTimeoutMs: 4500,
              initialDelayMs: 300,
              pollIntervalMs: 500
            }
          );
          if (typeof bleHealth?.mqtt_connected === 'boolean') {
            cloudReachable = bleHealth.mqtt_connected;
            state.install.deviceCloudReachable = cloudReachable;
            setInstallMetric('ble-device-cloud-status', cloudReachable ? 'UP' : 'DOWN', cloudReachable ? 'good' : 'bad');
            updateBleStatusLabel();
            cloudNote += ` | BLE health MQTT ${cloudReachable ? 'UP' : 'DOWN'}`;
          }
          if (bleHealth?.ip) {
            updateLocalUrlFromState(bleHealth.ip);
          }
        } catch (healthError) {
          cloudNote += ` | BLE health check failed (${String(healthError?.message || 'error')})`;
        }
      }

      setProvisionStep(3, 'active', 'Checking device local + cloud over HTTP...');

      const localUrlAfterCloud = updateLocalUrlFromState(wifiResponse?.ip || '');
      const localOk = localUrlAfterCloud ? await refreshLocalDeviceStatusApp(true) : false;
      if (localOk) {
        const localCloudState = Boolean(state.install.deviceCloudReachable);
        if (hasVpsFlag) {
          // Local /status reports MQTT link, but Step 3 verdict should follow VPS reachability probe.
          state.install.deviceCloudReachable = cloudReachable;
          setInstallMetric('ble-device-cloud-status', cloudReachable ? 'UP' : 'DOWN', cloudReachable ? 'good' : 'bad');
          updateBleStatusLabel();
          cloudNote += ` | Local MQTT ${localCloudState ? 'UP' : 'DOWN'}`;
        } else {
          cloudReachable = localCloudState;
          cloudNote += ` | Local HTTP says cloud is ${localCloudState ? 'UP' : 'DOWN'}`;
        }
      }

      if (!cloudReachable && !state.loading) {
        const backendPollWindowMs = 90000;
        const backendPollEveryMs = 5000;
        const pollStartedAt = Date.now();
        let lastBackendReason = 'Backend not checked';
        let firstPoll = true;

        while (!cloudReachable && (Date.now() - pollStartedAt) < backendPollWindowMs) {
          setProvisionStep(3, 'active', firstPoll
            ? 'Waiting for cloud heartbeat on backend...'
            : 'Still waiting for backend cloud confirmation...');
          firstPoll = false;

          try {
            await refreshAppData();
          } catch (error) {
            // ignore backend refresh errors in fallback path
          }
          const backendHealth = evaluateDeviceCloudHealth();
          lastBackendReason = backendHealth.reason;
          const backendLastUpdateMs = Number(new Date(selectedLocationRecord()?.last_update || 0).getTime()) || 0;
          const hasFreshPostProvisionTelemetry = backendLastUpdateMs > (preProvisionBackendUpdateMs + 1000);
          if (backendHealth.healthy && hasFreshPostProvisionTelemetry) {
            cloudReachable = true;
            state.install.deviceCloudReachable = true;
            setInstallMetric('ble-device-cloud-status', 'UP', 'good');
            updateBleStatusLabel();
            cloudNote += ` | Backend telemetry confirms cloud UP (${backendHealth.reason})`;
            break;
          }
          if (backendHealth.healthy && !hasFreshPostProvisionTelemetry) {
            lastBackendReason = `${backendHealth.reason} (waiting for fresh telemetry after apply)`;
          }
          await delay(backendPollEveryMs);
        }

        if (!cloudReachable) {
          cloudNote += ` | Backend telemetry: ${lastBackendReason}`;
        }
      }

      if (!cloudReachable) {
        setProvisionFinalStepTitle('failed');
        setProvisionStep(3, 'error', cloudNote);
        setProvisionStep(4, 'error', cloudProfileSaved
          ? 'Cloud profile saved, but device has not reached cloud yet.'
          : 'Wi-Fi is set, but cloud is not connected.');
        setProvisionModalNote(cloudProfileSaved
          ? 'Cloud profile is saved on device. Wait for internet/cloud reachability and retry check.'
          : 'Device saved Wi-Fi but cloud check failed.');
        setProvisionCloseEnabled(true);
        showToast(cloudProfileSaved
          ? 'Cloud profile saved. Device is still not reaching cloud.'
          : 'Wi-Fi saved, but cloud is not reachable from device.', true);
      } else {
        setProvisionFinalStepTitle('success');
        setProvisionStep(3, 'done', cloudNote);
        setProvisionStep(4, 'done', 'Provision success. Device is cloud-ready.');
        setProvisionModalNote('All steps completed successfully. Press X to close.');
        setProvisionCloseEnabled(true);
        state.ble.provisioningComplete = true;
        updateBleProvisionSectionVisibility();
        renderBleDeviceList();
        if (byId('ble-wifi-password')) {
          byId('ble-wifi-password').value = '';
        }
        showToast('Wi-Fi provision command completed.');
        // Refresh device list so the newly registered device appears immediately
        refreshAdminDevicesApp().catch(() => {});

        // Auto-bind to pre-selected target location if chosen
        const targetLocId = String(byId('ble-target-location-select')?.value || '').trim();
        if (targetLocId && isSuperAdmin()) {
          try {
            setProvisionStep(4, 'active', 'Auto-binding device to location...');
            await delay(2000);
            await refreshAdminDevicesApp().catch(() => {});
            const newest = (state.adminDevices || [])
              .filter((d) => !d.location_id)
              .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))[0];
            if (newest?.device_id) {
              await apiRequest(`/admin/locations/${encodeURIComponent(targetLocId)}/bind-device`, {
                method: 'POST',
                body: { device_id: newest.device_id }
              });
              showToast(`Device ${newest.device_id} bound to location.`);
              setProvisionStep(4, 'done', `Done. Device ${newest.device_id} bound to ${targetLocId}.`);
              await refreshAppData();
              await refreshAdminDevicesApp().catch(() => {});
              populateBleTargetLocationSection();
            }
          } catch (bindError) {
            showToast(`Auto-bind failed: ${bindError.message}`, true);
          }
        }
      }

      await checkAppVpsHealth();
    } catch (error) {
      if (error?.rawResponse && typeof error.rawResponse === 'object') {
        setBleOutputs(null, `Error: ${error.message}\n\nRaw:\n${prettyJson(error.rawResponse)}`);
      } else {
        setBleOutputs(null, `Error: ${error.message}`);
      }
      const safeMessage = String(error?.message || 'Unknown error');
      setProvisionFinalStepTitle('failed');
      setProvisionStep(activeStep, 'error', safeMessage);
      if (activeStep < 3) {
        setProvisionStep(3, '', 'Waiting...');
      }
      setProvisionStep(4, 'error', 'Provision failed.');
      setProvisionModalNote(`Provision failed: ${safeMessage}`);
      setProvisionCloseEnabled(true);
      showToast(`Provisioning failed: ${error.message}`, true);
    } finally {
      state.ble.provisionInProgress = false;
      if (provisionBtn) {
        provisionBtn.disabled = false;
      }
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
      if (isSuperAdmin()) renderInstallDeviceTable();

      if (!state.selectedLocationId) {
        return;
      }

      const selectedLocation = state.locations.find((item) => item.location_id === state.selectedLocationId) || null;
      state.selectedDeviceId = selectedLocation?.device_id || null;
      if (state.configDeviceId && state.configDeviceId !== state.selectedDeviceId) {
        state.deviceConfig = null;
        state.deviceConfigHistory = [];
        state.configDeviceId = null;
        renderDeviceConfig(null);
        renderDeviceConfigHistory([]);
      }

      const details = await fetchLocationDetails(state.selectedLocationId);
      const activeIncident = details.incidents.find((item) => item.status === 'ACTIVE') || null;

      renderDashboard(selectedLocation, details.dashboardData, activeIncident);

      const currentStatus = String(selectedLocation?.status || details.dashboardData?.status || '');
      if (currentStatus.includes('DANGER')) {
        startFloodAlarm(selectedLocation?.location_id || state.selectedLocationId);
      } else {
        stopFloodAlarm();
      }
      renderAudit(details.auditLogs);
      fetchComplaints(state.selectedLocationId).then((complaints) => {
        state.complaints = complaints;
        state.complaintsLocationId = state.selectedLocationId;
        renderComplaints(complaints);
      }).catch(() => {});
      if (isSuperAdmin()) {
        await refreshAdminUsersApp();
      }
      if (canVendorInstall() && byId('view-install')?.classList.contains('active')) {
        await refreshVendorInstallStatus();
      }
      if (canViewConfig() && byId('view-config')?.classList.contains('active')) {
        await refreshDeviceConfigApp();
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
    // Proactively refresh JWT every 6 hours so PWA never goes stale
    if (state._tokenRefreshTimer) clearInterval(state._tokenRefreshTimer);
    state._tokenRefreshTimer = setInterval(() => {
      if (state.token) silentRefreshTokenApp().catch(() => {});
    }, 6 * 60 * 60 * 1000);
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

  // ── Alarm sound (Web Audio API + Speech) ─────────────────────────
  function _getAudioCtx() {
    if (!state.alarm.audioCtx) {
      state.alarm.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (state.alarm.audioCtx.state === 'suspended') {
      state.alarm.audioCtx.resume();
    }
    return state.alarm.audioCtx;
  }

  function _playBeep(freq, durationSec, volume) {
    try {
      const ctx = _getAudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.setValueAtTime(volume, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationSec);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + durationSec);
    } catch (_) {}
  }

  function enableAlarmSoundApp() {
    state.alarm.enabled = true;
    _playBeep(440, 0.15, 0.4);
    const btn = byId('alarm-enable-btn');
    if (btn) btn.style.display = 'none';
    showToast('Alarm sound enabled');
  }

  function startFloodAlarm(locationId) {
    if (!state.alarm.enabled || state.alarm.active) return;
    state.alarm.active = true;
    state.alarm.beepStep = 0;

    const rubDigits = String(locationId || '').replace(/[^0-9]/g, '').split('').join(' ');
    const speechText = `R U B ${rubDigits}, Flood Danger Alert, Please Evacuate`;

    function tick() {
      if (!state.alarm.active) return;
      const freq = state.alarm.beepStep % 2 === 0 ? 900 : 600;
      _playBeep(freq, 0.7, 0.8);
      state.alarm.beepStep++;
      if (state.alarm.beepStep % 6 === 0 && window.speechSynthesis) {
        window.speechSynthesis.cancel();
        const utt = new SpeechSynthesisUtterance(speechText);
        utt.lang = 'en-IN';
        utt.rate = 0.85;
        utt.volume = 1.0;
        window.speechSynthesis.speak(utt);
      }
    }

    tick();
    state.alarm.intervalId = setInterval(tick, 1000);
  }

  function stopFloodAlarm() {
    state.alarm.active = false;
    if (state.alarm.intervalId) {
      clearInterval(state.alarm.intervalId);
      state.alarm.intervalId = null;
    }
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  }

  // ── Firebase Cloud Messaging ──────────────────────────────────────
  async function _sendFcmTokenToServer(token) {
    if (!state.token || !state.apiBase) return;
    try {
      await apiRequest('/auth/fcm-token', {
        auth: true,
        method: 'PUT',
        body: { fcm_token: token }
      });
    } catch (_) {}
  }

  async function initFcm() {
    if (typeof firebase === 'undefined' || !firebase.messaging) return;
    if (!('Notification' in window)) return;

    try {
      firebase.initializeApp(FCM_CONFIG);
    } catch (_) {
      // already initialized — OK
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;

    try {
      const messaging = firebase.messaging();
      const token = await messaging.getToken({ vapidKey: FCM_VAPID_KEY });
      if (token) {
        await _sendFcmTokenToServer(token);
      }
      messaging.onMessage((payload) => {
        const notif = payload.notification || {};
        const event = payload.data?.event || '';
        if (event === 'DANGER_CONFIRMED') {
          const locId = payload.data?.location_id || state.selectedLocationId || '';
          startFloodAlarm(locId);
        }
        showToast(`${notif.title || 'FloodGuard'}: ${notif.body || ''}`);
      });
      messaging.onTokenRefresh(async () => {
        const newToken = await messaging.getToken({ vapidKey: FCM_VAPID_KEY });
        if (newToken) await _sendFcmTokenToServer(newToken);
      });
    } catch (err) {
      console.warn('[FCM] token error:', err.message);
    }

    // Show "Enable Alarm Sound" prompt — needs user gesture before audio plays
    const btn = byId('alarm-enable-btn');
    if (btn) btn.style.display = '';
  }
  // ─────────────────────────────────────────────────────────────────

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
      applyVendorLoginFieldsVisibility();
      populateRoleDropdown();
      applyVendorInstallVisibility();
      applyConfigVisibility();
      applySettingsVisibility();
      applyComplaintsVisibility();
      applyReportsVisibility();
      applyUsersTabVisibility();
      applyVendorsTabVisibility();
      showToast('Login successful');
      await refreshAppData();
      startPolling();
      initFcm().catch(() => {});

      if (result.force_password_change) {
        openForcePwChangeModal();
      }
    } catch (error) {
      setText('login-error', `Login failed: ${error.message}`);
    }
  }

  function logoutApp(isAuto = false, message = 'Session cleared. Please login again.') {
    stopFloodAlarm();
    state.alarm.enabled = false;
    state.token = '';
    state.user = null;
    state.session = null;
    state.locations = [];
    state.selectedLocationId = null;
    state.selectedDeviceId = null;
    state.activeIncident = null;
    state.latestTelemetry = null;
    state.deviceConfig = null;
    state.deviceConfigHistory = [];
    state.configDeviceId = null;
    state.adminUsers = [];
    state.complaints = [];
    state.complaintsLocationId = null;
    state.report = { rows: [], loaded: false };
    state.vendors = [];
    state.vendorsFiltered = [];
    state.install.tokenExpiresAt = '';

    if (state.refreshTimer) {
      clearInterval(state.refreshTimer);
      state.refreshTimer = null;
    }
    if (state._tokenRefreshTimer) {
      clearInterval(state._tokenRefreshTimer);
      state._tokenRefreshTimer = null;
    }
    if (state.incidentTimer) {
      clearInterval(state.incidentTimer);
      state.incidentTimer = null;
    }

    clearSession();
    setLoggedInUi(false);
    openView('view-login');
    applyAdminPanelVisibility();
    applyVendorLoginFieldsVisibility();
    applyVendorInstallVisibility();
    applyConfigVisibility();
    applySettingsVisibility();
    applyComplaintsVisibility();
    applyReportsVisibility();
    applyUsersTabVisibility();
    applyVendorsTabVisibility();
    renderAdminUsersApp([]);
    renderDeviceConfig(null);
    renderDeviceConfigHistory([]);
    showToast(message, isAuto);
  }

  function selectLocation(locationId) {
    state.selectedLocationId = locationId;
    const selected = state.locations.find((item) => item.location_id === locationId) || null;
    state.selectedDeviceId = selected?.device_id || null;
    if (state.configDeviceId && state.configDeviceId !== state.selectedDeviceId) {
      state.deviceConfig = null;
      state.deviceConfigHistory = [];
      state.configDeviceId = null;
      renderDeviceConfig(null);
      renderDeviceConfigHistory([]);
    }
    renderLocations();
    openView('view-dashboard');
    refreshAppData().catch(() => {
      // handled
    });
  }

  async function muteAlarmApp() {
    if (!canOperate()) {
      showToast('Mute alarm is not available for your role.', true);
      return;
    }
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
    if (!canOperate()) {
      showToast('Dry run is not available for your role.', true);
      return;
    }
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
    if (!canOperate()) {
      showToast('Force clear is not available for your role.', true);
      return;
    }
    const reason = String(
      byId('dash-force-clear-reason')?.value || byId('force-clear-reason')?.value || ''
    ).trim();
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

      ['force-clear-reason', 'dash-force-clear-reason'].forEach((id) => {
        const el = byId(id);
        if (el) el.value = '';
      });
      showToast('Force clear submitted.');
      await refreshAppData();
    } catch (error) {
      handleApiError(error, 'Force clear failed');
    }
  }

  function canManageLifecycle() {
    return ['VENDOR_SUPER_ADMIN', 'DEPARTMENT_SUPER_ADMIN', 'DEPARTMENT_ADMIN'].includes(userRole());
  }

  function renderLifecycleBanner(location) {
    const opStatus = String(location?.operational_status || 'ACTIVE').toUpperCase();
    const banner = byId('lifecycle-banner');
    const actionsSection = byId('lifecycle-actions');

    const nonActive = ['FAULTY', 'UNDER_REPLACEMENT', 'PENDING_VERIFICATION', 'REPLACED', 'DECOMMISSIONED'].includes(opStatus);

    if (banner) {
      if (nonActive) {
        banner.style.display = 'block';
        banner.className = 'lifecycle-band ' + (
          opStatus === 'FAULTY' ? 'faulty' :
          opStatus === 'UNDER_REPLACEMENT' ? 'replacement' :
          opStatus === 'PENDING_VERIFICATION' ? 'pending' : 'off'
        );
        const bannerLabels = {
          FAULTY: 'DEVICE FAULTY — Site monitoring may be unavailable',
          UNDER_REPLACEMENT: 'DEVICE UNDER REPLACEMENT',
          PENDING_VERIFICATION: 'DEVICE PENDING VERIFICATION',
          REPLACED: 'DEVICE REPLACED',
          DECOMMISSIONED: 'DEVICE DECOMMISSIONED'
        };
        setText('lifecycle-band-title', bannerLabels[opStatus] || opStatus);
        setText('lifecycle-band-note', location?.lifecycle_note || 'No details available');
        setText('lifecycle-band-time', location?.lifecycle_updated_at
          ? `Updated: ${formatTime(location.lifecycle_updated_at)}` : '');
      } else {
        banner.style.display = 'none';
      }
    }

    if (actionsSection) {
      const show = canManageLifecycle();
      actionsSection.style.display = show ? 'block' : 'none';
      if (show) {
        setText('lifecycle-status-text', `Operational Status: ${opStatus}`);
        setText('lifecycle-action-status', '');
        const faultyBtn = byId('lifecycle-btn-faulty');
        const replacementBtn = byId('lifecycle-btn-replacement');
        const recommissionBtn = byId('lifecycle-btn-recommission');
        if (faultyBtn) faultyBtn.style.display = opStatus === 'ACTIVE' ? 'inline-block' : 'none';
        if (replacementBtn) replacementBtn.style.display = ['ACTIVE', 'FAULTY'].includes(opStatus) ? 'inline-block' : 'none';
        if (recommissionBtn) recommissionBtn.style.display = ['FAULTY', 'UNDER_REPLACEMENT', 'PENDING_VERIFICATION'].includes(opStatus) ? 'inline-block' : 'none';
      }
    }
  }

  async function markDeviceFaultyApp() {
    const reason = String(byId('lifecycle-reason')?.value || '').trim();
    if (!reason) { setText('lifecycle-action-status', 'Reason is required.'); return; }
    if (!state.selectedDeviceId) { showToast('No device selected.', true); return; }
    try {
      await apiRequest(`/devices/${encodeURIComponent(state.selectedDeviceId)}/lifecycle/mark-faulty`, {
        method: 'POST',
        body: { reason, location_id: state.selectedLocationId }
      });
      if (byId('lifecycle-reason')) byId('lifecycle-reason').value = '';
      setText('lifecycle-action-status', 'Device marked as faulty.');
      showToast('Device marked faulty.');
      await refreshAppData();
    } catch (error) {
      setText('lifecycle-action-status', `Failed: ${error.message}`);
    }
  }

  async function markDeviceReplacementApp() {
    const reason = String(byId('lifecycle-reason')?.value || '').trim();
    if (!reason) { setText('lifecycle-action-status', 'Reason is required.'); return; }
    if (!state.selectedDeviceId) { showToast('No device selected.', true); return; }
    try {
      await apiRequest(`/devices/${encodeURIComponent(state.selectedDeviceId)}/lifecycle/mark-replacement`, {
        method: 'POST',
        body: { reason, location_id: state.selectedLocationId }
      });
      if (byId('lifecycle-reason')) byId('lifecycle-reason').value = '';
      setText('lifecycle-action-status', 'Device marked as under replacement.');
      showToast('Device marked under replacement.');
      await refreshAppData();
    } catch (error) {
      setText('lifecycle-action-status', `Failed: ${error.message}`);
    }
  }

  async function recommissionDeviceApp() {
    const note = String(byId('lifecycle-reason')?.value || '').trim();
    if (!note) { setText('lifecycle-action-status', 'Note is required for recommission.'); return; }
    if (!state.selectedDeviceId) { showToast('No device selected.', true); return; }
    try {
      await apiRequest(`/devices/${encodeURIComponent(state.selectedDeviceId)}/lifecycle/recommission`, {
        method: 'POST',
        body: { note, location_id: state.selectedLocationId }
      });
      if (byId('lifecycle-reason')) byId('lifecycle-reason').value = '';
      setText('lifecycle-action-status', 'Device recommissioned successfully.');
      showToast('Device recommissioned.');
      await refreshAppData();
    } catch (error) {
      setText('lifecycle-action-status', `Failed: ${error.message}`);
    }
  }

  async function refreshLifecycleHistoryApp() {
    if (!state.selectedDeviceId) { showToast('No device selected.', true); return; }
    try {
      const result = await apiRequest(`/devices/${encodeURIComponent(state.selectedDeviceId)}/lifecycle/history`);
      const history = Array.isArray(result?.data) ? result.data : (Array.isArray(result) ? result : []);
      renderLifecycleHistory(history);
    } catch (error) {
      showToast(`History fetch failed: ${error.message}`, true);
    }
  }

  function renderLifecycleHistory(history) {
    const list = byId('lifecycle-history-list');
    if (!list) return;
    if (!Array.isArray(history) || history.length === 0) {
      list.innerHTML = '<div class="empty">No lifecycle history.</div>';
      return;
    }
    list.innerHTML = history.map((item) => {
      const action = escapeHtml(String(item.action || item.event_type || '--').toUpperCase());
      const note = escapeHtml(String(item.note || item.reason || 'No details'));
      const by = escapeHtml(item.performed_by_login_id || item.performedByLoginId || 'System');
      const at = escapeHtml(formatDateTime(item.timestamp || item.created_at || item.createdAt));
      return `
        <div class="lifecycle-history-item">
          <div class="lifecycle-history-action">${action}</div>
          <div class="lifecycle-history-note">${note}</div>
          <div class="lifecycle-history-meta">${by} · ${at}</div>
        </div>
      `;
    }).join('');
  }

  const COMPLAINT_TYPE_LABELS = {
    device_offline: 'Device offline',
    water_sensor_faulty: 'Water level sensor faulty',
    level_switch_faulty: 'Level switch faulty',
    siren_not_working: 'Siren not working',
    beacon_not_working: 'Beacon light not working',
    voice_not_working: 'Voice announcement not working',
    battery_solar_issue: 'Battery low / solar issue',
    network_issue: '4G router / network issue',
    false_alarm: 'False alarm suspected',
    physical_damage: 'Physical damage / theft',
    other: 'Other'
  };

  function complaintTypeLabel(type) {
    return COMPLAINT_TYPE_LABELS[String(type || '')] || String(type || 'Other');
  }

  async function fetchComplaints(locationId) {
    if (!locationId) return [];
    try {
      const result = await apiRequest(`/complaints?location_id=${encodeURIComponent(locationId)}`);
      return Array.isArray(result?.data) ? result.data : (Array.isArray(result) ? result : []);
    } catch (error) {
      return [];
    }
  }

  function renderComplaints(complaints) {
    const list = byId('complaint-list');
    if (!list) return;

    const loc = state.locations.find((l) => l.location_id === state.selectedLocationId);
    const locName = loc?.location_name || state.selectedLocationId || '--';
    setText('complaint-location-sub', state.selectedLocationId
      ? `${locName} · ${state.selectedLocationId}`
      : 'Select a location first');

    const openCount = Array.isArray(complaints)
      ? complaints.filter((c) => String(c.status || '').toUpperCase() === 'OPEN').length
      : 0;
    const countEl = byId('complaint-open-count');
    if (countEl) {
      countEl.textContent = `${openCount} open`;
      countEl.classList.toggle('danger', openCount > 0);
      countEl.classList.toggle('off', openCount === 0);
    }

    if (!Array.isArray(complaints) || complaints.length === 0) {
      list.innerHTML = '<div class="empty">No complaints for this location.</div>';
      return;
    }

    const role = userRole();
    const canAcknowledge = ['VENDOR_SUPER_ADMIN', 'VENDOR_MONITORING_USER', 'DEPARTMENT_SUPER_ADMIN', 'DEPARTMENT_ADMIN'].includes(role);
    const canResolve = ['VENDOR_SUPER_ADMIN', 'DEPARTMENT_SUPER_ADMIN', 'DEPARTMENT_ADMIN'].includes(role);
    const canForwardWa = ['DEPARTMENT_SUPER_ADMIN', 'DEPARTMENT_ADMIN'].includes(role);

    list.innerHTML = complaints.map((c) => {
      const id = escapeHtml(String(c._id || c.complaint_id || ''));
      const no = escapeHtml(String(c.complaint_no || c._id?.slice(-6) || '--'));
      const type = escapeHtml(complaintTypeLabel(c.type || c.complaint_type));
      const priority = String(c.priority || 'LOW').toUpperCase();
      const status = String(c.status || 'OPEN').toUpperCase();
      const priorityCls = priority.toLowerCase();
      const statusCls = status.toLowerCase().replace(/_/g, '_');
      const desc = escapeHtml(String(c.description || '').slice(0, 120));
      const raisedBy = escapeHtml(c.raised_by_login_id || c.raisedByLoginId || '--');
      const raisedAt = escapeHtml(formatTime(c.created_at || c.createdAt));

      const ackBtn = canAcknowledge && status === 'OPEN'
        ? `<button class="ghost-btn" style="padding:5px 10px;font-size:11px" onclick="acknowledgeComplaintApp('${id}')">Acknowledge</button>`
        : '';
      const resolveBtn = canResolve && ['OPEN', 'ACKNOWLEDGED', 'ASSIGNED', 'IN_PROGRESS'].includes(status)
        ? `<button class="ghost-btn" style="padding:5px 10px;font-size:11px" onclick="resolveComplaintApp('${id}')">Resolve</button>`
        : '';
      const closeBtn = canResolve && status === 'RESOLVED'
        ? `<button class="ghost-btn" style="padding:5px 10px;font-size:11px" onclick="closeComplaintApp('${id}')">Close</button>`
        : '';

      const waText = canForwardWa
        ? buildComplaintWaText(c, locName)
        : '';
      const waBtn = canForwardWa
        ? `<a class="ghost-btn wa-forward-btn" style="padding:5px 10px;font-size:11px;text-decoration:none" href="https://wa.me/?text=${encodeURIComponent(waText)}" target="_blank" rel="noopener">📲 WhatsApp</a>`
        : '';

      const actionRow = (ackBtn || resolveBtn || closeBtn || waBtn)
        ? `<div class="row" style="margin-top:8px;justify-content:flex-end;gap:6px">${ackBtn}${resolveBtn}${closeBtn}${waBtn}</div>`
        : '';

      return `
        <div class="complaint-card">
          <div class="complaint-head">
            <div>
              <div class="complaint-no">#${no} · ${type}</div>
              <div class="complaint-desc">${desc}</div>
            </div>
            <div class="complaint-badges">
              <span class="priority-pill priority-pill--${escapeHtml(priorityCls)}">${priority}</span>
              <span class="complaint-status-pill status-pill--${escapeHtml(statusCls)}">${status}</span>
            </div>
          </div>
          <div class="complaint-meta">${raisedBy} · ${raisedAt}</div>
          ${actionRow}
        </div>
      `;
    }).join('');
  }

  function buildComplaintWaText(c, locName) {
    const no = String(c.complaint_no || c._id?.slice(-6) || '--');
    const type = complaintTypeLabel(c.type || c.complaint_type);
    const priority = String(c.priority || 'LOW').toUpperCase();
    const status = String(c.status || 'OPEN').toUpperCase();
    const desc = String(c.description || '').trim();
    const raisedBy = c.raised_by_login_id || c.raisedByLoginId || '--';
    const raisedAt = formatDateTime(c.created_at || c.createdAt);
    const lines = [
      `*FloodGuard Complaint — ${locName}*`,
      `Complaint No: #${no}`,
      `Type: ${type}`,
      `Priority: ${priority}`,
      `Status: ${status}`,
      `Description: ${desc || 'No details provided'}`,
      `Raised by: ${raisedBy} on ${raisedAt} IST`,
      ``,
      `Please look into this at the earliest.`,
      `— FloodGuard Monitoring System`
    ];
    return lines.join('\n');
  }

  async function raiseComplaintApp() {
    if (!state.selectedLocationId) {
      showToast('Select a location first.', true);
      return;
    }

    const type = String(byId('complaint-type')?.value || '').trim();
    const priority = String(byId('complaint-priority')?.value || 'MEDIUM');
    const description = String(byId('complaint-description')?.value || '').trim();

    setText('complaint-raise-status', '');

    if (!type) {
      setText('complaint-raise-status', 'Please select a complaint type.');
      return;
    }
    if (description.length < 10) {
      setText('complaint-raise-status', 'Description must be at least 10 characters.');
      return;
    }

    try {
      await apiRequest('/complaints', {
        method: 'POST',
        body: {
          location_id: state.selectedLocationId,
          device_id: state.selectedDeviceId || null,
          type,
          priority,
          description,
          title: complaintTypeLabel(type)
        }
      });
      if (byId('complaint-type')) byId('complaint-type').value = '';
      if (byId('complaint-priority')) byId('complaint-priority').value = 'MEDIUM';
      if (byId('complaint-description')) byId('complaint-description').value = '';
      setText('complaint-raise-status', 'Complaint submitted successfully.');
      showToast('Complaint submitted.');
      await refreshComplaintsApp();
    } catch (error) {
      setText('complaint-raise-status', `Failed: ${error.message}`);
    }
  }

  function populateComplaintLocationSelect() {
    const sel = byId('complaint-location-select');
    if (!sel) return;
    const locs = state.locations || [];
    sel.innerHTML = locs.length === 0
      ? '<option value="">No locations available</option>'
      : locs.map((l) => `<option value="${l.location_id}"${l.location_id === state.selectedLocationId ? ' selected' : ''}>${l.location_name || l.location_id}</option>`).join('');
  }

  function selectComplaintLocationApp() {
    const sel = byId('complaint-location-select');
    const locId = sel?.value;
    if (!locId) return;
    const loc = state.locations.find((l) => l.location_id === locId);
    state.selectedLocationId = locId;
    state.selectedDeviceId = loc?.device_id || null;
    saveSession();
    refreshComplaintsApp().catch(() => {});
    const locName = loc?.location_name || locId;
    setText('complaint-location-sub', `${locName} · ${locId}`);
  }

  async function refreshComplaintsApp() {
    if (!state.selectedLocationId) return;
    const complaints = await fetchComplaints(state.selectedLocationId);
    state.complaints = complaints;
    state.complaintsLocationId = state.selectedLocationId;
    renderComplaints(complaints);
  }

  async function acknowledgeComplaintApp(complaintId) {
    try {
      await apiRequest(`/complaints/${encodeURIComponent(complaintId)}/acknowledge`, { method: 'PATCH' });
      showToast('Complaint acknowledged.');
      await refreshComplaintsApp();
    } catch (error) {
      showToast(`Failed: ${error.message}`, true);
    }
  }

  async function resolveComplaintApp(complaintId) {
    try {
      await apiRequest(`/complaints/${encodeURIComponent(complaintId)}/resolve`, {
        method: 'PATCH',
        body: { note: 'Marked resolved via mobile app' }
      });
      showToast('Complaint resolved.');
      await refreshComplaintsApp();
    } catch (error) {
      showToast(`Failed: ${error.message}`, true);
    }
  }

  async function closeComplaintApp(complaintId) {
    try {
      await apiRequest(`/complaints/${encodeURIComponent(complaintId)}/close`, {
        method: 'PATCH',
        body: { note: 'Closed via mobile app' }
      });
      showToast('Complaint closed.');
      await refreshComplaintsApp();
    } catch (error) {
      showToast(`Failed: ${error.message}`, true);
    }
  }

  function applyComplaintsVisibility() {
    const tab = byId('complaints-tab');
    const isLoggedIn = Boolean(state.token && state.user);
    if (tab) {
      tab.style.display = isLoggedIn ? 'inline-block' : 'none';
    }
    updateNavButtonCount();
  }

  function applyUsersTabVisibility() {
    const tab = byId('users-tab');
    if (tab) tab.style.display = (state.token && state.user && isSuperAdmin()) ? 'inline-block' : 'none';
    updateNavButtonCount();
  }

  // ── Location & Device Admin ──────────────────────────────────────────────────

  function populateDeviceLocationSelect() {
    const sel = byId('dev-add-location');
    if (!sel) return;
    const prev = sel.value;
    while (sel.options.length > 1) sel.remove(1);
    state.locations.forEach((loc) => {
      const opt = document.createElement('option');
      opt.value = loc.location_id;
      opt.textContent = `${loc.location_name || loc.location_id} (${loc.location_id})`;
      sel.appendChild(opt);
    });
    if (prev && Array.from(sel.options).some((o) => o.value === prev)) sel.value = prev;
  }

  async function addLocationApp() {
    const locationId = String(byId('loc-add-id')?.value || '').trim().toUpperCase();
    const locationName = String(byId('loc-add-name')?.value || '').trim();
    const description = String(byId('loc-add-desc')?.value || '').trim();
    const mountHeight = Number(byId('loc-add-mount')?.value) || undefined;
    const deptId = String(byId('loc-add-dept')?.value || '').trim();

    setText('loc-add-status', '');
    if (!locationId) { setText('loc-add-status', 'Location ID is required.'); return; }
    if (!locationName) { setText('loc-add-status', 'Location Name is required.'); return; }

    try {
      await apiRequest('/admin/locations', {
        method: 'POST',
        body: { location_id: locationId, location_name: locationName, description, sensor_mount_height_mm: mountHeight, department_id: deptId || undefined }
      });
      ['loc-add-id', 'loc-add-name', 'loc-add-desc', 'loc-add-mount', 'loc-add-dept'].forEach((id) => {
        const el = byId(id); if (el) el.value = '';
      });
      setText('loc-add-status', `Location ${locationId} created.`);
      showToast(`Location ${locationId} added.`);
      await refreshAppData();
      populateDeviceLocationSelect();
    } catch (error) {
      setText('loc-add-status', `Failed: ${error.message}`);
    }
  }

  async function saveLocationDetailsApp() {
    const locationId = state.selectedLocationId;
    if (!locationId) { showToast('Select a location first.', true); return; }
    const locationName = String(byId('dash-loc-name')?.value || '').trim();
    const description = String(byId('dash-loc-desc')?.value || '').trim();
    const mountHeight = Number(byId('dash-loc-mount')?.value) || undefined;

    setText('dash-loc-save-status', '');
    if (!locationName) { setText('dash-loc-save-status', 'Name is required.'); return; }

    try {
      await apiRequest(`/admin/locations/${encodeURIComponent(locationId)}`, {
        method: 'PATCH',
        body: { location_name: locationName, description, sensor_mount_height_mm: mountHeight }
      });
      setText('dash-loc-save-status', 'Location details saved.');
      showToast('Location details updated.');
      await refreshAppData();
    } catch (error) {
      setText('dash-loc-save-status', `Failed: ${error.message}`);
    }
  }

  async function addDeviceApp() {
    const deviceId = String(byId('dev-add-id')?.value || '').trim().toUpperCase();
    const locationId = String(byId('dev-add-location')?.value || '').trim() || undefined;

    setText('dev-add-status', '');
    if (!deviceId) { setText('dev-add-status', 'Device ID is required.'); return; }

    try {
      await apiRequest('/admin/devices', {
        method: 'POST',
        body: { device_id: deviceId, location_id: locationId }
      });
      if (byId('dev-add-id')) byId('dev-add-id').value = '';
      if (byId('dev-add-location')) byId('dev-add-location').value = '';
      setText('dev-add-status', locationId
        ? `Device ${deviceId} registered and bound to ${locationId}.`
        : `Device ${deviceId} registered (unbound).`);
      showToast(`Device ${deviceId} registered.`);
      await refreshAdminDevicesApp();
      if (locationId) await refreshAppData();
    } catch (error) {
      setText('dev-add-status', `Failed: ${error.message}`);
    }
  }

  async function refreshAdminDevicesApp() {
    try {
      const result = await apiRequest('/admin/devices');
      const devices = Array.isArray(result?.data) ? result.data : (Array.isArray(result) ? result : []);
      state.adminDevices = devices;
      renderAdminDeviceList(devices);
      if (isSuperAdmin()) renderInstallDeviceTable();
    } catch (error) {
      showToast(`Failed to load devices: ${error.message}`, true);
    }
  }

  function renderAdminDeviceList(devices) {
    const list = byId('admin-device-list');
    if (!list) return;
    if (!devices.length) {
      list.innerHTML = '<div class="empty">No devices registered yet.</div>';
      return;
    }
    // Sort: unbound first, then newest-first within each group
    const sorted = [...devices].sort((a, b) => {
      const aUnbound = !a.location_id ? 0 : 1;
      const bUnbound = !b.location_id ? 0 : 1;
      if (aUnbound !== bUnbound) return aUnbound - bUnbound;
      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    });
    list.innerHTML = sorted.map((d) => {
      const deviceId = escapeHtml(d.device_id);
      const locId = escapeHtml(d.location_id || '');
      const locName = d.location_id
        ? escapeHtml(state.locations.find((l) => l.location_id === d.location_id)?.location_name || d.location_id)
        : 'Unbound';
      const statusCls = d.status === 'ONLINE' ? 'ok' : 'off';
      const unboundCls = !d.location_id ? ' admin-device-row--unbound' : '';
      return `
        <div class="admin-device-row${unboundCls}">
          <div class="admin-device-head">
            <div>
              <div class="admin-device-id">${deviceId}</div>
              <div class="admin-device-loc">Location: <span style="color:${d.location_id ? '#0f172a' : '#94a3b8'}">${locName}</span></div>
            </div>
            <span class="chip ${statusCls}" style="font-size:10px">${escapeHtml(d.status || 'OFFLINE')}</span>
          </div>
          ${!d.location_id ? `
          <div style="margin-top:8px;display:flex;gap:6px;align-items:center">
            <button class="control-btn info" style="flex:1;padding:7px 10px;font-size:12px;font-weight:600" onclick="openLocationViewWithDevice('${deviceId}')">📍 Connect to Location →</button>
          </div>` : `
          <div style="margin-top:6px;text-align:right">
            <button class="ghost-btn" style="padding:5px 10px;font-size:11px" onclick="quickUnbindDeviceApp('${deviceId}', '${locId}')">Unbind</button>
          </div>`}
        </div>
      `;
    }).join('');
  }

  async function quickBindDeviceApp(deviceId) {
    const locationId = String(byId(`quick-bind-loc-${deviceId}`)?.value || '').trim();
    if (!locationId) { showToast('Select a location first.', true); return; }
    try {
      await apiRequest(`/admin/locations/${encodeURIComponent(locationId)}/bind-device`, {
        method: 'POST',
        body: { device_id: deviceId }
      });
      showToast(`${deviceId} bound to ${locationId}.`);
      await refreshAdminDevicesApp();
      await refreshAppData();
    } catch (error) {
      showToast(`Bind failed: ${error.message}`, true);
    }
  }

  async function quickUnbindDeviceApp(deviceId, locationId) {
    try {
      await apiRequest(`/admin/locations/${encodeURIComponent(locationId)}/bind-device`, { method: 'DELETE' });
      showToast(`${deviceId} unbound.`);
      await refreshAdminDevicesApp();
      await refreshAppData();
    } catch (error) {
      showToast(`Unbind failed: ${error.message}`, true);
    }
  }

  async function deleteLocationApp(locationId, locationName, boundDeviceId) {
    const warning = boundDeviceId
      ? `Delete "${locationName}"?\n\nDevice ${boundDeviceId} will become unbound (it remains registered on the cloud).\n\nThis cannot be undone.`
      : `Delete "${locationName}"?\n\nThis location has no device. It will be permanently removed.\n\nThis cannot be undone.`;
    if (!confirm(warning)) return;
    try {
      await apiRequest(`/admin/locations/${encodeURIComponent(locationId)}`, { method: 'DELETE' });
      showToast(`Location "${locationName}" deleted.`);
      if (state.selectedLocationId === locationId) state.selectedLocationId = '';
      await refreshAppData();
      await refreshAdminDevicesApp().catch(() => {});
      populateBleTargetLocationSection();
    } catch (error) {
      showToast(`Delete failed: ${error.message}`, true);
    }
  }

  function populateBleTargetLocationSection() {
    const section = byId('ble-target-location-section');
    if (!section) return;
    if (!isSuperAdmin() || !state.ble.selectedDeviceId) {
      section.style.display = 'none';
      return;
    }
    const sel = byId('ble-target-location-select');
    if (!sel) return;
    const unbound = (state.locations || []).filter((l) => !l.device_id);
    const prev = sel.value;
    sel.innerHTML = '<option value="">— Skip (bind manually later) —</option>';
    unbound.forEach((l) => {
      const opt = document.createElement('option');
      opt.value = l.location_id;
      opt.textContent = l.location_name || l.location_id;
      if (l.location_id === prev) opt.selected = true;
      sel.appendChild(opt);
    });
    section.style.display = '';
  }

  function showBleNewLocationFormApp() {
    const form = byId('ble-new-location-form');
    if (form) form.style.display = '';
    byId('ble-new-location-name')?.focus();
  }

  async function createAndSelectBleLocationApp() {
    const name = String(byId('ble-new-location-name')?.value || '').trim();
    if (!name) { showToast('Enter a location name.', true); return; }
    try {
      const result = await apiRequest('/admin/locations', { method: 'POST', body: { location_name: name } });
      showToast(`Location "${name}" created.`);
      await refreshAppData();
      populateBleTargetLocationSection();
      const newId = result?.location_id || result?.id || '';
      if (newId) {
        const sel = byId('ble-target-location-select');
        if (sel) sel.value = newId;
      }
      const form = byId('ble-new-location-form');
      if (form) form.style.display = 'none';
      const inp = byId('ble-new-location-name');
      if (inp) inp.value = '';
    } catch (error) {
      showToast(`Failed to create location: ${error.message}`, true);
    }
  }

  function openLocationViewWithDevice(deviceId) {
    state.install.pendingBindDeviceId = String(deviceId || '').trim().toUpperCase();
    openView('view-locations');
  }

  function clearPendingBindApp() {
    state.install.pendingBindDeviceId = '';
    const banner = byId('pending-bind-banner');
    if (banner) banner.style.display = 'none';
    renderLocations();
  }

  function toggleInlineBindApp(locationId) {
    const panel = byId(`bind-panel-${locationId}`);
    if (!panel) return;
    const isOpen = panel.style.display !== 'none';
    panel.style.display = isOpen ? 'none' : '';
    // Adjust card bottom radius so it flows into the panel
    const locItem = panel.parentElement;
    if (locItem) locItem.classList.toggle('loc-item--bind-open', !isOpen);
    if (!isOpen) {
      const sel = byId(`bind-sel-${locationId}`);
      if (sel) {
        const free = (state.adminDevices || []).filter((d) => !d.location_id);
        sel.innerHTML = '<option value="">Select free device…</option>' +
          free.map((d) => `<option value="${escapeHtml(d.device_id)}">${escapeHtml(d.device_id)}${d.status ? ' (' + String(d.status).toUpperCase() + ')' : ''}</option>`).join('');
      }
    }
  }

  async function applyBindFromCardApp(locationId) {
    const sel = byId(`bind-sel-${locationId}`);
    const inp = byId(`bind-inp-${locationId}`);
    const deviceId = (String(inp?.value || '').trim().toUpperCase() || String(sel?.value || '').trim().toUpperCase());
    if (!deviceId) { showToast('Enter or select a Device ID.', true); return; }
    try {
      await apiRequest(`/admin/locations/${encodeURIComponent(locationId)}/bind-device`, {
        method: 'POST',
        body: { device_id: deviceId }
      });
      showToast(`${deviceId} bound to location.`);
      state.install.pendingBindDeviceId = '';
      const panel = byId(`bind-panel-${locationId}`);
      if (panel) panel.style.display = 'none';
      await refreshAdminDevicesApp();
      await refreshAppData();
    } catch (error) {
      showToast(`Bind failed: ${error.message}`, true);
    }
  }

  async function bindDeviceToLocationApp() {
    const locationId = state.selectedLocationId;
    const deviceId = String(byId('dash-bind-device-id')?.value || '').trim().toUpperCase();
    setText('dash-bind-status', '');
    if (!locationId) { showToast('No location selected.', true); return; }
    if (!deviceId) { setText('dash-bind-status', 'Device ID is required.'); return; }
    try {
      await apiRequest(`/admin/locations/${encodeURIComponent(locationId)}/bind-device`, {
        method: 'POST',
        body: { device_id: deviceId }
      });
      if (byId('dash-bind-device-id')) byId('dash-bind-device-id').value = '';
      setText('dash-bind-status', `Device ${deviceId} bound to this location.`);
      showToast(`${deviceId} bound.`);
      await refreshAppData();
    } catch (error) {
      setText('dash-bind-status', `Failed: ${error.message}`);
    }
  }

  async function unbindDeviceFromLocationApp() {
    const locationId = state.selectedLocationId;
    if (!locationId) { showToast('No location selected.', true); return; }
    if (!state.selectedDeviceId) { setText('dash-bind-status', 'No device is currently bound.'); return; }
    try {
      await apiRequest(`/admin/locations/${encodeURIComponent(locationId)}/bind-device`, { method: 'DELETE' });
      setText('dash-bind-status', 'Device unbound from this location.');
      showToast('Device unbound.');
      await refreshAppData();
    } catch (error) {
      setText('dash-bind-status', `Failed: ${error.message}`);
    }
  }

  function filterUserListApp() {
    renderAdminUsersApp(state.adminUsers);
  }

  function toggleResetPwFormApp(userId) {
    const wrap = byId(`reset-pw-wrap-${userId}`);
    if (wrap) wrap.style.display = wrap.style.display === 'none' ? 'block' : 'none';
  }

  async function submitResetPasswordApp(userId) {
    const input = byId(`reset-pw-input-${userId}`);
    const newPassword = String(input?.value || '').trim();
    if (newPassword.length < 6) {
      showToast('Password must be at least 6 characters.', true);
      return;
    }
    try {
      await apiRequest(`/admin/users/${encodeURIComponent(userId)}/reset-password`, {
        method: 'POST',
        body: { new_password: newPassword }
      });
      if (input) input.value = '';
      const wrap = byId(`reset-pw-wrap-${userId}`);
      if (wrap) wrap.style.display = 'none';
      showToast('Password reset successfully.');
    } catch (error) {
      showToast(`Reset failed: ${error.message}`, true);
    }
  }

  async function createUserApp() {
    if (!isSuperAdmin()) {
      showToast('Only super admin can create users.', true);
      return;
    }
    const loginId = String(byId('ua-login-id')?.value || '').trim();
    const name = String(byId('ua-name')?.value || '').trim();
    const password = String(byId('ua-password')?.value || '').trim();
    const role = String(byId('ua-role')?.value || 'OPERATOR').trim().toUpperCase();
    const assignedRaw = String(byId('ua-assigned-locations')?.value || '').trim();
    const assigned = assignedRaw.split(',').map((s) => s.trim()).filter(Boolean);

    setText('ua-create-status', '');
    if (!loginId || !password) {
      setText('ua-create-status', 'Login ID and password are required.');
      return;
    }
    if (password.length < 6) {
      setText('ua-create-status', 'Password must be at least 6 characters.');
      return;
    }

    try {
      await apiRequest('/admin/users', {
        method: 'POST',
        body: { login_id: loginId, name, password, role, is_active: true, assigned_locations: assigned }
      });
      ['ua-login-id', 'ua-name', 'ua-password', 'ua-assigned-locations'].forEach((id) => {
        const el = byId(id); if (el) el.value = '';
      });
      setText('ua-create-status', `User ${loginId} created successfully.`);
      showToast(`User ${loginId} created.`);
      await refreshAdminUsersApp();
    } catch (error) {
      setText('ua-create-status', `Failed: ${error.message}`);
    }
  }

  function canViewReports() {
    return ['VENDOR_SUPER_ADMIN', 'DEPARTMENT_SUPER_ADMIN', 'DEPARTMENT_ADMIN'].includes(userRole());
  }

  function applyReportsVisibility() {
    const tab = byId('reports-tab');
    if (tab) tab.style.display = (state.token && state.user && canViewReports()) ? 'inline-block' : 'none';
    updateNavButtonCount();
  }

  // ── Vendor Management ────────────────────────────────────────────────────────

  function applyVendorsTabVisibility() {
    const tab = byId('vendors-tab');
    if (tab) tab.style.display = (state.token && state.user && userRole() === 'VENDOR_SUPER_ADMIN') ? 'inline-block' : 'none';
    updateNavButtonCount();
  }

  async function loadVendorsApp() {
    try {
      const q = String(byId('vendor-search')?.value || '').trim();
      const project = String(byId('vendor-filter-project')?.value || '').trim();
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (project) params.set('project', project);
      const qs = params.toString();
      const data = await apiRequest(`/vendor-mgmt/vendors${qs ? '?' + qs : ''}`);
      state.vendors = data || [];
      state.vendorsFiltered = [...state.vendors];
      renderVendorList(state.vendorsFiltered);
    } catch (error) {
      setText('vendor-list', '');
      const el = byId('vendor-list');
      if (el) el.innerHTML = `<div class="empty err">Failed to load vendors: ${escHtml(error.message)}</div>`;
    }
  }

  async function populateVendorProjectSelects() {
    try {
      const projects = await apiRequest('/vendor-mgmt/projects');
      const filterSel = byId('vendor-filter-project');
      if (filterSel) {
        while (filterSel.options.length > 1) filterSel.remove(1);
        (projects || []).forEach((p) => {
          const opt = document.createElement('option');
          opt.value = p._id;
          opt.textContent = p.name;
          filterSel.appendChild(opt);
        });
      }
      const checkboxWrap = byId('vc-project-checkboxes');
      if (checkboxWrap) {
        checkboxWrap.innerHTML = (projects || []).map((p) =>
          `<label class="vendor-proj-check"><input type="checkbox" value="${escHtml(p._id)}" data-role="CLIENT"> ${escHtml(p.name)}</label>`
        ).join('');
      }
    } catch (_) {}
  }

  function renderVendorList(vendors) {
    const el = byId('vendor-list');
    if (!el) return;
    if (!vendors || vendors.length === 0) {
      el.innerHTML = '<div class="empty">No vendors found.</div>';
      return;
    }
    el.innerHTML = vendors.map((v) => {
      const statusClass = v.is_active ? 'ok' : 'off';
      const statusLabel = v.is_active ? 'Active' : 'Inactive';
      const projectTags = (v.projects || []).map((p) =>
        `<span class="vendor-project-tag">${escHtml(p.project_id)}</span>`
      ).join('');
      const adminInfo = v.admin_user
        ? `<span class="vendor-admin-id">${escHtml(v.admin_login_id)}</span>${v.admin_user.force_password_change ? '<span class="vendor-pw-flag">PW Change Pending</span>' : ''}`
        : `<span class="vendor-admin-id">${escHtml(v.admin_login_id)}</span>`;
      const masterBadge = v.is_master_vendor ? '<span class="vendor-master-badge">MASTER</span>' : '';
      return `
        <div class="vendor-card${v.is_active ? '' : ' vendor-inactive'}">
          <div class="vendor-card-head">
            <div>
              <span class="vendor-company">${escHtml(v.company_name)}</span>
              ${masterBadge}
              <span class="chip ${statusClass}" style="margin-left:6px;font-size:10px">${statusLabel}</span>
            </div>
          </div>
          <div class="vendor-meta-row">
            <span>Contact: <b>${escHtml(v.contact_name || '—')}</b></span>
            <span>Mobile: <b>${escHtml(v.mobile || '—')}</b></span>
          </div>
          <div class="vendor-meta-row">
            <span>Admin Login: ${adminInfo}</span>
          </div>
          <div class="vendor-meta-row" style="flex-wrap:wrap;gap:4px">
            ${projectTags || '<span class="hint">No projects assigned</span>'}
          </div>
          <div class="vendor-action-row">
            <button class="control-btn danger" onclick="resetVendorPasswordApp('${escHtml(v._id)}','${escHtml(v.company_name)}')">Reset Password</button>
            ${!v.is_master_vendor ? `<button class="control-btn ${v.is_active ? 'off' : 'ok'}" onclick="toggleVendorActiveApp('${escHtml(v._id)}','${escHtml(v.company_name)}')">${v.is_active ? 'Deactivate' : 'Activate'}</button>` : ''}
          </div>
        </div>`;
    }).join('');
  }

  function filterVendorListApp() {
    const q = String(byId('vendor-search')?.value || '').trim().toLowerCase();
    const project = String(byId('vendor-filter-project')?.value || '').trim();
    let filtered = state.vendors;
    if (project) {
      filtered = filtered.filter((v) => v.projects && v.projects.some((p) => p.project_id === project));
    }
    if (q) {
      filtered = filtered.filter((v) =>
        [v.company_name, v.mobile, v.admin_login_id, v.contact_name, v.email].join(' ').toLowerCase().includes(q)
      );
    }
    state.vendorsFiltered = filtered;
    renderVendorList(filtered);
  }

  async function createVendorApp() {
    const companyName = String(byId('vc-company')?.value || '').trim();
    const contactName = String(byId('vc-contact')?.value || '').trim();
    const mobile = String(byId('vc-mobile')?.value || '').trim();
    const email = String(byId('vc-email')?.value || '').trim();

    setText('vc-create-status', '');
    if (!companyName) { setText('vc-create-status', 'Company name is required.'); return; }
    if (!mobile) { setText('vc-create-status', 'Mobile number is required.'); return; }

    const checkboxes = Array.from(document.querySelectorAll('#vc-project-checkboxes input[type=checkbox]:checked'));
    const projects = checkboxes.map((cb) => ({ project_id: cb.value, role: cb.dataset.role || 'CLIENT' }));

    try {
      const result = await apiRequest('/vendor-mgmt/vendors', {
        method: 'POST',
        body: { company_name: companyName, contact_name: contactName, mobile, email, projects }
      });
      setText('vc-create-status', `Vendor created. Admin login: ${result.admin_login_id} / Default password: ${result.default_password}`);
      ['vc-company', 'vc-contact', 'vc-mobile', 'vc-email'].forEach((id) => {
        const el = byId(id); if (el) el.value = '';
      });
      document.querySelectorAll('#vc-project-checkboxes input[type=checkbox]').forEach((cb) => { cb.checked = false; });
      await loadVendorsApp();
    } catch (error) {
      setText('vc-create-status', `Failed: ${error.message}`);
    }
  }

  async function resetVendorPasswordApp(vendorId, companyName) {
    if (!confirm(`Reset password for ${companyName} admin to default (123456)?`)) return;
    try {
      const result = await apiRequest(`/vendor-mgmt/vendors/${vendorId}/reset-password`, { method: 'POST', body: {} });
      showToast(`Password reset. Login: ${result.admin_login_id} / 123456`);
      await loadVendorsApp();
    } catch (error) {
      showToast(`Reset failed: ${error.message}`);
    }
  }

  async function toggleVendorActiveApp(vendorId, companyName) {
    if (!confirm(`Toggle active status for ${companyName}?`)) return;
    try {
      await apiRequest(`/vendor-mgmt/vendors/${vendorId}/toggle-active`, { method: 'PATCH', body: {} });
      showToast('Vendor status updated.');
      await loadVendorsApp();
    } catch (error) {
      showToast(`Failed: ${error.message}`);
    }
  }

  // ── Force Password Change Modal ──────────────────────────────────────────────

  function openForcePwChangeModal() {
    const modal = byId('force-pw-modal');
    if (modal) modal.style.display = 'flex';
    const inp = byId('force-pw-new');
    if (inp) { inp.value = ''; inp.focus(); }
    const conf = byId('force-pw-confirm');
    if (conf) conf.value = '';
    setText('force-pw-error', '');
  }

  async function submitForcePwChangeApp() {
    const newPw = String(byId('force-pw-new')?.value || '').trim();
    const confPw = String(byId('force-pw-confirm')?.value || '').trim();
    setText('force-pw-error', '');

    if (!newPw || newPw.length < 6) {
      setText('force-pw-error', 'Password must be at least 6 characters.');
      return;
    }
    if (newPw !== confPw) {
      setText('force-pw-error', 'Passwords do not match.');
      return;
    }

    const settingsPw = byId('settings-current-password');
    const settingsNew = byId('settings-new-password');
    const settingsConf = byId('settings-confirm-password');

    try {
      await apiRequest('/auth/change-password', {
        method: 'POST',
        body: { current_password: '123456', new_password: newPw }
      });
      const modal = byId('force-pw-modal');
      if (modal) modal.style.display = 'none';
      showToast('Password updated successfully.');
      if (settingsPw) settingsPw.value = '';
      if (settingsNew) settingsNew.value = '';
      if (settingsConf) settingsConf.value = '';
    } catch (error) {
      setText('force-pw-error', `Failed: ${error.message} — Enter old password manually in Settings if needed.`);
    }
  }

  function populateReportLocationSelect() {
    const sel = byId('report-location-id');
    if (!sel) return;
    const prev = sel.value;
    while (sel.options.length > 1) sel.remove(1);
    state.locations.forEach((loc) => {
      const opt = document.createElement('option');
      opt.value = loc.location_id;
      opt.textContent = `${loc.location_name} (${loc.location_id})`;
      sel.appendChild(opt);
    });
    if (prev && Array.from(sel.options).some((o) => o.value === prev)) sel.value = prev;

    const fromEl = byId('report-date-from');
    const toEl = byId('report-date-to');
    if (fromEl && !fromEl.value) {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      fromEl.value = d.toISOString().slice(0, 10);
    }
    if (toEl && !toEl.value) {
      toEl.value = new Date().toISOString().slice(0, 10);
    }
  }

  async function loadAuditReportApp() {
    setText('report-status', 'Loading...');
    const fromDate = String(byId('report-date-from')?.value || '').trim();
    const toDate = String(byId('report-date-to')?.value || '').trim();
    const locationId = String(byId('report-location-id')?.value || '').trim();
    const eventType = String(byId('report-event-type')?.value || '').trim();
    const limit = Number(byId('report-limit')?.value || 100);

    const params = new URLSearchParams();
    if (fromDate) params.set('from_date', fromDate);
    if (toDate) params.set('to_date', `${toDate}T23:59:59`);
    if (locationId) params.set('location_id', locationId);
    if (eventType) params.set('event_type', eventType);
    params.set('limit', String(limit));

    try {
      const result = await apiRequest(`/audit-logs?${params.toString()}`);
      const rows = Array.isArray(result?.data) ? result.data : (Array.isArray(result) ? result : []);
      state.report.rows = rows;
      state.report.loaded = true;
      renderAuditReportRows(rows);
      setText('report-status', '');
    } catch (error) {
      setText('report-status', `Failed: ${error.message}`);
      state.report.rows = [];
      state.report.loaded = false;
    }
  }

  function renderAuditReportRows(rows) {
    const wrap = byId('report-results-wrap');
    const tbody = byId('report-table-body');
    const countEl = byId('report-record-count');
    const countLabel = byId('report-count-label');

    if (countEl) {
      countEl.textContent = `${rows.length} records`;
      countEl.classList.toggle('off', rows.length === 0);
      countEl.classList.toggle('ok', rows.length > 0);
    }
    if (countLabel) countLabel.textContent = `${rows.length} record${rows.length !== 1 ? 's' : ''} loaded`;
    if (!wrap || !tbody) return;

    wrap.style.display = 'block';
    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="report-empty">No records found for the selected filters.</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map((row) => {
      const time = escapeHtml(formatDateTime(row.created_at || row.timestamp || row.createdAt));
      const loc = escapeHtml(row.location_id || row.locationId || '--');
      const event = escapeHtml(String(row.event_type || row.eventType || row.action || '--').toUpperCase());
      const details = escapeHtml(String(row.details || row.note || row.message || row.description || '').slice(0, 80));
      const user = escapeHtml(row.performed_by_login_id || row.performedByLoginId || row.user_login_id || 'System');
      return `<tr>
        <td>${time}</td>
        <td>${loc}</td>
        <td><span class="report-event-tag">${event}</span></td>
        <td>${details}</td>
        <td>${user}</td>
      </tr>`;
    }).join('');
  }

  function buildExportFilename(prefix) {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const d = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const t = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    return `${prefix}_${d}_${t}.csv`;
  }

  async function exportAuditCsvApp() {
    const rows = state.report?.rows;
    if (!Array.isArray(rows) || rows.length === 0) {
      showToast('No data loaded. Use "Load Preview" first.', true);
      return;
    }

    const headers = ['Time (IST)', 'Location ID', 'Event Type', 'Details', 'User', 'Device ID'];
    const csvRows = [headers.join(',')];
    rows.forEach((row) => {
      const time = formatDateTime(row.created_at || row.timestamp || row.createdAt);
      const loc = row.location_id || row.locationId || '';
      const event = String(row.event_type || row.eventType || row.action || '').toUpperCase();
      const details = String(row.details || row.note || row.message || row.description || '').replace(/"/g, '""');
      const user = row.performed_by_login_id || row.performedByLoginId || row.user_login_id || 'System';
      const device = row.device_id || row.deviceId || '';
      csvRows.push([`"${time}"`, `"${loc}"`, `"${event}"`, `"${details}"`, `"${user}"`, `"${device}"`].join(','));
    });

    const csvContent = csvRows.join('\n');
    const filename = buildExportFilename('FloodGuard_Report');
    const blob = new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const statusEl = byId('report-export-status');

    // Mobile (native app): use Web Share API with file — shows native share sheet
    // User can save to Files, forward via WhatsApp, email, etc.
    if (isNativeApp() && navigator.canShare) {
      const shareFile = new File([blob], filename, { type: 'text/csv' });
      if (navigator.canShare({ files: [shareFile] })) {
        try {
          await navigator.share({
            files: [shareFile],
            title: 'FloodGuard Audit Report',
            text: `${rows.length} records — ${filename}`
          });
          showToast('Report shared successfully.');
          if (statusEl) statusEl.textContent = `Shared: ${filename} (${rows.length} records)`;
        } catch (err) {
          if (err.name !== 'AbortError') {
            showToast('Share cancelled.', true);
          }
        }
        return;
      }
    }

    // Browser / Desktop PWA: standard download → goes to Downloads folder automatically
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      const savedMsg = isNativeApp()
        ? `Saved: ${filename} — check your device Downloads folder`
        : `Downloaded: ${filename} — saved to your Downloads folder`;
      showToast(savedMsg);
      if (statusEl) statusEl.textContent = `${savedMsg} (${rows.length} records)`;
    } catch (_) {
      // Last resort: clipboard
      if (navigator.clipboard) {
        navigator.clipboard.writeText(csvContent)
          .then(() => {
            showToast('Download failed. CSV data copied to clipboard — paste into a text file and save as .csv');
            if (statusEl) statusEl.textContent = 'Export copied to clipboard (download not available on this device).';
          })
          .catch(() => showToast('Export failed. No download method available.', true));
      } else {
        showToast('Export not supported on this device.', true);
      }
    }
  }

  async function changePasswordApp() {
    const currentPassword = String(byId('settings-current-password')?.value || '').trim();
    const newPassword = String(byId('settings-new-password')?.value || '').trim();
    const confirmPassword = String(byId('settings-confirm-password')?.value || '').trim();

    setText('settings-status', '');

    if (!currentPassword || !newPassword || !confirmPassword) {
      setText('settings-status', 'All fields are required.');
      return;
    }
    if (newPassword.length < 6) {
      setText('settings-status', 'New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setText('settings-status', 'New passwords do not match.');
      return;
    }

    try {
      await apiRequest('/auth/change-password', {
        method: 'POST',
        body: { current_password: currentPassword, new_password: newPassword }
      });
      ['settings-current-password', 'settings-new-password', 'settings-confirm-password'].forEach((id) => {
        const el = byId(id);
        if (el) {
          el.value = '';
        }
      });
      setText('settings-status', 'Password changed successfully.');
      showToast('Password changed successfully.');
    } catch (error) {
      setText('settings-status', `Failed: ${error.message}`);
    }
  }

  function bindHeaderMenuAutoClose() {
    if (bindHeaderMenuAutoClose.bound) {
      return;
    }
    bindHeaderMenuAutoClose.bound = true;
    document.addEventListener('click', (event) => {
      const menu = byId('top-menu');
      const trigger = byId('top-menu-btn');
      if (!menu || !trigger || menu.style.display === 'none') {
        return;
      }
      const target = event.target;
      if (target && (menu.contains(target) || trigger.contains(target))) {
        return;
      }
      closeHeaderMenu();
    });
  }

  async function bootstrap() {
    installButtonPressFeedback();
    bindHeaderMenuAutoClose();
    applyBrowserModeUi();
    setLoggedInUi(false);
    openView('view-login');
    applyVendorInstallVisibility();
    applyConfigVisibility();

    const saved = loadSession();
    if (saved) {
      state.apiBase = normalizeApiBase(saved.apiBase || '');
      state.token = String(saved.token || '');
      state.user = saved.user || null;
      state.session = saved.session || null;
      state.install.localUrl = normalizeLocalDeviceUrl(saved.install?.localUrl || '');
      state.install.provisionKey = String(saved.install?.provisionKey || '').trim();
      state.install.adcDividerRatio = Number(saved.install?.adcDividerRatio || 5.0);
      state.install.adcCalibrationFactor = Number(saved.install?.adcCalibrationFactor || 1.0);
      state.ble.phoneWifiSsid = String(saved.ble?.phoneWifiSsid || '').trim();
    }

    if (!state.apiBase) {
      state.apiBase = normalizeApiBase('');
    }
    updateVpsUrlInput();
    if (byId('login-api-base')) {
      byId('login-api-base').value = state.apiBase;
    }
    if (byId('login-id') && !byId('login-id').value) {
      byId('login-id').value = 'demo';
    }
    if (byId('login-password') && !byId('login-password').value) {
      byId('login-password').value = '123456';
    }
    if (byId('ble-provision-key') && state.install.provisionKey) {
      byId('ble-provision-key').value = state.install.provisionKey;
    }

    const ok = await verifySession();
    if (!ok) {
      applyAdminPanelVisibility();
      applyVendorInstallVisibility();
      applyConfigVisibility();
      applySettingsVisibility();
    applyComplaintsVisibility();
    applyReportsVisibility();
    applyUsersTabVisibility();
    applyVendorsTabVisibility();
      return;
    }

    const steps = [
      ['setLoggedInUi', () => setLoggedInUi(true)],
      ['openView(locations)', () => openView('view-locations')],
      ['applyAdminPanelVisibility', () => applyAdminPanelVisibility()],
      ['applyVendorLoginFieldsVisibility', () => applyVendorLoginFieldsVisibility()],
      ['populateRoleDropdown', () => populateRoleDropdown()],
      ['applyVendorInstallVisibility', () => applyVendorInstallVisibility()],
      ['applyConfigVisibility', () => applyConfigVisibility()],
      ['applySettingsVisibility', () => applySettingsVisibility()],
      ['applyComplaintsVisibility', () => applyComplaintsVisibility()],
      ['applyReportsVisibility', () => applyReportsVisibility()],
      ['applyUsersTabVisibility', () => applyUsersTabVisibility()],
      ['applyVendorsTabVisibility', () => applyVendorsTabVisibility()],
    ];
    for (const [name, fn] of steps) {
      try { fn(); } catch (e) { throw new Error(`[${name}] ${e.message}`); }
    }
    await refreshAppData();
    startPolling();
  }

  // Keep BLE list text ASCII-only and preserve a consistent "tap-to-select" UX across devices.
  function renderBleDeviceList() {
    const list = byId('ble-device-list');
    if (!list) {
      return;
    }

    if (state.ble.provisioningComplete) {
      list.innerHTML = '<div class="empty">Provisioning complete. BLE device picker is hidden.</div>';
      setText('ble-selected-device', 'Selected: hidden after successful apply');
      return;
    }

    if (state.ble.scanInProgress === true) {
      list.innerHTML = '<div class="empty scan-empty"><span class="scan-spinner on" aria-hidden="true"></span>Scanning for nearby FloodGuard BLE devices...</div>';
      return;
    }

    if (!Array.isArray(state.ble.scanResults) || state.ble.scanResults.length === 0) {
      list.innerHTML = '<div class="empty">No BLE devices found yet.</div>';
      return;
    }

    list.innerHTML = state.ble.scanResults.map((device) => {
      const selected = state.ble.selectedDeviceId === device.deviceId;
      const connected = state.ble.connectedDeviceId === device.deviceId;
      const rowClass = [
        'ble-device-row',
        selected ? 'selected' : '',
        connected ? 'connected' : ''
      ].filter(Boolean).join(' ');
      return `
        <div class="${rowClass}" onclick="selectBleDeviceApp('${escapeHtml(device.deviceId)}')">
          <div class="ble-device-name">${escapeHtml(device.name || 'Unknown')} ${selected ? '- Selected' : ''}</div>
          <div class="ble-device-meta">${escapeHtml(device.deviceId)} | RSSI ${escapeHtml(String(device.rssi ?? '--'))}</div>
          <div class="row" style="margin-top:8px;justify-content:flex-end">
            <button class="ghost-btn" style="padding:6px 10px" onclick="selectBleDeviceApp('${escapeHtml(device.deviceId)}')">
              ${selected ? 'Selected' : 'Use Device'}
            </button>
            ${connected ? '<span class="chip">CONNECTED</span>' : ''}
            ${selected && !connected ? '<span class="chip">TOUCH CONFIRMED</span>' : ''}
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
        <div class="ble-wifi-meta">RSSI ${escapeHtml(String(network.rssi ?? '--'))} | ${escapeHtml(network.auth || 'UNKNOWN')} | CH ${escapeHtml(String(network.channel ?? '--'))}</div>
        <div class="row" style="margin-top:8px;justify-content:flex-end">
          <button class="ghost-btn" style="padding:6px 10px" onclick="pickBleWifiSsidApp('${escapeHtml(network.ssid || '')}')">Use SSID</button>
        </div>
      </div>
    `).join('');
  }

  window.openView = openView;
  window.toggleHeaderMenuApp = toggleHeaderMenuApp;
  window.openMenuViewApp = openMenuViewApp;
  window.logoutFromMenuApp = logoutFromMenuApp;
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
  window.selectBleWifiOptionApp = selectBleWifiOptionApp;
  window.toggleBleWifiPasswordVisibility = toggleBleWifiPasswordVisibility;
  window.autoCalibrateVoltageFactorApp = autoCalibrateVoltageFactorApp;
  window.closeProvisionProgressModalApp = closeProvisionProgressModalApp;
  window.cancelBleProvisionFlowApp = cancelBleProvisionFlowApp;
  window.bleScanDevicesApp = bleScanDevicesApp;
  window.bleDisconnectApp = bleDisconnectApp;
  window.bleReadHealthApp = bleReadHealthApp;
  window.diagDownDeviceApp = diagDownDeviceApp;
  window.bleScanWifiApp = bleScanWifiApp;
  window.bleProvisionWifiApp = bleProvisionWifiApp;
  window.showBleNewLocationFormApp = showBleNewLocationFormApp;
  window.createAndSelectBleLocationApp = createAndSelectBleLocationApp;
  window.deleteLocationApp = deleteLocationApp;
  window.refreshLocalDeviceStatusApp = refreshLocalDeviceStatusApp;
  window.refreshDeviceConfigApp = refreshDeviceConfigApp;
  window.refreshDeviceConfigHistoryApp = refreshDeviceConfigHistoryApp;
  window.refreshAllDeviceConfigsApp = refreshAllDeviceConfigsApp;
  window.selectDeviceConfigForEditingApp = selectDeviceConfigForEditingApp;
  window.resetDeviceConfigToDefaultApp = resetDeviceConfigToDefaultApp;
  window.saveDeviceConfigApp = saveDeviceConfigApp;
  window.saveDeviceConfigLocalLanApp = saveDeviceConfigLocalLanApp;
  window.pushDeviceConfigApp = pushDeviceConfigApp;
  window.changePasswordApp = changePasswordApp;
  window.markDeviceFaultyApp = markDeviceFaultyApp;
  window.markDeviceReplacementApp = markDeviceReplacementApp;
  window.recommissionDeviceApp = recommissionDeviceApp;
  window.refreshLifecycleHistoryApp = refreshLifecycleHistoryApp;
  window.raiseComplaintApp = raiseComplaintApp;
  window.selectComplaintLocationApp = selectComplaintLocationApp;
  window.acknowledgeComplaintApp = acknowledgeComplaintApp;
  window.resolveComplaintApp = resolveComplaintApp;
  window.closeComplaintApp = closeComplaintApp;
  window.loadAuditReportApp = loadAuditReportApp;
  window.exportAuditCsvApp = exportAuditCsvApp;
  window.addLocationApp = addLocationApp;
  window.saveLocationDetailsApp = saveLocationDetailsApp;
  window.addDeviceApp = addDeviceApp;
  window.refreshAdminDevicesApp = refreshAdminDevicesApp;
  window.quickBindDeviceApp = quickBindDeviceApp;
  window.quickUnbindDeviceApp = quickUnbindDeviceApp;
  window.toggleInlineBindApp = toggleInlineBindApp;
  window.applyBindFromCardApp = applyBindFromCardApp;
  window.bindDeviceToLocationApp = bindDeviceToLocationApp;
  window.unbindDeviceFromLocationApp = unbindDeviceFromLocationApp;
  window.filterUserListApp = filterUserListApp;
  window.toggleResetPwFormApp = toggleResetPwFormApp;
  window.submitResetPasswordApp = submitResetPasswordApp;
  window.createUserApp = createUserApp;

  window.addEventListener('load', () => {
    bootstrap().catch((error) => {
      console.error('[FloodGuard] Initialization error:', error);
      showToast(`Initialization error: ${error.message}`, true);
    });
  });
})();
