export const STORAGE_KEY = 'fg_mobile_session_v1';

export const FCM_CONFIG = {
  apiKey: 'AIzaSyDNLaSUaBiC52mFrHsOIwkmahJbAtK2E-U',
  authDomain: 'floodguard-f84ac.firebaseapp.com',
  projectId: 'floodguard-f84ac',
  storageBucket: 'floodguard-f84ac.firebasestorage.app',
  messagingSenderId: '488469166284',
  appId: '1:488469166284:web:bd34ad115167061f17aa69',
  measurementId: 'G-7JVD25ZNN5',
};

export const FCM_VAPID_KEY =
  'BEKxuTUJtugFJheypzEVBZhs1HSs7FXDoC0NcHLCEvo98g0e9qKOL0695JHebudeoovV1b5_yOSTb9obkIcRoqU';

export const REFRESH_INTERVAL_MS = 10_000;
export const REQUEST_TIMEOUT_MS = 12_000;
export const IST_TIMEZONE = 'Asia/Kolkata';

export const BLE_SERVICE_UUID = '0000ff00-0000-1000-8000-00805f9b34fb';
export const BLE_CHARACTERISTIC_UUID = '0000ff01-0000-1000-8000-00805f9b34fb';
export const BLE_NAME_PREFIX = 'JXFG';

export const DEFAULT_VPS_HEALTH_URL = 'https://api.floodguard.iotsoft.in/health';
export const WIFI_DISCOVERY_TIMEOUT_MS = 900;
export const WIFI_DISCOVERY_BATCH_SIZE = 14;
export const MAX_WIFI_DISCOVERY_HOSTS = 254;

export const APP_RELEASE_INFO = Object.freeze({
  version: '1.0.7',
  versionCode: 8,
  releasedAt: '2026-06-25',
  releasedLabel: '25 Jun 2026',
});

export const DEFAULT_API_BASE = 'https://api.floodguard.iotsoft.in/api';
