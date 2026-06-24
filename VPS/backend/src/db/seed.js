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
      role: ROLE.DEMO_SUPER_ADMIN,
      vendor_id: 'vendor_001',
      department_id: 'dept_001',
      assigned_location_ids: [],
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

  const now = new Date().toISOString();
  dataStore.locations = [
    {
      _id: 'RUB043',
      name: 'RUB 043 Main Crossing',
      description: 'Seed location for regression tests',
      department_id: 'dept_001',
      sensor_mount_height_mm: 1200,
      alert_level_mm: 200,
      danger_level_mm: 500,
      danger_clear_level_mm: 450,
      maintenance_status: 'OK',
      operational_status: 'ACTIVE',
      lifecycle_note: null,
      lifecycle_updated_at: now,
      is_active: true,
      created_at: now,
      updated_at: now
    },
    {
      _id: 'RUB057',
      name: 'RUB 057 Yard',
      description: 'Seed location',
      department_id: 'dept_001',
      sensor_mount_height_mm: 1200,
      alert_level_mm: 200,
      danger_level_mm: 500,
      danger_clear_level_mm: 450,
      maintenance_status: 'OK',
      operational_status: 'ACTIVE',
      lifecycle_note: null,
      lifecycle_updated_at: now,
      is_active: true,
      created_at: now,
      updated_at: now
    },
    {
      _id: 'RUB071',
      name: 'RUB 071 Siding',
      description: 'Seed location',
      department_id: 'dept_001',
      sensor_mount_height_mm: 1200,
      alert_level_mm: 200,
      danger_level_mm: 500,
      danger_clear_level_mm: 450,
      maintenance_status: 'OK',
      operational_status: 'ACTIVE',
      lifecycle_note: null,
      lifecycle_updated_at: now,
      is_active: true,
      created_at: now,
      updated_at: now
    }
  ];

  dataStore.devices = [
    {
      _id: 'RUB043-CTRL01',
      location_id: 'RUB043',
      device_type: 'ESP32_S3',
      firmware_version: '0.2.0-dev',
      hardware_version: 'BA-S3-DA4',
      mqtt_topic_base: 'floodguard/RUB043-CTRL01',
      operational_status: 'ACTIVE',
      lifecycle_note: null,
      lifecycle_updated_at: now,
      last_seen: null,
      last_heartbeat: null,
      status: 'OFFLINE',
      created_at: now,
      updated_at: now,
      config: { daily_reboot_enabled: true, daily_reboot_time: '03:30', timezone: 'Asia/Kolkata', reporting_profile: 'dynamic' }
    },
    {
      _id: 'RUB057-CTRL01',
      location_id: 'RUB057',
      device_type: 'ESP32_S3',
      firmware_version: '0.2.0-dev',
      hardware_version: 'BA-S3-DA4',
      mqtt_topic_base: 'floodguard/RUB057-CTRL01',
      operational_status: 'ACTIVE',
      lifecycle_note: null,
      lifecycle_updated_at: now,
      last_seen: null,
      last_heartbeat: null,
      status: 'OFFLINE',
      created_at: now,
      updated_at: now,
      config: { daily_reboot_enabled: true, daily_reboot_time: '03:30', timezone: 'Asia/Kolkata', reporting_profile: 'dynamic' }
    },
    {
      _id: 'RUB071-CTRL01',
      location_id: 'RUB071',
      device_type: 'ESP32_S3',
      firmware_version: '0.2.0-dev',
      hardware_version: 'BA-S3-DA4',
      mqtt_topic_base: 'floodguard/RUB071-CTRL01',
      operational_status: 'ACTIVE',
      lifecycle_note: null,
      lifecycle_updated_at: now,
      last_seen: null,
      last_heartbeat: null,
      status: 'OFFLINE',
      created_at: now,
      updated_at: now,
      config: { daily_reboot_enabled: true, daily_reboot_time: '03:30', timezone: 'Asia/Kolkata', reporting_profile: 'dynamic' }
    }
  ];
}

module.exports = {
  seedIfEmpty
};
