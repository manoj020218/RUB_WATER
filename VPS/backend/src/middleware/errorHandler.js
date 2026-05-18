const { AppError } = require('../utils/errors');

function notFoundHandler(req, res) {
  res.status(404).json({
    ok: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route not found: ${req.method} ${req.originalUrl}`
    }
  });
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  const statusCode = err instanceof AppError ? err.statusCode : 500;
  const code = err instanceof AppError ? err.code : 'INTERNAL_SERVER_ERROR';

  return res.status(statusCode).json({
    ok: false,
    error: {
      code,
      message: err.message || 'Unexpected server error',
      details: err.details || null
    }
  });
}

module.exports = {
  notFoundHandler,
  errorHandler
};
