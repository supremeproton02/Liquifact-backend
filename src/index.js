'use strict';

const express = require('express');
const cors = require('cors');
require('dotenv').config();

const config = require('./config');
// Fail-fast boot validation
if (process.env.NODE_ENV !== 'test') {
  config.validate();
}

const { createSecurityMiddleware } = require('./middleware/security');
const { createCorsOptions } = require('./config/cors');
const { correlationIdMiddleware } = require('./middleware/correlationId');
const {
  jsonBodyLimit,
  urlencodedBodyLimit,
  payloadTooLargeHandler,
} = require('./middleware/bodySizeLimits');
const { auditMiddleware } = require('./middleware/audit');
const { globalLimiter, sensitiveLimiter } = require('./middleware/rateLimit');
const { authenticateToken } = require('./middleware/auth');
const smeRouter = require('./routes/sme');
const errorHandler = require('./middleware/errorHandler');
const { callSorobanContract } = require('./services/soroban');
const { performHealthChecks } = require('./services/health');
const AppError = require('./errors/AppError');
const logger = require('./logger');
const requestId = require('./middleware/requestId');
const pinoHttp = require('pino-http');
const investRoutes = require('./routes/invest');
const marketplaceRoutes = require('./routes/marketplace');
const invoiceFileRouter = require('./routes/invoiceFile');

const PORT = process.env.PORT || 3001;

// In-memory storage
const invoices = [];

/**
 * Parses a ledger sequence from a value.
 *
 * @param {any} value - The value to parse.
 * @returns {number|null} The parsed ledger sequence or null.
 */
function parseLedgerSequence(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

/**
 * Creates the Express application instance.
 *
 * @param {object} [options={}] - App options.
 * @param {boolean} [options.enableTestRoutes=false] - Whether to expose test-only routes.
 * @returns {import('express').Express} The Express application.
 */
function createApp(options = {}) {
  const { enableTestRoutes = false } = options;

  const app = express();

  // ✅ 1. Request ID
  app.use(requestId);

  // ✅ 2. Logging
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id,
      customLogLevel: (req, res, err) => {
        if (res.statusCode >= 500 || err) {
          return 'error';
        }
        if (res.statusCode >= 400) {
          return 'warn';
        }
        return 'info';
      },
      serializers: {
        req: (req) => ({
          id: req.id,
          method: req.method,
          url: req.url,
          query: req.query,
          headers: {
            'x-tenant-id': req.headers['x-tenant-id'],
            'user-agent': req.headers['user-agent'],
          },
        }),
      },
    })
  );

  // ✅ 3. Correlation ID
  app.use(correlationIdMiddleware);

  // ✅ 4. SECURITY (Helmet)
  app.use(createSecurityMiddleware());

  // ✅ 5. CORS
  app.use(cors(createCorsOptions()));

  // ✅ 6. Body parsing
  app.use(jsonBodyLimit());
  app.use(urlencodedBodyLimit());

  // ✅ 7. Rate limit + audit
  app.use(globalLimiter);
  app.use(auditMiddleware);

  // ───────── ROUTES ─────────

  app.use('/api/sme', smeRouter);
  app.use('/api/invest', investRoutes);
  app.use('/api/marketplace', marketplaceRoutes);
  app.use('/api/invoices', invoiceFileRouter);

  app.get('/health', async (req, res) => {
    const health = await performHealthChecks();
    res.json({
      status: health.healthy ? 'ok' : 'unhealthy',
      service: 'liquifact-api',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
      checks: health.checks,
    });
  });

  // OpenAPI routes
  app.get('/openapi.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send({});
  });

  /**
   * @swagger
   * /api:
   *   get:
   *     summary: API information
   *     description: Returns basic information about the API
   *     tags: [Info]
   *     responses:
   *       200:
   *         description: API information
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 name:
   *                   type: string
   *                 description:
   *                   type: string
   *                 endpoints:
   *                   type: object
   */
  app.get('/api', (req, res) => {
    res.json({
      name: 'LiquiFact API',
      description: 'Global Invoice Liquidity Network on Stellar',
      endpoints: {
        health: 'GET /health',
        invoices: 'GET/POST /api/invoices',
        escrow: 'GET/POST /v1/escrow',
      },
    });
  });

  // Invoice routes (standard API)
  app.get('/api/invoices', (req, res) => {
    const includeDeleted = req.query.includeDeleted === 'true';
    const filtered = includeDeleted ? invoices : invoices.filter((inv) => !inv.deletedAt);

    res.json({
      data: filtered,
      message: includeDeleted
        ? 'Showing all invoices (including deleted).'
        : 'Showing active invoices.',
    });
  });

  app.post('/api/invoices', authenticateToken, sensitiveLimiter, (req, res) => {
    const { amount, customer } = req.body;
    if (!amount || !customer) {
      return res.status(400).json({ error: 'Amount and customer are required' });
    }

    const newInvoice = {
      id: `inv_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      amount,
      customer,
      status: 'pending_verification',
      createdAt: new Date().toISOString(),
      deletedAt: null,
    };

    invoices.push(newInvoice);
    res.status(201).json({
      data: newInvoice,
      message: 'Invoice uploaded successfully.',
    });
  });

  // V1 API Namespace
  const v1Router = express.Router();

  // Escrow routes in V1
  v1Router.get('/escrow/:invoiceId', authenticateToken, async (req, res) => {
    const { invoiceId } = req.params;
    const currentLedger =
      parseLedgerSequence(req.query.ledgerSequence) ??
      parseLedgerSequence(req.headers['x-ledger-sequence']);

    try {
      const operation = async () => ({
        invoiceId,
        status: 'not_found',
        fundedAmount: 0,
        ledgerSequence: currentLedger,
      });

      const data = await callSorobanContract(operation);
      return res.json({
        data,
        message: 'Escrow state read from Soroban contract (mocked).',
      });
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Error fetching escrow state' });
    }
  });

  v1Router.post('/escrow', authenticateToken, sensitiveLimiter, (req, res) => {
    res.json({
      data: { status: 'funded' },
      message: 'Escrow operation simulated.',
    });
  });

  // Versioned routes
  app.use('/v1', v1Router);

  // Backward compatibility for /api/escrow
  app.get(
    '/api/escrow/:invoiceId',
    (req, res, next) => {
      res.set('Warning', '299 - "This endpoint is deprecated. Use /v1/escrow instead."');
      next();
    },
    v1Router.stack.find((s) => s.route && s.route.path === '/escrow/:invoiceId').handle
  );

  app.post(
    '/api/escrow',
    (req, res, next) => {
      res.set('Warning', '299 - "This endpoint is deprecated. Use /v1/escrow instead."');
      next();
    },
    v1Router.stack.find((s) => s.route && s.route.path === '/escrow').handle
  );

  if (enableTestRoutes) {
    // Auth test route
    app.get('/__test__/auth', authenticateToken, (req, res) => {
      res.json({ ok: true });
    });

    // Rate limit test route
    app.get('/__test__/rate-limited', authenticateToken, sensitiveLimiter, (req, res) => {
      res.json({ ok: true });
    });

    // Existing test route
    app.get('/__test__/explode', () => {
      throw new Error('Test error');
    });
  }

  // ───────── ERRORS ─────────

  app.use(payloadTooLargeHandler);

  app.use((req, res, next) => {
    next(
      new AppError({
        type: 'https://liquifact.com/probs/not-found',
        title: 'Resource Not Found',
        status: 404,
        detail: `Path ${req.path} not found`,
      })
    );
  });

  app.use(errorHandler);

  return app;
}

const app = createApp({
  enableTestRoutes: process.env.NODE_ENV === 'test',
});

/**
 * Starts the HTTP server.
 *
 * @returns {import('http').Server} The server instance.
 */
function startServer() {
  return app.listen(PORT, () => {
    logger.warn(`API running at http://localhost:${PORT}`);
  });
}

/**
 * Resets the in-memory storage.
 *
 * @returns {void}
 */
function resetStore() {
  invoices.length = 0;
}

if (process.env.NODE_ENV !== 'test') {
  startServer();
}

module.exports = app;
module.exports.createApp = createApp;
module.exports.startServer = startServer;
module.exports.resetStore = resetStore;
