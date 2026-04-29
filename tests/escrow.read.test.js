// escrow.read.test.js
// Tests for escrowRead service and /api/escrow/:invoiceId endpoint

const request = require('supertest');
const { createApp, resetStore } = require('../src/index');
const { readEscrowState } = require('../src/services/escrowRead');

describe('escrowRead service', () => {
  beforeAll(() => {
    process.env.ESCROW_ADDR_BY_INVOICE = 'inv1:contractA,inv2:contractB';
  });

  it('maps invoiceId to contractId and reads escrow state', async () => {
    const result = await readEscrowState('inv1');
    expect(result).toHaveProperty('contractId', 'contractA');
    expect(result).toHaveProperty('escrow');
    expect(result).toHaveProperty('legalHold', false);
  });

  it('throws 404 if invoiceId not mapped', async () => {
    await expect(readEscrowState('notfound')).rejects.toThrow(/No contract mapping/);
  });
});

describe('/api/escrow/:invoiceId', () => {
  let app;
  beforeAll(() => {
    process.env.ESCROW_ADDR_BY_INVOICE = 'inv1:contractA,inv2:contractB';
    app = createApp();
  });

  it('returns escrow state for mapped invoice', async () => {
    const res = await request(app)
      .get('/api/escrow/inv1')
      .set('Authorization', 'Bearer testtoken');
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveProperty('contractId', 'contractA');
    expect(res.body.data).toHaveProperty('escrow');
    expect(res.body.data).toHaveProperty('legalHold', false);
  });

  it('returns 404 for unmapped invoice', async () => {
    const res = await request(app)
      .get('/api/escrow/unknown')
      .set('Authorization', 'Bearer testtoken');
    expect(res.statusCode).toBe(404);
    expect(res.body.error).toMatch(/No contract mapping/);
  });
});
