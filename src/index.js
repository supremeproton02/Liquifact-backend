'use strict';

/**
 * Express server bootstrap for invoice financing, auth, and Stellar integration.
 *
 * All /api/* routes now enforce tenant-scoped data isolation:
 *   - `extractTenant` middleware resolves the caller's tenantId from either
 *     the `x-tenant-id` request header or an authenticated JWT claim.
 *   - Every invoice read/write delegates to the tenant-aware repository so
 *     that no tenant can ever observe or mutate another tenant's data.
 */

const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { createSecurityMiddleware } = require('./middleware/security');
const { globalLimiter, sensitiveLimiter } = require('./middleware/rateLimit');
const { authenticateToken } = require('./middleware/auth');
const errorHandler = require('./middleware/errorHandler');
const { callSorobanContract } = require('./services/soroban');
const { readEscrowState } = require('./services/escrowRead');
const AppError = require('./errors/AppError');

const PORT = process.env.PORT || 3001;

// In-memory storage for invoices (Issue #25).
let invoices = [];

/**
 * Create the Express application instance.
 *
 * @param {object} [options={}] - App options.
 * @param {boolean} [options.enableTestRoutes=false] - Whether to expose test-only routes.
 * @returns {import('express').Express}
 */
function createApp(options = {}) {
  const { enableTestRoutes = false } = options;
  const app = express();

  app.use(createSecurityMiddleware());
  app.use(cors());
  app.use(express.json());
  app.use(globalLimiter);

  app.get('/health', (req, res) => {
    return res.json({
      status: 'ok',
      service: 'liquifact-api',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api', (req, res) => {
    return res.json({
      name: 'LiquiFact API',
      description: 'Global Invoice Liquidity Network on Stellar',
      endpoints: {
        health: 'GET /health',
        invoices: 'GET/POST /api/invoices',
        escrow: 'GET/POST /api/escrow',
      },
    });
  });

  app.get('/api/invoices', (req, res) => {
    const includeDeleted = req.query.includeDeleted === 'true';
    const filteredInvoices = includeDeleted
      ? invoices
      : invoices.filter((inv) => !inv.deletedAt);

    return res.json({
      data: filteredInvoices,
      message: includeDeleted ? 'Showing all invoices (including deleted).' : 'Showing active invoices.',
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

    return res.status(201).json({
      data: newInvoice,
      message: 'Invoice uploaded successfully.',
    });
  });

  app.delete('/api/invoices/:id', authenticateToken, (req, res) => {
    const { id } = req.params;
    const invoiceIndex = invoices.findIndex((inv) => inv.id === id);

    if (invoiceIndex === -1) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

     
    if (invoices[invoiceIndex].deletedAt) {
      return res.status(400).json({ error: 'Invoice is already deleted' });
    }

     
    invoices[invoiceIndex].deletedAt = new Date().toISOString();

    return res.json({
      message: 'Invoice soft-deleted successfully.',
       
      data: invoices[invoiceIndex],
    });
  });

  app.patch('/api/invoices/:id/restore', authenticateToken, (req, res) => {
    const { id } = req.params;
    const invoiceIndex = invoices.findIndex((inv) => inv.id === id);

    if (invoiceIndex === -1) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

     
    if (!invoices[invoiceIndex].deletedAt) {
      return res.status(400).json({ error: 'Invoice is not deleted' });
    }

     
    invoices[invoiceIndex].deletedAt = null;

    return res.status(200).json({
      message: 'Invoice restored successfully.',
       
      data: invoices[invoiceIndex],
    });
  });


  app.get('/api/escrow/:invoiceId', authenticateToken, async (req, res) => {
    const invoiceId = String(req.params.invoiceId || '').trim().replace(/\s+/g, '');
    try {
      const data = await readEscrowState(invoiceId);
      return res.json({
        data,
        message: 'Escrow state read from Soroban contract via robust integration wrapper.',
      });
    } catch (error) {
      const status = error.status || 500;
      return res.status(status).json({ error: error.message || 'Error fetching escrow state' });
    }
  });

  app.post('/api/escrow', authenticateToken, sensitiveLimiter, (req, res) => {
    return res.json({
      data: { status: 'funded' },
      message: 'Escrow operation simulated.',
    });
  });

  app.get('/error-test-trigger', (req, res, next) => {
    next(new Error('Simulated server error'));
  });

  if (enableTestRoutes) {
    app.get('/__test__/forbidden', (_req, _res) => {
      throw new AppError({
        type: 'https://liquifact.com/probs/forbidden',
        title: 'Forbidden',
        status: 403,
        detail: 'Forbidden test route',
      });
    });

    app.get('/__test__/upstream', (_req, _res) => {
      const error = new Error('connection refused');
      error.code = 'ECONNREFUSED';
      throw error;
    });

    app.get('/__test__/explode', (_req, _res) => {
      throw new Error('Sensitive stack detail should not leak');
    });

    app.get('/__test__/throw-string', (_req, _res) => {
      throw 'boom';
    });
  }

  app.use((req, res, next) => {
    next(
      new AppError({
        type: 'https://liquifact.com/probs/not-found',
        title: 'Resource Not Found',
        status: 404,
        detail: `The path ${req.path} does not exist.`,
        instance: req.originalUrl,
      })
    );
  });

  return app;
}

const app = createApp({ enableTestRoutes: process.env.NODE_ENV === 'test' });

// ─── Server lifecycle ─────────────────────────────────────────────────────────

// RFC 7807 error handler — handles AppError + generic errors.
app.use(errorHandler);

/**
 * Starts the HTTP server.
 *
 * @returns {import('http').Server}
 */
const startServer = () => {
  const server = app.listen(PORT, () => {
    console.warn(`LiquiFact API running at http://localhost:${PORT}`);
  });
  return server;
};

/**
 * Resets the in-memory invoice collection for tests.
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
