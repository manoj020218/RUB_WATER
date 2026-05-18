const deviceRepository = require('../repositories/deviceRepository');
const firmwareRepository = require('../repositories/firmwareRepository');
const { notFound } = require('../utils/errors');

function isUpdateAvailable(currentVersion, latestVersion) {
  if (!currentVersion || !latestVersion) {
    return false;
  }

  const parse = (value) => value.split('.').map((part) => Number(part) || 0);
  const current = parse(currentVersion);
  const latest = parse(latestVersion);
  const size = Math.max(current.length, latest.length);

  for (let i = 0; i < size; i += 1) {
    const a = latest[i] || 0;
    const b = current[i] || 0;
    if (a > b) {
      return true;
    }
    if (a < b) {
      return false;
    }
  }

  return false;
}

function getLatestFirmwareForDevice(deviceId) {
  const device = deviceRepository.findById(deviceId);
  if (!device) {
    throw notFound('Device not found');
  }

  const latest = firmwareRepository.findLatestByHardware(device.hardware_version);
  if (!latest) {
    throw notFound('No firmware version found for this hardware');
  }

  return {
    device_id: deviceId,
    hardware_version: device.hardware_version,
    current_version: device.firmware_version,
    latest_version: latest.version,
    file_url: latest.file_url,
    sha256: latest.sha256,
    mandatory: latest.mandatory,
    release_notes: latest.release_notes,
    is_update_available: isUpdateAvailable(device.firmware_version, latest.version)
  };
}

module.exports = {
  getLatestFirmwareForDevice,
  isUpdateAvailable
};
