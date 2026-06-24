const deviceService = require('../services/deviceService');
const commandService = require('../services/commandService');
const firmwareService = require('../services/firmwareService');
const deviceConfigService = require('../services/deviceConfigService');
const deviceActionSheetService = require('../services/deviceActionSheetService');
const deviceProvisionService = require('../services/deviceProvisionService');
const deviceRepository = require('../repositories/deviceRepository');

function resolveDeviceIdentity(req) {
  const routeRef = String(req.params?.deviceId || '').trim().toUpperCase();
  const hardwareId = String(
    req.headers['x-hardware-id']
      || req.body?.hardware_id
      || req.query?.hardware_id
      || ''
  ).trim().toUpperCase();
  const deviceId = String(
    req.body?.device_id
      || req.query?.device_id
      || routeRef
      || ''
  ).trim().toUpperCase();
  return deviceRepository.resolveByIdentity({
    deviceId,
    hardwareId,
    routeId: routeRef
  });
}

function buildIdentityAwareBody(req) {
  const body = req.body && typeof req.body === 'object' ? { ...req.body } : {};
  const device = resolveDeviceIdentity(req);
  if (device && !body.device_id) {
    body.device_id = device._id;
  }
  if (device?.hardware_id && !body.hardware_id) {
    body.hardware_id = device.hardware_id;
  }
  if (!body.hardware_id && req.headers['x-hardware-id']) {
    body.hardware_id = req.headers['x-hardware-id'];
  }
  return { body, device };
}

function ingestTelemetry(req, res, next) {
  try {
    const { body } = buildIdentityAwareBody(req);
    const record = deviceService.ingestTelemetry(body);
    res.status(201).json({ ok: true, data: record });
  } catch (error) {
    next(error);
  }
}

function registerDevice(req, res, next) {
  try {
    const data = deviceProvisionService.registerDeviceWithProvisionKey({
      deviceId: req.body?.device_id || req.body?.deviceId || req.query?.device_id || req.query?.deviceId,
      hardwareId: req.body?.hardware_id || req.body?.hardwareId || req.headers['x-hardware-id'] || req.query?.hardware_id,
      provisionKey: req.headers['x-provision-key'] || req.body?.provision_key || req.body?.provisionKey,
      ipAddress: req.ip
    });
    res.status(201).json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

function ingestEvent(req, res, next) {
  try {
    const { body } = buildIdentityAwareBody(req);
    const result = deviceService.ingestEvent(body);
    res.status(201).json({ ok: true, data: result });
  } catch (error) {
    next(error);
  }
}

function getPendingCommands(req, res, next) {
  try {
    const device = resolveDeviceIdentity(req);
    const data = deviceService.getPendingCommands(device?._id || req.params.deviceId);
    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

function ackCommand(req, res, next) {
  try {
    const ack = commandService.ackCommand({
      commandId: req.params.commandId,
      payload: req.body
    });
    res.json({ ok: true, data: ack });
  } catch (error) {
    next(error);
  }
}

function ackCommandLegacy(req, res, next) {
  try {
    const commandId = req.body?.command_id;
    const ack = commandService.ackCommand({
      commandId,
      payload: req.body
    });
    res.json({ ok: true, data: ack });
  } catch (error) {
    next(error);
  }
}

function ackConfig(req, res, next) {
  try {
    const ack = deviceConfigService.ackDeviceConfig(req.body);
    res.json({ ok: true, data: ack });
  } catch (error) {
    next(error);
  }
}

function getDeviceConfig(req, res, next) {
  try {
    const device = resolveDeviceIdentity(req);
    const config = deviceService.getDeviceConfig(device?._id || req.params.deviceId);
    res.json({ ok: true, data: config });
  } catch (error) {
    next(error);
  }
}

function getLatestFirmware(req, res, next) {
  try {
    const device = resolveDeviceIdentity(req);
    const firmware = firmwareService.getLatestFirmwareForDevice(device?._id || req.params.deviceId);
    res.json({ ok: true, data: firmware });
  } catch (error) {
    next(error);
  }
}

function getDeviceActionSheet(req, res, next) {
  try {
    const device = resolveDeviceIdentity(req);
    const data = deviceActionSheetService.getDeviceActionSheetForSync({
      deviceId: device?._id || req.params.deviceId,
      currentVersion: Number(req.query.current_version || 0)
    });
    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

function reportDeviceActionSheet(req, res, next) {
  try {
    const device = resolveDeviceIdentity(req);
    const data = deviceActionSheetService.reportDeviceActionSheet({
      deviceId: device?._id || req.params.deviceId,
      payload: req.body || {}
    });
    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  registerDevice,
  ingestTelemetry,
  ingestEvent,
  getPendingCommands,
  ackCommand,
  ackCommandLegacy,
  ackConfig,
  getDeviceConfig,
  getLatestFirmware,
  getDeviceActionSheet,
  reportDeviceActionSheet
};
