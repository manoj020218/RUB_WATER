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
    }
  ];

  dataStore.locations = [
    {
      _id: 'RUB043',
      name: 'RUB 43',
      description: 'Railway Under Bridge 43',
      department_id: 'dept_001',
      sensor_mount_height_mm: 1200,
      alert_level_mm: 300,
      danger_level_mm: 500,
      danger_clear_level_mm: 450,
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
      last_seen: null,
      status: 'OFFLINE',
      config: {
        daily_reboot_enabled: true,
        daily_reboot_time: '03:30',
        timezone: 'Asia/Kolkata',
        reporting_profile: 'dynamic'
      }
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
}

module.exports = {
  seedIfEmpty
};
