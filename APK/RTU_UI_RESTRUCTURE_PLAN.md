# RTU UI Restructure Plan
**Date:** 2026-06-19  
**Scope:** APK dashboard — show Left RTU + Right RTU relay and battery status  
**Rule:** Every step is atomic. Finish and verify one step before starting the next. No refactoring beyond what is listed.

---

## 1. Client Decision (source of truth)

- Relays **Siren / Flash / Voice** are at **RTU only** (Left and Right boxes)
- R4 (Boom) is **future** — show as inactive placeholder
- MCU does **not** have output relays — remove MCU relay section from dashboard
- RTU battery shows as **OK / LOW** (from firmware `batt` field, not a voltage)
- Row 5 (duplicate relay row) in image — **remove**

---

## 2. Firmware Telemetry (what app.js receives)

```json
{
  "remote_left":  { "online": true, "batt": "OK",  "siren": false, "flash": false, "voice": false },
  "remote_right": { "online": true, "batt": "LOW", "siren": false, "flash": false, "voice": false }
}
```
Nested inside `dashboardData.latest` from the backend.

---

## 3. Current State (what exists — do NOT touch these unless listed)

### index.html
| Lines | What it is | Action |
|-------|-----------|--------|
| 157–179 | Single relay row: Siren, Beacon, Voice, Barrier (MCU side) | **REMOVE** |
| 181–199 | Power grid: battery, solar, RSSI, heartbeat | **KEEP** |
| 202–219 | Sensor grid: RS485, Switch L1/L2, Logic Mode | **KEEP** |
| 307–315 | Quick controls (Mute / Dry Run / Force Clear) | **KEEP** |

### app.js — renderDashboard() lines 3888–3901
```js
const outputs = latest?.outputs || {};
const relayStates = { siren, beacon, voice, barrier };
Object.entries(relayStates).forEach(([key, isOn]) => {
  byId(`relay-item-${key}`) ...
  byId(`relay-${key}`) ...
});
```
| Code | Action |
|------|--------|
| `relay-item-*` / `relay-*` element updates | **REPLACE** with RTU-specific updates |
| Everything else in renderDashboard() | **DO NOT TOUCH** |

---

## 4. New Element IDs (contract between HTML and JS)

### Left RTU
| Element ID | Purpose |
|-----------|---------|
| `rtu-left-online` | Text: ONLINE / OFFLINE |
| `rtu-left-batt` | Text: OK / LOW |
| `rtu-left-item-siren` | div — gets class `relay-on` when active |
| `rtu-left-siren` | Text: ON / OFF |
| `rtu-left-item-flash` | div — gets class `relay-on` when active |
| `rtu-left-flash` | Text: ON / OFF |
| `rtu-left-item-voice` | div — gets class `relay-on` when active |
| `rtu-left-voice` | Text: ON / OFF |

### Right RTU (mirror of left, prefix `rtu-right-`)
| Element ID | Purpose |
|-----------|---------|
| `rtu-right-online` | Text: ONLINE / OFFLINE |
| `rtu-right-batt` | Text: OK / LOW |
| `rtu-right-item-siren` | div — gets class `relay-on` |
| `rtu-right-siren` | Text: ON / OFF |
| `rtu-right-item-flash` | div — gets class `relay-on` |
| `rtu-right-flash` | Text: ON / OFF |
| `rtu-right-item-voice` | div — gets class `relay-on` |
| `rtu-right-voice` | Text: ON / OFF |

**R4 Boom** is shown as a static placeholder `FUTURE` — no dynamic ID needed.

---

## 5. Steps (execute in order, one at a time)

---

### STEP 1 — index.html: Remove old MCU relay row

**Find:**
```html
<!-- Relay / output indicators -->
<div class="relay-row">
  <div class="relay-item" id="relay-item-siren">
    ...
  </div>
  ... (4 items: siren, beacon, voice, barrier)
</div>
```
**Action:** Delete the entire `<div class="relay-row">...</div>` block (lines 157–179).  
**Do not touch anything before or after it.**

---

### STEP 2 — index.html: Add RTU section in place of deleted block

**Insert at the same location** (between water level vessel section and power grid):

```html
<!-- RTU Status — Left and Right -->
<div class="rtu-row">

  <!-- LEFT RTU -->
  <div class="rtu-card">
    <div class="rtu-card-header">
      <span class="rtu-title">LEFT RTU</span>
      <span class="rtu-badge rtu-badge-online" id="rtu-left-online">--</span>
    </div>
    <div class="rtu-batt-row">
      <span class="rtu-batt-label">Battery</span>
      <span class="rtu-batt-value" id="rtu-left-batt">--</span>
    </div>
    <div class="relay-row rtu-relay-row">
      <div class="relay-item" id="rtu-left-item-siren">
        <div class="relay-led"></div>
        <div class="relay-label">Siren</div>
        <div class="relay-status" id="rtu-left-siren">--</div>
      </div>
      <div class="relay-item" id="rtu-left-item-flash">
        <div class="relay-led"></div>
        <div class="relay-label">Flash</div>
        <div class="relay-status" id="rtu-left-flash">--</div>
      </div>
      <div class="relay-item" id="rtu-left-item-voice">
        <div class="relay-led"></div>
        <div class="relay-label">Voice</div>
        <div class="relay-status" id="rtu-left-voice">--</div>
      </div>
      <div class="relay-item relay-item-future">
        <div class="relay-led"></div>
        <div class="relay-label">Boom</div>
        <div class="relay-status">FUTURE</div>
      </div>
    </div>
  </div>

  <!-- RIGHT RTU -->
  <div class="rtu-card">
    <div class="rtu-card-header">
      <span class="rtu-title">RIGHT RTU</span>
      <span class="rtu-badge rtu-badge-online" id="rtu-right-online">--</span>
    </div>
    <div class="rtu-batt-row">
      <span class="rtu-batt-label">Battery</span>
      <span class="rtu-batt-value" id="rtu-right-batt">--</span>
    </div>
    <div class="relay-row rtu-relay-row">
      <div class="relay-item" id="rtu-right-item-siren">
        <div class="relay-led"></div>
        <div class="relay-label">Siren</div>
        <div class="relay-status" id="rtu-right-siren">--</div>
      </div>
      <div class="relay-item" id="rtu-right-item-flash">
        <div class="relay-led"></div>
        <div class="relay-label">Flash</div>
        <div class="relay-status" id="rtu-right-flash">--</div>
      </div>
      <div class="relay-item" id="rtu-right-item-voice">
        <div class="relay-led"></div>
        <div class="relay-label">Voice</div>
        <div class="relay-status" id="rtu-right-voice">--</div>
      </div>
      <div class="relay-item relay-item-future">
        <div class="relay-led"></div>
        <div class="relay-label">Boom</div>
        <div class="relay-status">FUTURE</div>
      </div>
    </div>
  </div>

</div>
```

---

### STEP 3 — app.css: Add RTU card styles

**Append to end of app.css** (do not modify existing rules):

```css
/* ── RTU Status Cards ───────────────────────────────────────────── */
.rtu-row {
  display: flex;
  gap: 8px;
  margin: 10px 0;
}
.rtu-card {
  flex: 1;
  background: #f5f5f5;
  border-radius: 8px;
  padding: 10px;
  border: 1px solid #e0e0e0;
}
.rtu-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}
.rtu-title {
  font-weight: 700;
  font-size: 13px;
  color: #333;
}
.rtu-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 10px;
  background: #e0e0e0;
  color: #757575;
}
.rtu-badge-online.online  { background: #c8e6c9; color: #2e7d32; }
.rtu-badge-online.offline { background: #ffcccc; color: #c62828; }
.rtu-batt-row {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  margin-bottom: 8px;
}
.rtu-batt-label { color: #757575; }
.rtu-batt-value { font-weight: 600; }
.rtu-batt-value.batt-low { color: #c62828; }
.rtu-batt-value.batt-ok  { color: #2e7d32; }
.rtu-relay-row { margin-top: 0; }
.relay-item-future { opacity: 0.4; pointer-events: none; }
```

---

### STEP 4 — app.js: Replace old relay update block in renderDashboard()

**Find this exact block** (around lines 3888–3901):
```js
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
```

**Replace with:**
```js
  // ── RTU relay + battery status ───────────────────────────────────
  const remoteLeft  = latest?.remote_left  || {};
  const remoteRight = latest?.remote_right || {};

  function updateRtu(prefix, remote) {
    const hasData = latest !== null;
    const online  = Boolean(remote.online);
    const batt    = remote.batt || '--';

    const onlineEl = byId(prefix + 'online');
    if (onlineEl) {
      onlineEl.textContent = hasData ? (online ? 'ONLINE' : 'OFFLINE') : '--';
      onlineEl.classList.toggle('online',  hasData && online);
      onlineEl.classList.toggle('offline', hasData && !online);
    }

    const battEl = byId(prefix + 'batt');
    if (battEl) {
      battEl.textContent = hasData ? batt : '--';
      battEl.classList.toggle('batt-ok',  hasData && batt === 'OK');
      battEl.classList.toggle('batt-low', hasData && batt === 'LOW');
    }

    ['siren', 'flash', 'voice'].forEach(function(relay) {
      const isOn = Boolean(remote[relay]);
      const item   = byId(prefix + 'item-' + relay);
      const status = byId(prefix + relay);
      if (item)   item.classList.toggle('relay-on', isOn);
      if (status) status.textContent = hasData ? (isOn ? 'ON' : 'OFF') : '--';
    });
  }

  updateRtu('rtu-left-',  remoteLeft);
  updateRtu('rtu-right-', remoteRight);
```

**Do not change anything else in renderDashboard().**

---

### STEP 5 — Verify no broken references

After all edits, search index.html and app.js for these old IDs — they must not appear in any live code path:

- `relay-item-siren`
- `relay-item-beacon`
- `relay-item-voice`
- `relay-item-barrier`
- `relay-siren`
- `relay-beacon`
- `relay-voice`
- `relay-barrier`
- `relay-led-siren` / `relay-led-beacon` / `relay-led-voice` / `relay-led-barrier`

If any are found: check whether the reference is in a live code path (not a comment). If live, update or remove that reference.

---

## 6. Test Checklist

### 6.1 Static / visual
- [ ] App loads without JS console errors
- [ ] LEFT RTU card visible on dashboard
- [ ] RIGHT RTU card visible on dashboard
- [ ] Old MCU relay row (Siren/Beacon/Voice/Barrier) is gone
- [ ] Boom shows as FUTURE in both cards (greyed out)

### 6.2 With firmware connected (MQTT data flowing)
- [ ] LEFT RTU shows ONLINE (green badge)
- [ ] RIGHT RTU shows ONLINE (green badge)
- [ ] LEFT RTU Battery shows OK (green) when batt="OK"
- [ ] RIGHT RTU Battery shows LOW (red) when batt="LOW"
- [ ] Siren ON/OFF updates when relay fires
- [ ] Flash ON/OFF updates when relay fires
- [ ] Voice ON/OFF updates when relay fires

### 6.3 Edge cases
- [ ] No telemetry yet → all fields show `--`, no JS crash
- [ ] Only remote_left present, remote_right missing → right side shows `--`, no crash
- [ ] batt field missing from telemetry → shows `--`, no crash
- [ ] Battery LOW → batt-low class applied (red text)
- [ ] RTU offline → OFFLINE badge (red), relay fields show OFF not `--`

### 6.4 Regression (existing features must still work)
- [ ] Water level vessel still animates
- [ ] Battery/Solar/RSSI/Heartbeat mini-cards still update
- [ ] RS485 and Switch L1/L2 sensor cards still update
- [ ] Quick controls (Mute / Dry Run / Force Clear) still appear for OPERATOR+
- [ ] Config page still loads
- [ ] Device discovery via /api/status still works

---

## 7. What NOT to change (guardrails)

- Do not rename or remove `setText`, `byId` helpers
- Do not touch `dryRunApp()` — it sends to MCU via MQTT, which is correct
- Do not touch the water level vessel animation code
- Do not touch battery_voltage / solar_voltage MCU display (those are MCU INA219 readings)
- Do not modify any API call or state management code
- Do not add new API endpoints — only UI changes
- Do not change renderDashboard() function signature

---

## 8. Files to edit (only these three)

| File | Change |
|------|--------|
| `APK/www/index.html` | Steps 1 + 2 |
| `APK/www/app.css` | Step 3 |
| `APK/www/app.js` | Step 4 |
