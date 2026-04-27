'use strict';

const SENTRY_DSN = process.env.SENTRY_DSN && process.env.SENTRY_DSN.trim();
let Sentry = null;
let enabled = false;

const SENSITIVE_FIELD_NAMES = [
  'authorization',
  'auth',
  'token',
  'password',
  'secret',
  'x-api-key',
  'api-key',
  'xdr',
  'stellar',
  'invoice',
];

const REDACTED = '[REDACTED]';
const REDACTED_INVOICE = '[REDACTED-INVOICE]';

/**
 * Checks if a field name is considered sensitive and should be redacted.
 *
 * @param {string} key - The field name to check.
 * @returns {boolean} True if the field is sensitive.
 */
function isSensitiveField(key) {
  if (!key || typeof key !== 'string') {
    return false;
  }

  return SENSITIVE_FIELD_NAMES.some((name) => key.toLowerCase().includes(name));
}

/**
 * Redacts a value if its key is sensitive or if it looks like a sensitive token.
 *
 * @param {string} key - The field name.
 * @param {any} value - The value to potentially redact.
 * @returns {any} The redacted or original value.
 */
function redactValue(key, value) {
  if (value == null) {
    return value;
  }

  if (typeof value === 'string') {
    if (isSensitiveField(key)) {
      return key.toLowerCase().includes('invoice') ? REDACTED_INVOICE : REDACTED;
    }

    if (looksLikeSensitiveToken(value)) {
      return REDACTED;
    }

    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(key, item));
  }

  if (typeof value === 'object') {
    return scrubObject(value);
  }

  return value;
}

/**
 * Checks if a string value looks like a sensitive token (JWT, Stellar secret, etc.).
 *
 * @param {string} value - The string to check.
 * @returns {boolean} True if it matches sensitive token patterns.
 */
function looksLikeSensitiveToken(value) {
  if (typeof value !== 'string') {
    return false;
  }

  const tokenPatterns = [
    /Bearer\s+[A-Za-z0-9\-_.]+/i,
    /(?:eyJ|AAAA)[A-Za-z0-9_-]{20,}/,
    /[A-Za-z0-9-_]{40,}/,
  ];

  return tokenPatterns.some((pattern) => pattern.test(value));
}

/**
 * Recursively scrubs an object of sensitive values.
 *
 * @param {Object} obj - The object to scrub.
 * @returns {Object} The scrubbed object.
 */
function scrubObject(obj) {
  if (obj == null || typeof obj !== 'object') {
    return obj;
  }

  const output = Array.isArray(obj) ? [] : {};

  for (const key of Object.keys(obj)) {
    const value = obj[key];

    if (isSensitiveField(key)) {
      output[key] = redactValue(key, value);
      continue;
    }

    output[key] = redactValue(key, value);
  }

  return output;
}

/**
 * Scrubs sensitive values from a headers object.
 *
 * @param {Object} headers - The headers object.
 * @returns {Object} The scrubbed headers.
 */
function scrubHeaders(headers) {
  if (!headers || typeof headers !== 'object') {
    return headers;
  }

  const scrubbed = {};
  for (const [key, value] of Object.entries(headers)) {
    if (isSensitiveField(key)) {
      scrubbed[key] = REDACTED;
      continue;
    }
    scrubbed[key] = redactValue(key, value);
  }

  return scrubbed;
}

/**
 * Sentry beforeSend callback to scrub events before they are sent.
 *
 * @param {import('@sentry/node').Event} event - The Sentry event.
 * @returns {import('@sentry/node').Event} The scrubbed event.
 */
function scrubEvent(event) {
  if (!event || typeof event !== 'object') {
    return event;
  }

  const safeEvent = { ...event };

  if (safeEvent.request && typeof safeEvent.request === 'object') {
    safeEvent.request = { ...safeEvent.request };

    if (safeEvent.request.headers) {
      safeEvent.request.headers = scrubHeaders(safeEvent.request.headers);
    }

    if (safeEvent.request.data) {
      safeEvent.request.data = scrubObject(safeEvent.request.data);
    }
  }

  if (safeEvent.extra) {
    safeEvent.extra = scrubObject(safeEvent.extra);
  }

  if (safeEvent.user) {
    safeEvent.user = scrubObject(safeEvent.user);
  }

  if (safeEvent.tags) {
    safeEvent.tags = scrubObject(safeEvent.tags);
  }

  return safeEvent;
}

/**
 * Initializes Sentry if SENTRY_DSN is configured.
 *
 * @returns {void}
 */
function initSentry() {
  if (!SENTRY_DSN) {
    return;
  }

  try {
    Sentry = require('@sentry/node');

    Sentry.init({
      dsn: SENTRY_DSN,
      release:
        process.env.SENTRY_RELEASE ||
        process.env.npm_package_version ||
        'liquifact-backend@unknown',
      environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
      attachStacktrace: true,
      normalizeDepth: 5,
      beforeSend: scrubEvent,
      beforeSendTransaction: scrubEvent,
    });

    enabled = true;
  } catch (err) {
    enabled = false;
    // Avoid breaking startup if Sentry cannot be loaded or initialized.

    console.warn('Sentry initialization failed:', err.message || err);
  }
}

/**
 * Returns the Sentry request handler middleware if enabled.
 *
 * @returns {import('express').RequestHandler} The request handler.
 */
function requestHandler() {
  if (!enabled || !Sentry || !Sentry.Handlers || !Sentry.Handlers.requestHandler) {
    return (req, res, next) => next();
  }

  return Sentry.Handlers.requestHandler();
}

/**
 * Captures an exception and sends it to Sentry with request context.
 *
 * @param {Error} error - The error to capture.
 * @param {import('express').Request} [req] - Optional request object for context.
 * @returns {void}
 */
function captureException(error, req) {
  if (!enabled || !Sentry || !Sentry.withScope || !Sentry.captureException) {
    return;
  }

  Sentry.withScope((scope) => {
    if (req) {
      scope.setTag('request_id', req.id || 'unknown');
      scope.setTag('method', req.method || 'unknown');
      scope.setTag('url', req.originalUrl || req.url || 'unknown');
      scope.setExtra('headers', scrubHeaders(req.headers || {}));
      scope.setExtra('query', scrubObject(req.query || {}));
      scope.setExtra('body', scrubObject(req.body || {}));
      if (req.user) {
        scope.setUser(scrubObject(req.user));
      }
    }

    Sentry.captureException(error);
  });
}

module.exports = {
  initSentry,
  requestHandler,
  captureException,
  isEnabled: () => enabled,
  scrubEvent,
};
