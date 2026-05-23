(function () {
  const STORAGE_KEY = 'fg_dashboard_session_v1';
  const REFRESH_INTERVAL_MS = 10000;
  const REQUEST_TIMEOUT_MS = 12000;
  const IST_TIMEZONE = 'Asia/Kolkata';

  const appState = {
    apiBase: '',
    apiKey: '',
    token: '',
    user: null,
    session: null,
    locations: [],
    selectedLocationId: null,
    selectedDeviceId: null,
    latestTelemetry: null,
    activeIncident: null,
    adminUsers: [],
    loading: false,
    refreshTimer: null,
    incidentTimer: null
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function setText(id, value) {
    const el = byId(id);
    if (!el) {
      return;
    }
    el.textContent = value;
  }

  function setHtml(id, value) {
    const el = byId(id);
    if (!el) {
      return;
    }
    el.innerHTML = value;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function initials(name) {
    if (!name) {
      return 'FG';
    }
    const chunks = String(name).trim().split(/\s+/).filter(Boolean);
    if (chunks.length === 1) {
      return chunks[0].slice(0, 2).toUpperCase();
    }
    return (chunks[0][0] + chunks[chunks.length - 1][0]).toUpperCase();
  }

  function normalizeApiBase(value) {
    let next = String(value || '').trim();
    if (!next) {
      if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
        return `${window.location.origin}/api`;
      }
      return 'http://127.0.0.1:4080/api';
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

  function saveSession() {
    const payload = {
      apiBase: appState.apiBase,
      apiKey: appState.apiKey,
      token: appState.token,
      user: appState.user,
      session: appState.session
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      // no-op
    }
  }

  function clearSession() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      // no-op
    }
  }

  function loadSession() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (error) {
      return null;
    }
  }

  function showToast(message, isError = false) {
    const toast = byId('toast');
    if (!toast) {
      return;
    }

    const safe = escapeHtml(message);
    const icon = isError ? 'ERR' : 'INFO';
    toast.innerHTML = `<div class="toast-msg">${icon}: ${safe}</div>`;
    toast.style.display = 'block';

    if (showToast.timer) {
      clearTimeout(showToast.timer);
    }

    showToast.timer = setTimeout(() => {
      toast.style.display = 'none';
    }, 3800);
  }

  function isVendorRole(role) {
    const r = String(role || '').toUpperCase();
    return r === 'VENDOR_SUPER_ADMIN' || r === 'VENDOR_MONITORING_USER';
  }

  function updateVendorFieldsVisibility() {
    const row = byId('auth-vendor-fields');
    if (!row) {
      return;
    }
    const role = appState.user?.role || loadSession()?.user?.role || '';
    row.style.display = (!role || isVendorRole(role)) ? '' : 'none';
  }

  function showAuthModal(show, errorMessage = '') {
    const modal = byId('auth-modal');
    if (!modal) {
      return;
    }

    modal.classList.toggle('show', show);
    setText('auth-error', errorMessage || '');

    if (show) {
      updateVendorFieldsVisibility();
      const apiInput = byId('auth-api-base');
      if (apiInput && !apiInput.value) {
        apiInput.value = normalizeApiBase(appState.apiBase || '');
      }
      const loginInput = byId('auth-login-id');
      if (loginInput) {
        setTimeout(() => loginInput.focus(), 80);
      }
    }
  }

  function formatTime(iso, withSeconds = true) {
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
      second: withSeconds ? '2-digit' : undefined,
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

  function formatRelative(iso) {
    if (!iso) {
      return 'No update';
    }
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) {
      return 'No update';
    }

    const diffMs = Date.now() - dt.getTime();
    const diffSec = Math.max(0, Math.floor(diffMs / 1000));
    if (diffSec < 10) {
      return 'Just now';
    }
    if (diffSec < 60) {
      return `${diffSec}s ago`;
    }
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) {
      return `${diffMin}m ago`;
    }
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) {
      return `${diffHour}h ago`;
    }
    return `${Math.floor(diffHour / 24)}d ago`;
  }

  function statusMeta(rawStatus) {
    const status = String(rawStatus || 'OFFLINE').toUpperCase();

    if (status.includes('DANGER')) {
      return {
        sidebarClass: 'd',
        badgeClass: 's-danger',
        label: 'DANGER',
        levelClass: 'lc-danger',
        vesselLevelClass: 'v-lvl-d',
        vesselBadgeClass: 'v-badge vb-d',
        blink: true
      };
    }

    if (status.includes('ALERT') || status.includes('WATER_DETECTED') || status.includes('CLEAR_PENDING')) {
      return {
        sidebarClass: 'a',
        badgeClass: 's-alert',
        label: 'ALERT',
        levelClass: 'lc-alert',
        vesselLevelClass: 'v-lvl-a',
        vesselBadgeClass: 'v-badge vb-a',
        blink: true
      };
    }

    if (status.includes('OFFLINE') || status.includes('FAULT')) {
      return {
        sidebarClass: 'o',
        badgeClass: 's-off',
        label: status.includes('FAULT') ? 'FAULT' : 'OFFLINE',
        levelClass: 'lc-off',
        vesselLevelClass: 'v-lvl-n',
        vesselBadgeClass: 'v-badge vb-n',
        blink: false
      };
    }

    return {
      sidebarClass: 'n',
      badgeClass: 's-ok',
      label: 'NORMAL',
      levelClass: 'lc-ok',
      vesselLevelClass: 'v-lvl-n',
      vesselBadgeClass: 'v-badge vb-n',
      blink: false
    };
  }

  function requestUrl(path) {
    const base = appState.apiBase || normalizeApiBase('');
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
      auth = true,
      timeoutMs = REQUEST_TIMEOUT_MS,
      withApiKey = false
    } = options;

    const headers = {
      'content-type': 'application/json'
    };

    if (auth && appState.token) {
      headers.authorization = `Bearer ${appState.token}`;
    }

    if (withApiKey && appState.apiKey) {
      headers['x-api-key'] = appState.apiKey;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

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
    let data = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch (error) {
      data = null;
    }

    if (!response.ok || !data || data.ok !== true) {
      const message = data?.error?.message || data?.message || raw || `HTTP ${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }

    return data.data;
  }

  function isUserAccessAdmin() {
    const role = String(appState.user?.role || '').toUpperCase();
    return role === 'VENDOR_SUPER_ADMIN' || role === 'DEPARTMENT_SUPER_ADMIN';
  }

  function applyAdminPanelVisibility() {
    const panel = byId('user-access-panel');
    if (!panel) {
      return;
    }

    const visible = isUserAccessAdmin();
    panel.style.display = visible ? 'block' : 'none';
  }

  function handleApiError(error, fallbackMessage = 'Request failed') {
    if (error?.status === 401) {
      logoutDashboard(
        true,
        'Access revoked by super admin or session expired. Please sign in again.'
      );
      return;
    }

    showToast(`${fallbackMessage}: ${error.message}`, true);
  }

  function updateClock() {
    const now = new Date();
    const value = new Intl.DateTimeFormat('en-IN', {
      timeZone: IST_TIMEZONE,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(now);
    setText('clock', `${value} IST`);
  }

  function renderSidebar() {
    const sidebar = byId('sidebar');
    if (!sidebar) {
      return;
    }

    const cards = appState.locations.map((location) => {
      const meta = statusMeta(location.status);
      const selected = location.location_id === appState.selectedLocationId;
      const waterLevel = Number.isFinite(location.water_level_mm) ? location.water_level_mm : null;
      const onlineText = String(location.device_status || '').toUpperCase() === 'OFFLINE' ? 'Offline' : 'Online';
      const onlineColor = onlineText === 'Offline' ? 'var(--danger)' : 'var(--ok)';

      return `
        <div class="lcard ${meta.sidebarClass}${selected ? ' sel' : ''}" onclick="selectLocationById('${escapeHtml(location.location_id)}')">
          <div class="lc-top">
            <div>
              <div class="lc-name">${escapeHtml(location.location_name || location.location_id)}</div>
              <div class="lc-id">${escapeHtml(location.location_id)}</div>
            </div>
            <span class="badge ${meta.badgeClass}"><span class="dot${meta.blink ? ' blink' : ''}"></span>${escapeHtml(meta.label)}</span>
          </div>
          <div class="lc-bot">
            <div>
              <span class="lc-lvl ${meta.levelClass}">${waterLevel === null ? '--' : escapeHtml(String(Math.round(waterLevel)))}</span>
              ${waterLevel === null ? '' : '<span class="lc-unit"> mm</span>'}
            </div>
            <div class="lc-time">
              <span>${escapeHtml(formatRelative(location.last_update))}</span>
              <span style="color:${onlineColor};">● ${escapeHtml(onlineText)}</span>
            </div>
          </div>
        </div>
      `;
    });

    sidebar.innerHTML = `
      <div class="sb-hdr">
        <span class="sb-title">Locations / Sthan</span>
        <span class="sb-count" id="location-count">${appState.locations.length} sites</span>
      </div>
      ${cards.join('')}
    `;
  }

  function updateBadgeElement(element, meta, fallbackLabel) {
    if (!element) {
      return;
    }
    element.className = `badge ${meta.badgeClass}`;
    element.innerHTML = `<span class="dot${meta.blink ? ' blink' : ''}"></span>${escapeHtml(fallbackLabel || meta.label)}`;
  }

  function updateStatusPanels(locationRecord, dashboardRecord) {
    const latest = dashboardRecord?.latest || null;
    appState.latestTelemetry = latest;

    const status = latest?.status || locationRecord?.status || 'OFFLINE';
    const meta = statusMeta(status);

    const location = dashboardRecord?.location || {};
    const locationName = locationRecord?.location_name || location.name || appState.selectedLocationId || 'Location';

    const waterLevel = Number.isFinite(latest?.water_level_mm) ? Math.round(latest.water_level_mm) : 0;
    const distance = Number.isFinite(latest?.distance_mm) ? Math.round(latest.distance_mm) : 0;
    const mountHeight = Number(location.sensor_mount_height_mm || 1200);
    const levelPercent = Math.max(0, Math.min(100, (waterLevel / mountHeight) * 100));

    setText('mp-name', `${appState.selectedLocationId || ''} — ${locationName}`);
    setText(
      'mp-sub',
      `${location.description || 'Flood monitoring site'} · Device: ${locationRecord?.device_id || '--'} · Mount: ${mountHeight}mm`
    );

    updateBadgeElement(byId('mp-badge'), meta, meta.label);
    setText('mp-update', 'Last Update');
    setText('mp-update-val', `${formatDateTime(latest?.timestamp || locationRecord?.last_update)} IST`);

    setText('ab-location', `${meta.label} - ${locationName}`);
    setText('ab-level', `${waterLevel}mm`);

    const waterLevelEl = byId('v-lvl');
    if (waterLevelEl) {
      waterLevelEl.className = `v-lvl ${meta.vesselLevelClass}`;
      waterLevelEl.textContent = String(waterLevel);
    }

    setText('v-dist', String(distance));
    const fill = byId('wfill');
    if (fill) {
      fill.style.height = `${levelPercent.toFixed(1)}%`;
      fill.className = `wfill ${meta.sidebarClass === 'd' ? 'wfill-d' : meta.sidebarClass === 'a' ? 'wfill-a' : 'wfill-n'}`;
    }

    const vesselBadge = byId('v-status-badge');
    if (vesselBadge) {
      vesselBadge.className = meta.vesselBadgeClass;
      vesselBadge.innerHTML = `${meta.blink ? '<span class="blink">!</span>' : '<span>●</span>'} ${escapeHtml(meta.label)}`;
    }

    const battery = Number.isFinite(latest?.battery_voltage) ? latest.battery_voltage.toFixed(1) : '--';
    const solar = Number.isFinite(latest?.solar_voltage) ? latest.solar_voltage.toFixed(1) : '--';
    setHtml('m-bat', `${escapeHtml(String(battery))}<span class="mc-unit">V</span>`);
    setText('m-sol', `${solar}V`);

    const rssi = Number.isFinite(latest?.wifi_rssi) ? Math.round(latest.wifi_rssi) : '--';
    setHtml('m-wifi', `${escapeHtml(String(rssi))}<span class="mc-unit"> dBm</span>`);

    const sw300 = Boolean(latest?.switch_300mm);
    const sw500 = Boolean(latest?.switch_500mm);
    updateSwitchWidget('300', sw300);
    updateSwitchWidget('500', sw500);

    setText('firmware-version', `Firmware: ${latest?.firmware_version || '--'}`);
    setText('heartbeat-state', String(locationRecord?.device_status || 'UNKNOWN').toUpperCase() === 'OFFLINE' ? '● Offline' : '● Online');
    setText('heartbeat-badge', latest?.primary_sensor_status === 'FAULT' ? 'Sensor Fault' : 'ESP32-S3 OK');
    byId('heartbeat-badge')?.classList.toggle('s-danger', latest?.primary_sensor_status === 'FAULT');
    byId('heartbeat-badge')?.classList.toggle('s-ok', latest?.primary_sensor_status !== 'FAULT');

    const relay = latest?.relay_status || {};
    setRelayToggle('relay-siren', Boolean(relay.siren));
    setRelayToggle('relay-beacon', Boolean(relay.beacon));
    setRelayToggle('relay-voice', Boolean(relay.voice));
    setRelayToggle('relay-barrier', Boolean(relay.barrier));

    const netSummary = byId('network-summary-badge');
    if (netSummary) {
      const connected = String(locationRecord?.device_status || '').toUpperCase() !== 'OFFLINE';
      netSummary.className = `badge ${connected ? 's-ok' : 's-danger'}`;
      netSummary.innerHTML = `<span class="dot${connected ? '' : ' blink'}"></span>${connected ? 'Connected' : 'Offline'}`;
    }

    setNetworkValue('net-wifi', latest?.wifi_connected === false ? 'Disconnected' : 'Connected', latest?.wifi_connected === false ? 'c-err' : 'c-ok');
    setNetworkValue('net-internet', latest?.internet_available === false ? 'Unavailable' : 'Available', latest?.internet_available === false ? 'c-err' : 'c-ok');
    setNetworkValue('net-sim', latest?.connected_4g === false ? 'Not Connected' : '4G Connected', latest?.connected_4g === false ? 'c-warn' : 'c-ok');
    setNetworkValue('net-signal', Number.isFinite(latest?.wifi_rssi) ? `${Math.round(latest.wifi_rssi)} dBm` : '--', 'c-txt');
    setNetworkValue('net-operator', latest?.operator_name || 'N/A', 'c-txt');
    setNetworkValue('net-wan', latest?.wan_ip || 'N/A', 'c-txt');
    setNetworkValue('net-mqtt', String(locationRecord?.device_status || '').toUpperCase() === 'OFFLINE' ? 'Disconnected' : 'Connected', String(locationRecord?.device_status || '').toUpperCase() === 'OFFLINE' ? 'c-err' : 'c-ok');
    setNetworkValue('net-mac', latest?.mac_bind_status || 'Verified', 'c-ok');

    const relayNote = byId('relay-note');
    if (relayNote) {
      relayNote.textContent = meta.sidebarClass === 'd'
        ? 'Danger active - Beacon should remain ON even if alarm is muted.'
        : 'No active danger. Relays follow latest device state.';
    }

    const tickerItems = appState.locations.map((item) => {
      const level = Number.isFinite(item.water_level_mm) ? `${Math.round(item.water_level_mm)}mm` : 'No data';
      return `${item.location_id}: ${item.status} (${level})`;
    });
    setText('ticker-content', tickerItems.join(' | '));

    const alertBar = byId('alert-bar');
    if (alertBar) {
      alertBar.style.display = meta.sidebarClass === 'd' ? 'block' : 'none';
    }
  }

  function updateSwitchWidget(level, triggered) {
    const stateId = `switch-${level}-state`;
    const contactId = `switch-${level}-contact`;
    const badgeId = `switch-${level}-badge`;

    const stateEl = byId(stateId);
    const contactEl = byId(contactId);
    const badgeEl = byId(badgeId);

    if (stateEl) {
      stateEl.textContent = triggered ? 'TRIGGERED' : 'NORMAL';
      stateEl.style.color = triggered ? 'var(--danger)' : 'var(--ok)';
    }

    if (contactEl) {
      contactEl.textContent = `Contact: ${triggered ? 'CLOSED' : 'OPEN'}`;
    }

    if (badgeEl) {
      badgeEl.className = `mc-tag ${triggered ? 's-danger' : 's-ok'}`;
      badgeEl.style.animation = triggered ? 'pulse-r 2s infinite' : 'none';
      badgeEl.textContent = triggered ? 'Active' : 'Stable';
    }
  }

  function setRelayToggle(id, isOn) {
    const toggle = byId(id);
    if (!toggle) {
      return;
    }
    toggle.className = `toggle ${isOn ? 't-on' : 't-off'}`;
    toggle.innerHTML = '<div class="tknob"></div>';
  }

  function setNetworkValue(id, text, toneClass) {
    const el = byId(id);
    if (!el) {
      return;
    }
    el.className = `ni-val ${toneClass}`;
    el.textContent = text;
  }

  function startIncidentTimer(incident) {
    if (appState.incidentTimer) {
      clearInterval(appState.incidentTimer);
      appState.incidentTimer = null;
    }

    if (!incident || incident.status !== 'ACTIVE' || !incident.started_at) {
      setText('m-inc', '--:--:--');
      setText('incident-started', 'Started: --');
      return;
    }

    setText('incident-started', `Started: ${formatDateTime(incident.started_at)} IST`);

    const tick = () => {
      const start = new Date(incident.started_at);
      const elapsed = Math.max(0, Math.floor((Date.now() - start.getTime()) / 1000));
      const hh = String(Math.floor(elapsed / 3600)).padStart(2, '0');
      const mm = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
      const ss = String(elapsed % 60).padStart(2, '0');
      setText('m-inc', `${hh}:${mm}:${ss}`);
    };

    tick();
    appState.incidentTimer = setInterval(tick, 1000);
  }

  function eventBadge(eventType) {
    const event = String(eventType || '').toUpperCase();

    if (event.includes('DANGER')) {
      return { cls: 'ev ev-d', label: 'DANGER' };
    }
    if (event.includes('ALERT')) {
      return { cls: 'ev ev-a', label: 'ALERT' };
    }
    if (event.includes('MUTE')) {
      return { cls: 'ev ev-w', label: 'MUTED' };
    }
    if (event.includes('CLEAR')) {
      return { cls: 'ev ev-n', label: 'CLEARED' };
    }
    if (event.includes('OFFLINE')) {
      return { cls: 'ev ev-o', label: 'OFFLINE' };
    }

    return { cls: 'ev ev-i', label: event || 'EVENT' };
  }

  function renderAuditLogs(logs) {
    const tbody = byId('audit-body');
    if (!tbody) {
      return;
    }

    if (!Array.isArray(logs) || logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="padding:14px;color:#64748b">No audit logs available yet.</td></tr>';
      return;
    }

    const rows = logs.slice(0, 12).map((log) => {
      const badge = eventBadge(log.event_type);
      const time = formatTime(log.timestamp, true);
      const by = log.login_id || log.performed_by || 'System';
      const deviceId = log.details?.device_id || log.device_id || null;
      const locationId = log.location_id || appState.selectedLocationId || '--';
      const detailChunks = [];
      if (log.details?.reason) {
        detailChunks.push(`Reason: ${log.details.reason}`);
      }
      if (log.details?.command_id) {
        detailChunks.push(`Cmd: ${log.details.command_id}`);
      }
      if (log.details?.level) {
        detailChunks.push(`Level: ${log.details.level}`);
      }
      if (log.details?.water_level_mm != null) {
        detailChunks.push(`Water: ${Math.round(log.details.water_level_mm)}mm`);
      }
      if (log.details?.status) {
        detailChunks.push(`Status: ${log.details.status}`);
      }
      const detailsText = detailChunks.length > 0 ? detailChunks.join(' | ') : 'Action logged';
      const locationCell = deviceId
        ? `${escapeHtml(locationId)}<br><span style="font-size:11px;color:#64748b">${escapeHtml(deviceId)}</span>`
        : escapeHtml(locationId);

      return `
        <tr>
          <td style="font-variant-numeric:tabular-nums;white-space:nowrap">${escapeHtml(time)}</td>
          <td><span class="${badge.cls}">${escapeHtml(badge.label)}</span></td>
          <td>${locationCell}</td>
          <td>${escapeHtml(detailsText)}</td>
          <td>${escapeHtml(by)}</td>
        </tr>
      `;
    });

    tbody.innerHTML = rows.join('');
  }

  function renderAdminUsers(users) {
    const tbody = byId('user-access-body');
    if (!tbody) {
      return;
    }

    if (!Array.isArray(users) || users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="padding:12px;color:#64748b">No managed users found.</td></tr>';
      return;
    }

    tbody.innerHTML = users.map((user) => {
      const isActive = Boolean(user.is_active);
      const actionLabel = isActive ? 'Revoke' : 'Grant';
      const badgeClass = isActive ? 's-ok' : 's-danger';
      const safeUserId = escapeHtml(user.user_id);
      return `
        <tr>
          <td>${escapeHtml(user.login_id)}</td>
          <td>${escapeHtml(user.name || '--')}</td>
          <td>${escapeHtml(user.role || '--')}</td>
          <td><span class="badge ${badgeClass}"><span class="dot${isActive ? '' : ' blink'}"></span>${isActive ? 'ACTIVE' : 'REVOKED'}</span></td>
          <td>${escapeHtml(String(user.active_session_count ?? 0))}</td>
          <td>
            <button class="btn-sm" onclick="toggleUserAccess('${safeUserId}', ${isActive ? 'false' : 'true'})">${actionLabel}</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  async function refreshAdminUsers() {
    if (!isUserAccessAdmin()) {
      return;
    }

    try {
      const users = await apiRequest('/admin/users', { auth: true });
      appState.adminUsers = Array.isArray(users) ? users : [];
      renderAdminUsers(appState.adminUsers);
    } catch (error) {
      handleApiError(error, 'Failed loading user access list');
    }
  }

  async function createAdminUser() {
    if (!isUserAccessAdmin()) {
      showToast('Only super admin can create login access.', true);
      return;
    }

    const loginId = String(byId('ua-login-id')?.value || '').trim();
    const name = String(byId('ua-name')?.value || '').trim();
    const password = String(byId('ua-password')?.value || '').trim();
    const role = String(byId('ua-role')?.value || 'OPERATOR').trim().toUpperCase();
    const activeMode = String(byId('ua-active-mode')?.value || 'active').trim().toLowerCase();
    const isActive = activeMode !== 'deactive';
    const assignedRaw = String(byId('ua-assigned-locations')?.value || '').trim();
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

      ['ua-login-id', 'ua-name', 'ua-password', 'ua-assigned-locations'].forEach((fieldId) => {
        const el = byId(fieldId);
        if (el) {
          el.value = '';
        }
      });
      showToast(`Login access created for ${loginId} (${isActive ? 'active' : 'deactive'})`);
      await refreshAdminUsers();
    } catch (error) {
      handleApiError(error, 'Create login access failed');
    }
  }

  async function toggleUserAccess(userId, shouldActivate) {
    if (!isUserAccessAdmin()) {
      showToast('Only super admin can manage access.', true);
      return;
    }

    const nextState = Boolean(shouldActivate);
    let reason = '';
    if (!nextState) {
      reason = String(window.prompt('Reason to revoke access (minimum 5 characters):', '') || '').trim();
      if (reason.length < 5) {
        showToast('Revoke reason is required (minimum 5 characters).', true);
        return;
      }
    }

    try {
      await apiRequest(`/admin/users/${encodeURIComponent(userId)}/access`, {
        method: 'PATCH',
        body: {
          is_active: nextState,
          reason
        }
      });
      showToast(nextState ? 'User access granted.' : 'User access revoked.');
      await refreshAdminUsers();
    } catch (error) {
      handleApiError(error, 'Update user access failed');
    }
  }

  async function fetchLocations() {
    const locations = await apiRequest('/locations', { auth: true });
    appState.locations = Array.isArray(locations) ? locations : [];

    if (!appState.selectedLocationId || !appState.locations.some((x) => x.location_id === appState.selectedLocationId)) {
      const first = appState.locations[0];
      if (first) {
        appState.selectedLocationId = first.location_id;
        appState.selectedDeviceId = first.device_id || null;
      }
    }
  }

  async function fetchLocationDetails(locationId) {
    const [dashboard, incidents, auditLogs] = await Promise.all([
      apiRequest(`/locations/${encodeURIComponent(locationId)}/dashboard`, { auth: true }),
      apiRequest(`/incidents?location_id=${encodeURIComponent(locationId)}`, { auth: true }),
      apiRequest(`/audit-logs?location_id=${encodeURIComponent(locationId)}`, { auth: true })
    ]);

    return {
      dashboard,
      incidents: Array.isArray(incidents) ? incidents : [],
      auditLogs: Array.isArray(auditLogs) ? auditLogs : []
    };
  }

  async function refreshDashboard() {
    if (appState.loading || !appState.token) {
      return;
    }

    appState.loading = true;
    try {
      await fetchLocations();
      renderSidebar();

      if (!appState.selectedLocationId) {
        return;
      }

      const selected = appState.locations.find((x) => x.location_id === appState.selectedLocationId) || null;
      appState.selectedDeviceId = selected?.device_id || null;

      const detail = await fetchLocationDetails(appState.selectedLocationId);
      const activeIncident = detail.incidents.find((item) => item.status === 'ACTIVE') || null;
      appState.activeIncident = activeIncident;

      updateStatusPanels(selected, detail.dashboard);
      startIncidentTimer(activeIncident);
      renderAuditLogs(detail.auditLogs);
      if (isUserAccessAdmin()) {
        await refreshAdminUsers();
      }

      setText('last-refresh', `Updated ${formatTime(new Date().toISOString(), true)} IST`);
    } catch (error) {
      handleApiError(error, 'Refresh failed');
    } finally {
      appState.loading = false;
    }
  }

  async function verifySession() {
    if (!appState.token) {
      return false;
    }

    try {
      const me = await apiRequest('/auth/me', { auth: true });
      appState.user = me.user;
      appState.session = me.session;
      hydrateUserChip();
      saveSession();
      return true;
    } catch (error) {
      return false;
    }
  }

  function populateRoleDropdown() {
    const select = byId('ua-role');
    if (!select) {
      return;
    }

    const role = String(appState.user?.role || '').toUpperCase();
    const vendorOptions = [
      { value: 'DEPARTMENT_SUPER_ADMIN', label: 'DEPARTMENT_SUPER_ADMIN' },
      { value: 'DEPARTMENT_ADMIN', label: 'DEPARTMENT_ADMIN' },
      { value: 'LOCATION_ADMIN', label: 'LOCATION_ADMIN' },
      { value: 'OPERATOR', label: 'OPERATOR' },
      { value: 'VIEWER', label: 'VIEWER' },
      { value: 'AUDITOR', label: 'AUDITOR' },
      { value: 'VENDOR_MONITORING_USER', label: 'VENDOR_MONITORING_USER' }
    ];
    const deptOptions = [
      { value: 'DEPARTMENT_ADMIN', label: 'DEPARTMENT_ADMIN' },
      { value: 'LOCATION_ADMIN', label: 'LOCATION_ADMIN' },
      { value: 'OPERATOR', label: 'OPERATOR' },
      { value: 'VIEWER', label: 'VIEWER' },
      { value: 'AUDITOR', label: 'AUDITOR' }
    ];

    const options = role === 'VENDOR_SUPER_ADMIN' ? vendorOptions : deptOptions;
    select.innerHTML = options
      .map((opt) => `<option value="${escapeHtml(opt.value)}">${escapeHtml(opt.label)}</option>`)
      .join('');
  }

  function hydrateUserChip() {
    const name = appState.user?.name || appState.user?.login_id || 'User';
    setText('user-name', name);
    setText('user-avatar', initials(name));

    const role = appState.user?.role || 'UNKNOWN';
    setText('control-user-role', `Logged in as: ${name} - ${role}`);
    applyAdminPanelVisibility();
    populateRoleDropdown();
    updateVendorFieldsVisibility();
  }

  function applySessionPayload(payload) {
    if (!payload) {
      return;
    }

    appState.apiBase = normalizeApiBase(payload.apiBase || '');
    appState.apiKey = String(payload.apiKey || '');
    appState.token = String(payload.token || '');
    appState.user = payload.user || null;
    appState.session = payload.session || null;

    if (byId('auth-api-base')) {
      byId('auth-api-base').value = appState.apiBase;
    }
    if (byId('auth-api-key')) {
      byId('auth-api-key').value = appState.apiKey;
    }
  }

  async function loginToDashboard() {
    const apiBaseInput = byId('auth-api-base');
    const loginInput = byId('auth-login-id');
    const passwordInput = byId('auth-password');
    const apiKeyInput = byId('auth-api-key');

    const apiBase = normalizeApiBase(apiBaseInput?.value || '');
    const loginId = String(loginInput?.value || '').trim();
    const password = String(passwordInput?.value || '').trim();
    const apiKey = String(apiKeyInput?.value || '').trim();

    if (!loginId || !password) {
      showAuthModal(true, 'Login ID and password are required.');
      return;
    }

    appState.apiBase = apiBase;
    appState.apiKey = apiKey;

    try {
      const result = await apiRequest('/auth/login', {
        auth: false,
        method: 'POST',
        body: {
          login_id: loginId,
          password,
          app_type: 'PWA',
          device_name: `FloodGuard Dashboard (${navigator.platform || 'web'})`
        }
      });

      appState.token = result.token;
      appState.user = result.user;
      appState.session = result.session;

      hydrateUserChip();
      saveSession();
      showAuthModal(false);
      showToast('Connected to FloodGuard VPS');

      if (passwordInput) {
        passwordInput.value = '';
      }

      await refreshDashboard();
      startPolling();
    } catch (error) {
      showAuthModal(true, `Login failed: ${error.message}`);
    }
  }

  function logoutDashboard(isAuto = false, message = 'Session reset. Please sign in again.') {
    appState.token = '';
    appState.user = null;
    appState.session = null;
    appState.locations = [];
    appState.selectedLocationId = null;
    appState.selectedDeviceId = null;
    appState.latestTelemetry = null;
    appState.activeIncident = null;
    appState.adminUsers = [];

    if (appState.refreshTimer) {
      clearInterval(appState.refreshTimer);
      appState.refreshTimer = null;
    }

    if (appState.incidentTimer) {
      clearInterval(appState.incidentTimer);
      appState.incidentTimer = null;
    }

    clearSession();
    applyAdminPanelVisibility();
    renderAuditLogs([]);
    renderSidebar();
    renderAdminUsers([]);
    showAuthModal(true, message);
    showToast(isAuto ? message : 'Session cleared', isAuto);
  }

  function startPolling() {
    if (appState.refreshTimer) {
      clearInterval(appState.refreshTimer);
    }
    appState.refreshTimer = setInterval(() => {
      refreshDashboard().catch(() => {
        // handled inside refreshDashboard
      });
    }, REFRESH_INTERVAL_MS);
  }

  function selectLocationById(locationId) {
    appState.selectedLocationId = locationId;
    const selected = appState.locations.find((item) => item.location_id === locationId) || null;
    appState.selectedDeviceId = selected?.device_id || null;
    renderSidebar();
    refreshDashboard().catch(() => {
      // handled
    });
  }

  // Compatibility shim for static mockup cards that still use selectLocation(index).
  function selectLocation(index) {
    const numericIndex = Number(index);
    if (!Number.isInteger(numericIndex) || numericIndex < 0) {
      return;
    }

    const liveRecord = appState.locations[numericIndex];
    if (liveRecord?.location_id) {
      selectLocationById(liveRecord.location_id);
      return;
    }

    const cards = document.querySelectorAll('#sidebar .lcard');
    cards.forEach((card, cardIndex) => {
      card.classList.toggle('sel', cardIndex === numericIndex);
    });
  }

  async function muteAlarm() {
    if (!appState.selectedLocationId || !appState.selectedDeviceId) {
      showToast('Select a valid location first.', true);
      return;
    }

    try {
      await apiRequest('/commands/mute', {
        method: 'POST',
        body: {
          location_id: appState.selectedLocationId,
          device_id: appState.selectedDeviceId
        }
      });
      showToast('Mute command submitted.');
      await refreshDashboard();
    } catch (error) {
      handleApiError(error, 'Mute failed');
    }
  }

  async function dryRun() {
    if (!appState.selectedLocationId || !appState.selectedDeviceId) {
      showToast('Select a valid location first.', true);
      return;
    }

    try {
      await apiRequest('/commands/dry-run', {
        method: 'POST',
        body: {
          location_id: appState.selectedLocationId,
          device_id: appState.selectedDeviceId,
          outputs: ['siren', 'beacon', 'voice']
        }
      });
      showToast('Dry-run command submitted.');
      await refreshDashboard();
    } catch (error) {
      handleApiError(error, 'Dry-run failed');
    }
  }

  async function forceClear() {
    const reasonInput = byId('fc-reason');
    const reason = String(reasonInput?.value || '').trim();

    if (!reason || reason.length < 5) {
      showToast('Force clear reason is required (min 5 chars).', true);
      if (reasonInput) {
        reasonInput.focus();
      }
      return;
    }

    if (!appState.selectedLocationId || !appState.selectedDeviceId) {
      showToast('Select a valid location first.', true);
      return;
    }

    try {
      await apiRequest('/commands/force-clear', {
        method: 'POST',
        body: {
          location_id: appState.selectedLocationId,
          device_id: appState.selectedDeviceId,
          reason
        }
      });

      if (reasonInput) {
        reasonInput.value = '';
      }
      byId('fc-modal')?.classList.remove('show');
      showToast('Force clear command submitted.');
      await refreshDashboard();
    } catch (error) {
      handleApiError(error, 'Force clear failed');
    }
  }

  async function initializeDashboard() {
    updateClock();
    setInterval(updateClock, 1000);

    const saved = loadSession();
    applySessionPayload(saved);

    if (!appState.apiBase) {
      appState.apiBase = normalizeApiBase('');
      const apiInput = byId('auth-api-base');
      if (apiInput) {
        apiInput.value = appState.apiBase;
      }
    }

    const valid = await verifySession();
    if (!valid) {
      showAuthModal(true);
      return;
    }

    showAuthModal(false);
    await refreshDashboard();
    startPolling();
  }

  window.showToast = showToast;
  window.loginToDashboard = loginToDashboard;
  window.logoutDashboard = logoutDashboard;
  window.selectLocation = selectLocation;
  window.selectLocationById = selectLocationById;
  window.muteAlarm = muteAlarm;
  window.dryRun = dryRun;
  window.forceClear = forceClear;
  window.refreshAdminUsers = refreshAdminUsers;
  window.createAdminUser = createAdminUser;
  window.toggleUserAccess = toggleUserAccess;

  window.addEventListener('load', () => {
    initializeDashboard().catch((error) => {
      showToast(`Initialization error: ${error.message}`, true);
      showAuthModal(true, `Initialization error: ${error.message}`);
    });
  });
})();
