const deviceService = require('../services/deviceService');
const commandService = require('../services/commandService');
const firmwareService = require('../services/firmwareService');
const deviceConfigService = require('../services/deviceConfigService');
const deviceProvisionService = require('../services/deviceProvisionService');

function ingestTelemetry(req, res, next) {
  try {
    const record = deviceService.ingestTelemetry(req.body);
    res.status(201).json({ ok: true, data: record });
  } catch (error) {
    next(error);
  }
}

function registerDevice(req, res, next) {
  try {
    const data = deviceProvisionService.registerDeviceWithProvisionKey({
      deviceId: req.body?.device_id || req.body?.deviceId || req.query?.device_id || req.query?.deviceId,
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
    const result = deviceService.ingestEvent(req.body);
    res.status(201).json({ ok: true, data: result });
  } catch (error) {
    next(error);
  }
}

function getPendingCommands(req, res, next) {
  try {
    const data = deviceService.getPendingCommands(req.params.deviceId);
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
    const config = deviceService.getDeviceConfig(req.params.deviceId);
    res.json({ ok: true, data: config });
  } catch (error) {
    next(error);
  }
}

function getLatestFirmware(req, res, next) {
  try {
    const firmware = firmwareService.getLatestFirmwareForDevice(req.params.deviceId);
    res.json({ ok: true, data: firmware });
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
  getLatestFirmware
};
