'use strict';

describe('Sentry observability module', () => {
  let mockSentry;
  let initialEnv;

  beforeEach(() => {
    jest.resetModules();
    initialEnv = { ...process.env };

    mockSentry = {
      init: jest.fn(),
      captureException: jest.fn(),
      withScope: jest.fn((cb) => cb({})),
      Handlers: {
        requestHandler: jest.fn(() => (req, res, next) => next()),
      },
    };

    jest.doMock('@sentry/node', () => mockSentry);
  });

  afterEach(() => {
    process.env = initialEnv;
    jest.resetAllMocks();
  });

  it('does not initialize Sentry when SENTRY_DSN is unset', () => {
    delete process.env.SENTRY_DSN;

    const sentry = require('../../src/observability/sentry');
    sentry.initSentry();

    expect(mockSentry.init).not.toHaveBeenCalled();
    expect(sentry.isEnabled()).toBe(false);
  });

  it('initializes Sentry when SENTRY_DSN is present', () => {
    process.env.SENTRY_DSN = 'https://public@sentry.io/123';
    process.env.SENTRY_RELEASE = 'liquifact-backend@1.0.0';
    process.env.SENTRY_ENVIRONMENT = 'staging';

    const sentry = require('../../src/observability/sentry');
    sentry.initSentry();

    expect(mockSentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://public@sentry.io/123',
        release: 'liquifact-backend@1.0.0',
        environment: 'staging',
        beforeSend: expect.any(Function),
      }),
    );
    expect(sentry.isEnabled()).toBe(true);
  });

  it('returns no-op request handler when Sentry is disabled', () => {
    delete process.env.SENTRY_DSN;

    const sentry = require('../../src/observability/sentry');
    sentry.initSentry();

    const handler = sentry.requestHandler();
    expect(typeof handler).toBe('function');

    const next = jest.fn();
    handler({}, {}, next);
    expect(next).toHaveBeenCalled();
  });

  it('captures exceptions with request context when enabled', () => {
    process.env.SENTRY_DSN = 'https://public@sentry.io/123';
    const sentry = require('../../src/observability/sentry');
    sentry.initSentry();

    const req = {
      id: 'cid-123',
      method: 'POST',
      originalUrl: '/api/invoices',
      headers: { authorization: 'Bearer secret-token', 'x-api-key': 'abc123' },
      body: { invoice: { amount: 100 }, customer: 'Acme' },
      query: { debug: 'true' },
      user: { id: 'user-1', email: 'user@example.com' },
    };

    sentry.captureException(new Error('boom'), req);

    expect(mockSentry.withScope).toHaveBeenCalled();
    expect(mockSentry.captureException).toHaveBeenCalled();
  });

  it('scrubs sensitive values from Sentry events before send', () => {
    process.env.SENTRY_DSN = 'https://public@sentry.io/123';
    const sentry = require('../../src/observability/sentry');
    sentry.initSentry();

    const scrubbed = sentry.scrubEvent({
      request: {
        headers: {
          authorization: 'Bearer super-secret-token',
          'x-api-key': 'abc123',
          'content-type': 'application/json',
        },
        data: {
          invoice: {
            id: 'inv_1',
            amount: 1000,
          },
          xdr: 'AAAAAgAAAAA',
          detail: 'customer invoice body',
        },
      },
      extra: {
        stack: 'Error stack',
      },
    });

    expect(scrubbed.request.headers.authorization).toBe('[REDACTED]');
    expect(scrubbed.request.headers['x-api-key']).toBe('[REDACTED]');
    expect(scrubbed.request.data.invoice).toEqual('[REDACTED-INVOICE]');
    expect(scrubbed.request.data.xdr).toBe('[REDACTED]');
  });
});
