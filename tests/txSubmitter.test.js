'use strict';

const {
  createTxSubmitterWorker,
  submitWithRetry,
  isRetryableSubmitError,
  computeTxBackoff,
  handleTxSubmitJob,
} = require('../src/workers/txSubmitter');

// Mock the logger to avoid dependency issues
jest.mock('../src/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
}));

describe('txSubmitter worker utilities', () => {
  it('marks tx_bad_seq and timeout errors as retryable', () => {
    expect(isRetryableSubmitError(new Error('tx_bad_seq'))).toBe(true);
    expect(isRetryableSubmitError(new Error('transaction timed out'))).toBe(true);
    expect(isRetryableSubmitError({ code: 'ETIMEDOUT' })).toBe(true);
    expect(isRetryableSubmitError(new Error('bad signature'))).toBe(false);
  });

  it('computes exponential backoff correctly', () => {
    expect(computeTxBackoff(0, 100, 1000)).toBe(100);
    expect(computeTxBackoff(1, 100, 1000)).toBe(200);
    expect(computeTxBackoff(4, 100, 500)).toBe(500);
  });

  it('retries transient failures and succeeds', async () => {
    let attempts = 0;
    const operation = jest.fn(async () => {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error('tx_bad_seq');
        error.code = 'TX_BAD_SEQ';
        throw error;
      }
      return 'submitted';
    });

    await expect(submitWithRetry(operation, { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 5 })).resolves.toBe('submitted');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('fails immediately on non-retryable errors', async () => {
    const operation = jest.fn(async () => {
      throw new Error('invalid transaction');
    });

    await expect(submitWithRetry(operation, { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 5 })).rejects.toThrow('invalid transaction');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('handles a worker job through the tx submitter worker', async () => {
    let submitAttempts = 0;
    const submitTransactionFn = jest.fn(async (payload, context) => {
      submitAttempts += 1;
      if (submitAttempts === 1) {
        const err = new Error('tx_bad_seq');
        err.code = 'TX_BAD_SEQ';
        throw err;
      }
      return { status: 'ok', payload };
    });

    const { txQueue, txWorker, enqueueTxSubmission } = createTxSubmitterWorker(submitTransactionFn, {
      pollIntervalMs: 10,
      maxConcurrency: 1,
      retryConfig: { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 5 },
    });

    txWorker.start();

    const jobId = enqueueTxSubmission({ signedTransactionXdr: 'abcdef123' });
    expect(jobId).toEqual(expect.stringContaining('job-'));

    await new Promise((resolve) => setTimeout(resolve, 100));

    const job = txQueue.getJob(jobId);
    expect(job.status).toBe('completed');
    expect(submitTransactionFn).toHaveBeenCalledTimes(2);

    await txWorker.stop();
  });

  it('rejects invalid job payloads', async () => {
    const submitTransactionFn = jest.fn();
    await expect(handleTxSubmitJob({ payload: {} }, submitTransactionFn)).rejects.toThrow('signedTransactionXdr is required');
  });
});
