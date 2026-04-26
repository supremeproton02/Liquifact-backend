const AppError = require('../errors/AppError');
const { mapError } = require('../errors/mapError');
const logger = require('../logger');
const { captureException } = require('../observability/sentry');

/**
 * Express 404 handler that forwards a structured not-found error.
 *
 * @param {import('express').Request} req Request object.
 * @param {import('express').Response} _res Response object.
 * @param {import('express').NextFunction} next Next middleware.
 * @returns {void}
 */
function notFoundHandler(req, _res, next) {
  next(
    new AppError({
      type: 'https://liquifact.com/probs/not-found',
      title: 'Not Found',
      status: 404,
      detail: `Route ${req.method} ${req.path} was not found.`,
      instance: req.originalUrl,
    }),
  );
}

/**
 * Centralized terminal error handler.
 *
 * @param {unknown} error Thrown error value.
 * @param {import('express').Request} req Request object.
 * @param {import('express').Response} res Response object.
 * @param {import('express').NextFunction} _next Next middleware.
 * @returns {void}
 */
function errorHandler(error, req, res, _next) {
  const mapped = mapError(error);
  const requestId = req.id || 'unknown';

  logError(error, requestId);
  captureException(error, req);

  res.status(mapped.status).json({
    error: {
      code: mapped.code,
      message: mapped.message,
      correlation_id: req.id || 'unknown',
      retryable: mapped.retryable,
      retry_hint: mapped.retryHint,
    },
  });
}

/**
 * Log the error with correlation context without exposing internals to clients.
 *
 * @param {unknown} error Thrown error value.
 * @param {string} requestId Request correlation ID.
 * @returns {void}
 */
function logError(error, requestId) {
  const message =
    error && typeof error === 'object' && typeof error.message === 'string'
      ? error.message
      : 'Non-error value thrown';

  logger.error({ err: error, requestId }, message);
}

module.exports = errorHandler;
module.exports.errorHandler = errorHandler;
module.exports.notFoundHandler = notFoundHandler;
module.exports.logError = logError;
