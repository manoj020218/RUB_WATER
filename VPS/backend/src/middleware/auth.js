const authService = require('../services/authService');
const { unauthorized } = require('../utils/errors');

function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw unauthorized('Bearer token is required');
    }

    const token = authHeader.slice('Bearer '.length).trim();
    req.auth = authService.authenticateToken(token);
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = {
  requireAuth
};
