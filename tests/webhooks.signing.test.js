'use strict';

process.env.NODE_ENV = 'test';

jest.mock('axios');
jest.mock('../src/db/knex', () => jest.fn());
jest.mock('../src/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
}));

const axios = require('axios');
const db = require('../src/db/knex');
const logger = require('../src/logger');
const {
  emitWebhook,
  verifySignature,
  createSignature,
  createSignatureHeader,
  SIGNATURE_VERSION,
  TOLERANCE_MS,
} = require('../src/services/webhooks');

describe('webhooks service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('emitWebhook', () => {
    it('emits webhook successfully for valid tenant and settings', async () => {
      const mockDb = jest.fn();
      const mockSelect = jest.fn().mockReturnThis();
      const mockWhere = jest.fn().mockReturnThis();
      const mockFirstInvoice = jest.fn().mockResolvedValue({ tenant_id: 'tenant_123' });
      const mockFirstTenant = jest.fn().mockResolvedValue({
        settings: {
          webhook_url: 'https://example.com/webhook',
          webhook_secret: 'secret123',
        },
      });

      mockDb.mockReturnValueOnce({
        select: mockSelect,
        where: jest.fn().mockReturnThis(),
        first: mockFirstInvoice,
      });
      mockDb.mockReturnValueOnce({
        select: mockSelect,
        where: jest.fn().mockReturnThis(),
        first: mockFirstTenant,
      });

      db.mockImplementation(mockDb);

      axios.post.mockResolvedValue({ status: 200 });

      const event = 'escrow_funded';
      const invoiceId = 'inv_123';
      const additionalData = { amount: 1000 };

      await emitWebhook(event, invoiceId, additionalData);

      expect(db).toHaveBeenCalledWith('invoices');
      expect(db).toHaveBeenCalledWith('tenants');

      expect(axios.post).toHaveBeenCalledWith(
        'https://example.com/webhook',
        expect.objectContaining({
          event,
          invoiceId,
          amount: 1000,
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-Signature': expect.stringMatching(/^t=\d+,v1=[a-f0-9]{64}$/),
          }),
          timeout: 5000,
        })
      );

      expect(logger.info).toHaveBeenCalledWith(
        { event, invoiceId, tenant_id: 'tenant_123' },
        'Webhook emitted successfully'
      );
    });

    it('skips emission if invoice not found', async () => {
      db.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        first: jest.fn().mockResolvedValue(null),
      });

      await emitWebhook('escrow_funded', 'inv_123');

      expect(axios.post).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        { invoiceId: 'inv_123' },
        'Invoice not found for webhook emission'
      );
    });

    it('skips emission if tenant settings not found', async () => {
      db.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        first: jest.fn()
          .mockResolvedValueOnce({ tenant_id: 'tenant_123' })
          .mockResolvedValueOnce(null),
      });

      await emitWebhook('escrow_funded', 'inv_123');

      expect(axios.post).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        { tenant_id: 'tenant_123', invoiceId: 'inv_123' },
        'Tenant settings not found for webhook'
      );
    });

    it('skips emission if webhook_url or webhook_secret missing', async () => {
      db.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        first: jest.fn()
          .mockResolvedValueOnce({ tenant_id: 'tenant_123' })
          .mockResolvedValueOnce({ settings: {} }),
      });

      await emitWebhook('escrow_funded', 'inv_123');

      expect(axios.post).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        { tenant_id: 'tenant_123', invoiceId: 'inv_123' },
        'Webhook URL or secret not configured'
      );
    });

    it('logs error on webhook emission failure', async () => {
      db.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        first: jest.fn()
          .mockResolvedValueOnce({ tenant_id: 'tenant_123' })
          .mockResolvedValueOnce({
            settings: {
              webhook_url: 'https://example.com/webhook',
              webhook_secret: 'secret123',
            },
          }),
      });

      axios.post.mockRejectedValue(new Error('Network error'));

      await emitWebhook('escrow_funded', 'inv_123');

      expect(logger.error).toHaveBeenCalledWith(
        { event: 'escrow_funded', invoiceId: 'inv_123', error: 'Network error' },
        'Failed to emit webhook'
      );
    });
  });

  describe('signature construction', () => {
    it('creates signature with t=v1 format', () => {
      const secret = 'secret123';
      const rawBody = JSON.stringify({ event: 'escrow_funded', invoiceId: 'inv_123' });
      const signatureHeader = createSignatureHeader(secret, rawBody);

      expect(signatureHeader).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);
      const parts = signatureHeader.split(',');
      expect(parts[0]).toMatch(/^t=\d+$/);
      expect(parts[1]).toMatch(/^v1=[a-f0-9]{64}$/);
    });

    it('creates consistent signature for same inputs', () => {
      const secret = 'secret123';
      const rawBody = JSON.stringify({ event: 'escrow_funded', invoiceId: 'inv_123' });
      const timestamp = Math.floor(Date.now() / 1000);

      const sig1 = createSignature(secret, rawBody, timestamp);
      const sig2 = createSignature(secret, rawBody, timestamp);

      expect(sig1).toBe(sig2);
    });

    it('creates different signatures for different payloads', () => {
      const secret = 'secret123';
      const rawBody1 = JSON.stringify({ event: 'escrow_funded', invoiceId: 'inv_123' });
      const rawBody2 = JSON.stringify({ event: 'escrow_settled', invoiceId: 'inv_123' });
      const timestamp = Math.floor(Date.now() / 1000);

      const sig1 = createSignature(secret, rawBody1, timestamp);
      const sig2 = createSignature(secret, rawBody2, timestamp);

      expect(sig1).not.toBe(sig2);
    });

    it('creates different signatures for different secrets', () => {
      const secret1 = 'secret123';
      const secret2 = 'different_secret';
      const rawBody = JSON.stringify({ event: 'escrow_funded', invoiceId: 'inv_123' });
      const timestamp = Math.floor(Date.now() / 1000);

      const sig1 = createSignature(secret1, rawBody, timestamp);
      const sig2 = createSignature(secret2, rawBody, timestamp);

      expect(sig1).not.toBe(sig2);
    });

    it('creates different signatures for different timestamps', () => {
      const secret = 'secret123';
      const rawBody = JSON.stringify({ event: 'escrow_funded', invoiceId: 'inv_123' });

      const sig1 = createSignature(secret, rawBody, 1000000);
      const sig2 = createSignature(secret, rawBody, 2000000);

      expect(sig1).not.toBe(sig2);
    });

    it('exports SIGNATURE_VERSION as v1', () => {
      expect(SIGNATURE_VERSION).toBe('v1');
    });

    it('exports TOLERANCE_MS as 5 minutes', () => {
      expect(TOLERANCE_MS).toBe(5 * 60 * 1000);
    });
  });

  describe('verifySignature', () => {
    const secret = 'test_secret';
    const rawBody = JSON.stringify({ event: 'escrow_funded', invoiceId: 'inv_123' });

    it('returns valid for correct signature', () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const signatureHeader = `t=${timestamp},v1=${createSignature(secret, rawBody, timestamp)}`;

      const result = verifySignature(secret, rawBody, signatureHeader);

      expect(result.valid).toBe(true);
      expect(result.error).toBeNull();
    });

    it('returns invalid for tampered payload', () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const originalSignature = createSignature(secret, rawBody, timestamp);
      const signatureHeader = `t=${timestamp},v1=${originalSignature}`;
      const tamperedBody = JSON.stringify({ event: 'escrow_settled', invoiceId: 'inv_123' });

      const result = verifySignature(secret, tamperedBody, signatureHeader);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Signature mismatch');
    });

    it('returns invalid for tampered timestamp in header', () => {
      const originalTimestamp = Math.floor(Date.now() / 1000);
      const tamperedTimestamp = originalTimestamp + 100;
      const originalSignature = createSignature(secret, rawBody, originalTimestamp);
      const signatureHeader = `t=${tamperedTimestamp},v1=${originalSignature}`;

      const result = verifySignature(secret, rawBody, signatureHeader);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Signature mismatch');
    });

    it('returns invalid for incorrect secret', () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const signatureHeader = `t=${timestamp},v1=${createSignature(secret, rawBody, timestamp)}`;

      const result = verifySignature('wrong_secret', rawBody, signatureHeader);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Signature mismatch');
    });

    it('returns invalid for timestamp outside tolerance window', () => {
      const oldTimestamp = Math.floor(Date.now() / 1000) - 10 * 60;
      const signatureHeader = `t=${oldTimestamp},v1=${createSignature(secret, rawBody, oldTimestamp)}`;

      const result = verifySignature(secret, rawBody, signatureHeader, 5 * 60 * 1000);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Timestamp outside tolerance window');
    });

    it('accepts timestamp within tolerance window', () => {
      const recentTimestamp = Math.floor(Date.now() / 1000) - 2 * 60;
      const signatureHeader = `t=${recentTimestamp},v1=${createSignature(secret, rawBody, recentTimestamp)}`;

      const result = verifySignature(secret, rawBody, signatureHeader, 5 * 60 * 1000);

      expect(result.valid).toBe(true);
    });

    it('returns invalid for missing timestamp in signature header', () => {
      const signatureHeader = `v1=abc123`;

      const result = verifySignature(secret, rawBody, signatureHeader);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid signature header format');
    });

    it('returns invalid for missing signature in header', () => {
      const signatureHeader = `t=1234567890`;

      const result = verifySignature(secret, rawBody, signatureHeader);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid signature header format');
    });

    it('returns invalid for malformed signature header', () => {
      const result = verifySignature(secret, rawBody, 'invalid-format');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid signature header format');
    });
  });
});