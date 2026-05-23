const fs = require('fs');
const path = require('path');

const shiftConfigPath = path.resolve(__dirname, '..', '..', 'VPS_SHIFT_CONFIG.json');

function readShiftConfig() {
  try {
    if (!fs.existsSync(shiftConfigPath)) {
      return {};
    }
    const raw = fs.readFileSync(shiftConfigPath, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(raw);
  } catch (error) {
    return {};
  }
}

function readNumber(name, fallback) {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readBool(name, fallback) {
  const value = process.env[name];
  if (value === undefined) {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }
  return fallback;
}

function parseList(rawValue) {
  if (!rawValue) {
    return [];
  }
  if (Array.isArray(rawValue)) {
    return rawValue
      .map((item) => String(item).trim())
      .filter(Boolean);
  }
  return String(rawValue)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const shift = readShiftConfig();
const deployment = shift.deployment || {};
const domains = shift.domains || {};
const database = shift.database || {};
const messaging = shift.messaging || {};
const security = shift.security || {};

const mqttProtocol = process.env.MQTT_PROTOCOL || messaging.mqttProtocol || 'mqtt';
const mqttHost = process.env.MQTT_HOST || messaging.mqttHost || 'api.floodguard.iotsoft.in';
const mqttPort = readNumber('MQTT_PORT', Number(messaging.mqttPort || 1883));
const configuredCorsOrigins = parseList(process.env.CORS_ALLOWED_ORIGINS || security.corsAllowedOrigins);
const defaultCorsOrigins = [
  'http://localhost',
  'http://localhost:3000',
  'http://127.0.0.1',
  'http://127.0.0.1:3000',
  'capacitor://localhost',
  'ionic://localhost',
  'https://floodguard.jenix.in'
];
const corsAllowedOrigins = configuredCorsOrigins.length ? configuredCorsOrigins : defaultCorsOrigins;
const corsAllowAll = corsAllowedOrigins.includes('*');

module.exports = {
  nodeEnv: process.env.NODE_ENV || deployment.nodeEnv || 'development',
  port: readNumber('PORT', Number(deployment.port || 4080)),
  publicApiBaseUrl: process.env.PUBLIC_API_BASE_URL || domains.publicApiBaseUrl || 'https://api.floodguard.iotsoft.in',
  vpsFqdn: process.env.VPS_FQDN || domains.vpsFqdn || 'api.floodguard.iotsoft.in',
  mongoUri: process.env.MONGO_URI || database.mongoUri || 'mongodb://api.floodguard.iotsoft.in:27017/floodguard',
  mongoDbName: process.env.MONGO_DB_NAME || database.mongoDbName || 'floodguard',
  mqttEnabled: readBool('MQTT_ENABLED', messaging.mqttEnabled !== false),
  mqttProtocol,
  mqttHost,
  mqttPort,
  mqttUser: process.env.MQTT_USER || messaging.mqttUser || '',
  mqttPass: process.env.MQTT_PASS || messaging.mqttPass || '',
  mqttTopicBase: process.env.MQTT_TOPIC_BASE || messaging.mqttTopicBase || 'rub',
  mqttUrl: process.env.MQTT_URL || `${mqttProtocol}://${mqttHost}:${mqttPort}`,
  deviceTokenTtlHours: readNumber('DEVICE_TOKEN_TTL_HOURS', Number(security.deviceTokenTtlHours || 720)),
  jwtSecret: process.env.JWT_SECRET || security.jwtSecret || 'floodguard-dev-secret',
  jwtTtl: process.env.JWT_TTL || security.jwtTtl || '30d',
  defaultResetPassword: process.env.DEFAULT_RESET_PASSWORD || security.defaultResetPassword || '123456',
  apiKey: process.env.API_KEY || security.apiKey || 'FG_LOCAL_DEV_KEY',
  deviceProvisionKey: process.env.DEVICE_PROVISION_KEY || security.deviceProvisionKey || '',
  requireDeviceProvisionKey: readBool('REQUIRE_DEVICE_PROVISION_KEY', security.requireDeviceProvisionKey !== false),
  allowDeviceIdAuth: readBool('ALLOW_DEVICE_ID_AUTH', security.allowDeviceIdAuth !== false),
  corsAllowedOrigins,
  corsAllowAll,
  timezone: process.env.TZ_NAME || deployment.timezone || 'Asia/Kolkata',
  retentionNoWaterHours: readNumber('RETENTION_NO_WATER_HOURS', 24),
  appName: 'FloodGuard by Jenix',
  projectName: 'Jenix FloodGuard - RUB Water Level Monitoring & Alarm System',
  logsDir: path.resolve(process.cwd(), 'logs')
};
