const bcrypt = require('bcryptjs');
const { dataStore } = require('./datastore');
const { ROLE } = require('../config/permissions');

function seedIfEmpty() {
  if (dataStore.users.length > 0) {
    return;
  }

  const passwordHash = bcrypt.hashSync('Pass@123', 10);
  const demoPasswordHash = bcrypt.hashSync('123456', 10);

  dataStore.users = [
    {
      _id: 'user_vendor_001',
      login_id: 'vendor_admin',
      password_hash: passwordHash,
      name: 'Vendor Super Admin',
      role: ROLE.VENDOR_SUPER_ADMIN,
      vendor_id: 'vendor_001',
      department_id: 'dept_001',
      assigned_location_ids: ['RUB043'],
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      _id: 'user_jenix_ebonx',
      login_id: 'ebonx',
      password_hash: bcrypt.hashSync('ebnox_123', 10),
      name: 'Jenix Admin (ebonx)',
      role: ROLE.VENDOR_SUPER_ADMIN,
      vendor_id: 'vendor_001',
      department_id: null,
      assigned_location_ids: [],
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      _id: 'user_vendor_demo',
      login_id: 'demo',
      password_hash: demoPasswordHash,
      name: 'Demo Super Admin',
      role: ROLE.VENDOR_SUPER_ADMIN,
      vendor_id: 'vendor_001',
      department_id: 'dept_001',
      assigned_location_ids: ['RUB043'],
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      _id: 'user_operator_043',
      login_id: 'operator_rub043',
      password_hash: passwordHash,
      name: 'Operator RUB 043',
      role: ROLE.OPERATOR,
      vendor_id: 'vendor_001',
      department_id: 'dept_001',
      assigned_location_ids: ['RUB043'],
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      _id: 'user_viewer_043',
      login_id: 'viewer_rub043',
      password_hash: passwordHash,
      name: 'Viewer RUB 043',
      role: ROLE.VIEWER,
      vendor_id: 'vendor_001',
      department_id: 'dept_001',
      assigned_location_ids: ['RUB043'],
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      _id: 'user_operator_057',
      login_id: 'operator_rub057',
      password_hash: passwordHash,
      name: 'Operator RUB 057',
      role: ROLE.OPERATOR,
      vendor_id: 'vendor_001',
      department_id: 'dept_001',
      assigned_location_ids: ['RUB057'],
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      _id: 'user_operator_071',
      login_id: 'operator_rub071',
      password_hash: passwordHash,
      name: 'Operator RUB 071',
      role: ROLE.OPERATOR,
      vendor_id: 'vendor_001',
      department_id: 'dept_001',
      assigned_location_ids: ['RUB071'],
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  ];

  dataStore.locations = [
    {
      _id: 'RUB043',
      name: 'RUB 43 — Pune Central',
      description: 'Railway Under Bridge 43, Near Pune Junction — High traffic zone',
      department_id: 'dept_001',
      sensor_mount_height_mm: 1200,
      alert_level_mm: 300,
      danger_level_mm: 500,
      danger_clear_level_mm: 450,
      maintenance_status: 'OK',
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      _id: 'RUB057',
      name: 'RUB 57 — Khadki',
      description: 'Railway Under Bridge 57, Khadki — Residential area underpass',
      department_id: 'dept_001',
      sensor_mount_height_mm: 1100,
      alert_level_mm: 250,
      danger_level_mm: 450,
      danger_clear_level_mm: 400,
      maintenance_status: 'OK',
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      _id: 'RUB071',
      name: 'RUB 71 — Dapodi',
      description: 'Railway Under Bridge 71, Dapodi — Flood-prone low-lying zone',
      department_id: 'dept_001',
      sensor_mount_height_mm: 1300,
      alert_level_mm: 200,
      danger_level_mm: 400,
      danger_clear_level_mm: 350,
      maintenance_status: 'OK',
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  ];

  dataStore.devices = [
    {
      _id: 'RUB043-CTRL01',
      location_id: 'RUB043',
      device_type: 'ESP32_S3',
      firmware_version: '0.2.0-dev',
      hardware_version: 'BA-S3-DA4',
      mqtt_topic_base: 'rub/RUB043-CTRL01',
      operational_status: 'ACTIVE',
      lifecycle_note: 'Seed active device',
      lifecycle_updated_at: new Date().toISOString(),
      last_seen: new Date().toISOString(),
      status: 'ONLINE',
      config: {
        daily_reboot_enabled: true,
        daily_reboot_time: '03:30',
        timezone: 'Asia/Kolkata',
        reporting_profile: 'dynamic'
      }
    },
    {
      _id: 'RUB057-CTRL01',
      location_id: 'RUB057',
      device_type: 'ESP32_S3',
      firmware_version: '0.2.0-dev',
      hardware_version: 'BA-S3-DA4',
      mqtt_topic_base: 'rub/RUB057-CTRL01',
      operational_status: 'ACTIVE',
      lifecycle_note: 'Seed active device',
      lifecycle_updated_at: new Date().toISOString(),
      last_seen: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
      status: 'ONLINE',
      config: {
        daily_reboot_enabled: true,
        daily_reboot_time: '03:30',
        timezone: 'Asia/Kolkata',
        reporting_profile: 'dynamic'
      }
    },
    {
      _id: 'RUB071-CTRL01',
      location_id: 'RUB071',
      device_type: 'ESP32_S3',
      firmware_version: '0.2.0-dev',
      hardware_version: 'BA-S3-DA4',
      mqtt_topic_base: 'rub/RUB071-CTRL01',
      operational_status: 'ACTIVE',
      lifecycle_note: 'Seed active device',
      lifecycle_updated_at: new Date().toISOString(),
      last_seen: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
      status: 'OFFLINE',
      config: {
        daily_reboot_enabled: true,
        daily_reboot_time: '03:30',
        timezone: 'Asia/Kolkata',
        reporting_profile: 'dynamic'
      }
    }
  ];

  dataStore.deviceConfigs = [
    {
      _id: 'cfg_current_rub043_ctrl01',
      device_id: 'RUB043-CTRL01',
      location_id: 'RUB043',
      alert_level_mm: 200,
      danger_level_mm: 500,
      clear_level_mm: 450,
      trigger_delay_seconds: 60,
      clear_delay_seconds: 300,
      rs485_sensor_enabled: true,
      switch_sensor_enabled: true,
      switch_level_1_mm: 300,
      switch_level_2_mm: 500,
      sensor_mount_height_mm: 1200,
      mismatch_duration_seconds: 120,
      config_version: 1,
      state: 'ACTIVE',
      last_applied_at: new Date().toISOString(),
      last_applied_by: 'seed',
      last_ack_at: new Date().toISOString(),
      last_ack_status: 'SUCCESS',
      last_ack_message: 'seed'
    }
  ];

  dataStore.deviceConfigHistory = [
    {
      _id: 'cfg_hist_rub043_ctrl01_v1',
      device_id: 'RUB043-CTRL01',
      location_id: 'RUB043',
      config_version: 1,
      state: 'ACTIVE',
      source: 'seed',
      requested_by: 'seed',
      requested_at: new Date().toISOString(),
      config: {
        alert_level_mm: 200,
        danger_level_mm: 500,
        clear_level_mm: 450,
        trigger_delay_seconds: 60,
        clear_delay_seconds: 300,
        rs485_sensor_enabled: true,
        switch_sensor_enabled: true,
        switch_level_1_mm: 300,
        switch_level_2_mm: 500,
        sensor_mount_height_mm: 1200,
        mismatch_duration_seconds: 120
      },
      ack: {
        status: 'SUCCESS',
        at: new Date().toISOString(),
        message: 'seed'
      }
    }
  ];

  // ── Demo telemetry: recent readings for all 3 sites ────────────────────────
  const now = Date.now();
  const tel = (id, loc, mm, ts) => ({ _id: id, device_id: loc + '-CTRL01', location_id: loc, water_level_mm: mm, raw_distance_mm: 1200 - mm, rs485_mm: mm + Math.round(Math.random() * 5), switch_1: mm >= 300, switch_2: mm >= 500, relay_active: mm >= 300, battery_voltage: 12.3, rssi: -62, timestamp: new Date(ts).toISOString(), received_at: new Date(ts).toISOString() });
  dataStore.telemetry = [
    tel('tel_043_1', 'RUB043', 95,  now - 30000),
    tel('tel_043_2', 'RUB043', 88,  now - 90000),
    tel('tel_043_3', 'RUB043', 102, now - 150000),
    tel('tel_057_1', 'RUB057', 342, now - 45000),
    tel('tel_057_2', 'RUB057', 318, now - 105000),
    tel('tel_057_3', 'RUB057', 275, now - 165000),
    tel('tel_071_1', 'RUB071', 520, now - 480000),
    tel('tel_071_2', 'RUB071', 498, now - 540000),
    tel('tel_071_3', 'RUB071', 461, now - 600000)
  ];

  // ── Demo incidents: RUB057 in active ALERT, RUB071 recently resolved ───────
  dataStore.incidents = [
    {
      _id: 'inc_057_active',
      location_id: 'RUB057',
      device_id: 'RUB057-CTRL01',
      level: 'ALERT',
      status: 'ACTIVE',
      water_level_mm: 342,
      triggered_at: new Date(now - 45000).toISOString(),
      muted_at: null,
      muted_by: null,
      cleared_at: null,
      cleared_by: null,
      notes: null
    },
    {
      _id: 'inc_071_resolved',
      location_id: 'RUB071',
      device_id: 'RUB071-CTRL01',
      level: 'DANGER',
      status: 'CLEARED',
      water_level_mm: 524,
      triggered_at: new Date(now - 600000).toISOString(),
      muted_at: new Date(now - 580000).toISOString(),
      muted_by: 'operator_rub071',
      cleared_at: new Date(now - 120000).toISOString(),
      cleared_by: 'system',
      notes: 'Water receded after rain stopped'
    }
  ];

  // ── Demo audit log entries ──────────────────────────────────────────────────
  dataStore.auditLogs = [
    { _id: 'al_001', location_id: 'RUB071', event_type: 'ALARM_TRIGGERED',  performed_by: 'system', login_id: 'system', details: { level: 'DANGER', water_level_mm: 524 }, created_at: new Date(now - 600000).toISOString() },
    { _id: 'al_002', location_id: 'RUB071', event_type: 'ALARM_MUTED',      performed_by: 'user_operator_071', login_id: 'operator_rub071', details: { reason: 'Acknowledged' }, created_at: new Date(now - 580000).toISOString() },
    { _id: 'al_003', location_id: 'RUB057', event_type: 'ALARM_TRIGGERED',  performed_by: 'system', login_id: 'system', details: { level: 'ALERT', water_level_mm: 318 }, created_at: new Date(now - 105000).toISOString() },
    { _id: 'al_004', location_id: 'RUB071', event_type: 'ALARM_CLEARED',    performed_by: 'system', login_id: 'system', details: { level: 'DANGER', water_level_mm: 350 }, created_at: new Date(now - 120000).toISOString() },
    { _id: 'al_005', location_id: 'RUB043', event_type: 'DEVICE_ONLINE',    performed_by: 'system', login_id: 'system', details: { device_id: 'RUB043-CTRL01' }, created_at: new Date(now - 1800000).toISOString() },
    { _id: 'al_006', location_id: 'RUB057', event_type: 'DEVICE_ONLINE',    performed_by: 'system', login_id: 'system', details: { device_id: 'RUB057-CTRL01' }, created_at: new Date(now - 3600000).toISOString() }
  ];

  dataStore.firmwareVersions = [
    {
      _id: 'fw_floodguard_s3_0_2_0',
      target: 'ESP32_S3',
      hardware_code: 'BA-S3-DA4',
      version: '0.2.0',
      file_url: 'https://flash.iotsoft.in/firmware/floodguard-s3-0.2.0.bin',
      sha256: 'mock-sha256-value-020',
      mandatory: false,
      release_notes: 'Baseline OTA-enabled build',
      created_at: new Date('2026-05-18T00:00:00Z').toISOString()
    }
  ];

  dataStore.projects = [
    {
      _id: 'proj_floodguard',
      name: 'FloodGuard',
      description: 'RUB Water Level Monitoring & Flood Alarm System',
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  ];

  dataStore.vendors = [
    {
      _id: 'vendor_001',
      company_name: 'Jenix Technology',
      contact_name: 'Jenix Admin',
      mobile: '9999999999',
      email: 'admin@jenix.in',
      is_master_vendor: true,
      projects: [
        { project_id: 'proj_floodguard', role: 'OWNER' }
      ],
      admin_login_id: 'vendor_admin',
      admin_user_id: 'user_vendor_001',
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  ];
}

module.exports = {
  seedIfEmpty
};
