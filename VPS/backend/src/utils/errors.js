class AppError extends Error {
  constructor(statusCode, message, code, details) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code || 'APP_ERROR';
    this.details = details;
  }
}

function badRequest(message, details) {
  return new AppError(400, message, 'BAD_REQUEST', details);
}

function unauthorized(message) {
  return new AppError(401, message || 'Unauthorized', 'UNAUTHORIZED');
}

function forbidden(message) {
  return new AppError(403, message || 'Forbidden', 'FORBIDDEN');
}

function conflict(message, details) {
  return new AppError(409, message || 'Conflict', 'CONFLICT', details);
}

function notFound(message) {
  return new AppError(404, message || 'Not found', 'NOT_FOUND');
}

module.exports = {
  AppError,
  badRequest,
  unauthorized,
  forbidden,
  conflict,
  notFound
};
