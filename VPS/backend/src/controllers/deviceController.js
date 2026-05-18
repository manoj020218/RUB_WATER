const deviceService = require('../services/deviceService');
const commandService = require('../services/commandService');
const firmwareService = require('../services/firmwareService');

function ingestTelemetry(req, res, next) {
  try {
    const record = deviceService.ingestTelemetry(req.body);
    res.status(201).json({ ok: true, data: record });
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
  ingestTelemetry,
  ingestEvent,
  getPendingCommands,
  ackCommand,
  ackCommandLegacy,
  getDeviceConfig,
  getLatestFirmware
};
