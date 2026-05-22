const integrationSettingRepository = require('../repositories/integrationSettingRepository');
const { unauthorized } = require('../utils/errors');

function requireIntegrationToken(req, res, next) {
  try {
    const authHeader = String(req.headers.authorization || '').trim();
    if (!authHeader.startsWith('Bearer ')) {
      throw unauthorized('Integration bearer token is required');
    }

    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) {
      throw unauthorized('Integration bearer token is required');
    }

    const setting = integrationSettingRepository.findByInboundToken(token);
    if (!setting) {
      throw unauthorized('Invalid integration token');
    }

    req.integrationContext = {
      setting
    };
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = {
  requireIntegrationToken
};
