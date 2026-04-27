'use strict';

const helmet = require('helmet');

/**
 * Creates security middleware using Helmet.
 *
 * @param {Object} [_options={}] - Middleware options.
 * @returns {import('express').RequestHandler} Helmet middleware.
 */
function createSecurityMiddleware(_options = {}) {
  const isTest = process.env.NODE_ENV === 'test';

  return helmet({
    contentSecurityPolicy: isTest
      ? false
      : {
          directives: {
            defaultSrc: ["'self'"],
          },
        },
  });
}

module.exports = { createSecurityMiddleware };
