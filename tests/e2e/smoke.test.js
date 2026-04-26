/**
 * E2E Smoke Test Suite
 * Hits the API endpoints in a live container environment.
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');

const API_URL = process.env.API_URL || 'http://localhost:3001';
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret-test-token-key-32-chars-long';

describe('Liquifact API Smoke Tests', () => {
  let authToken;

  beforeAll(() => {
    // Generate a test token
    authToken = jwt.sign({ sub: 'test-user', role: 'admin' }, JWT_SECRET);
  });

  describe('GET /health', () => {
    it('should return 200 OK with healthy status', async () => {
      const res = await request(API_URL).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.checks.soroban.status).toBe('healthy');
    });
  });

  describe('GET /v1/escrow/:invoiceId', () => {
    it('should return 401 without token', async () => {
      const res = await request(API_URL).get('/v1/escrow/inv_123');
      expect(res.status).toBe(401);
    });

    it('should return escrow state with valid token', async () => {
      const res = await request(API_URL)
        .get('/v1/escrow/inv_123')
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body.data.invoiceId).toBe('inv_123');
      expect(res.body.message).toContain('mocked');
    });
  });

  describe('Backward Compatibility: GET /api/esc/:invoiceId', () => {
    it('should return 200 with Warning header', async () => {
      const res = await request(API_URL)
        .get('/api/escrow/inv_123')
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(res.status).toBe(200);
      expect(res.headers['warning']).toContain('deprecated');
    });
  });
});
