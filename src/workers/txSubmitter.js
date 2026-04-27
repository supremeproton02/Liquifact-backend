'use strict';

const JobQueue = require('./jobQueue');
const BackgroundWorker = require('./worker');
const logger = require('../logger');

const DEFAULT_CONFIG = {
  maxRetries: Math.min(parseInt(process.env.SOROBAN_TX_SUBMIT_MAX_RETRIES || '3', 10), 10),
  baseDelayMs: Math.min(parseInt(process.env.SOROBAN_TX_SUBMIT_BASE_DELAY_MS || '500', 10), 10000),
  maxDelayMs: Math.min(parseInt(process.env.SOROBAN_TX_SUBMIT_MAX_DELAY_MS || '20000', 10), 60000),
  feeBumpMultiplier: Math.min(parseFloat(process.env.SOROBAN_TX_FEE_BUMP_MULTIPLIER || '2'), 10),
};

/**
 * Determines if a transaction submission error is retryable.
 *
 * @param {Error|Object} err - The error object to evaluate.
 * @returns {boolean} True if the error is considered transient and retryable.
 */
function isRetryableSubmitError(err) {
  if (!err || typeof err !== 'object') {
    return false;
  }

  const code = String(err.code || '').toLowerCase();
  if (['etimedout', 'econnreset', 'eai_again', 'enotfound'].includes(code)) {
    return true;
  }

  const message = String(err.message || err).toLowerCase();
  if (
    message.includes('tx_bad_seq') ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('transaction_timeout')
  ) {
    return true;
  }

  const resultCode = err.result?.code || err.result?.result?.code;
  if (typeof resultCode === 'string' && resultCode.toLowerCase().includes('tx_bad_seq')) {
    return true;
  }

  return false;
}

/**
 * Computes an exponential backoff delay for transaction submission retries.
 *
 * @param {number} attempt - The current retry attempt number.
 * @param {number} baseDelay - The base delay in milliseconds.
 * @param {number} maxDelay - The maximum allowed delay in milliseconds.
 * @returns {number} The computed delay in milliseconds.
 */
function computeTxBackoff(attempt, baseDelay, maxDelay) {
  const delay = Math.min(baseDelay * 2 ** attempt, maxDelay);
  return Math.max(0, delay);
}

/**
 * Submits a Soroban transaction with retries and exponential backoff.
 *
 * @param {Function} operation - The transaction submission function.
 * @param {Object} [config={}] - Retry configuration.
 * @returns {Promise<any>} The result of the transaction submission.
 */
async function submitWithRetry(operation, config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  let lastError;

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt += 1) {
    try {
      return await operation({ attempt, feeBumpMultiplier: cfg.feeBumpMultiplier });
    } catch (err) {
      lastError = err;
      const isLastAttempt = attempt === cfg.maxRetries;
      if (isLastAttempt || !isRetryableSubmitError(err)) {
        throw err;
      }
      const delayMs = computeTxBackoff(attempt, cfg.baseDelayMs, cfg.maxDelayMs);
      logger.warn(
        { attempt, delayMs, error: err.message || err, retryable: true },
        'Retrying Soroban transaction submission after transient failure'
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

/**
 * Job handler for processing transaction submission tasks from the queue.
 *
 * @param {Object} job - The job object from the queue.
 * @param {Function} submitTransactionFn - The function that performs the actual submission.
 * @param {Object} [config={}] - Submission configuration.
 * @returns {Promise<any>} The result of the submission.
 */
async function handleTxSubmitJob(job, submitTransactionFn, config = {}) {
  if (!job || typeof job.payload !== 'object' || job.payload === null) {
    throw new Error('Invalid tx submit job payload');
  }
  if (typeof submitTransactionFn !== 'function') {
    throw new Error('submitTransactionFn must be supplied');
  }

  const payload = job.payload;
  if (
    typeof payload.signedTransactionXdr !== 'string' ||
    payload.signedTransactionXdr.trim() === ''
  ) {
    throw new Error('signedTransactionXdr is required for transaction submission');
  }

  return submitWithRetry(async (context) => {
    return submitTransactionFn(payload, context);
  }, config);
}

/**
 * Creates a background worker specialized in transaction submission.
 *
 * @param {Function} submitTransactionFn - The function that performs the actual submission.
 * @param {Object} [options={}] - Worker and retry options.
 * @returns {Object} The worker control interface.
 */
function createTxSubmitterWorker(submitTransactionFn, options = {}) {
  const txQueue = new JobQueue({ maxRetries: 0 });
  const txWorker = new BackgroundWorker({
    jobQueue: txQueue,
    pollIntervalMs: options.pollIntervalMs ?? 100,
    maxConcurrency: options.maxConcurrency ?? 1,
  });

  txWorker.registerHandler('submit_soroban_tx', async (job) => {
    return handleTxSubmitJob(job, submitTransactionFn, options.retryConfig);
  });

  return {
    txQueue,
    txWorker,
    enqueueTxSubmission: (payload, enqueueOptions = {}) =>
      txQueue.enqueue('submit_soroban_tx', payload, enqueueOptions),
  };
}

module.exports = {
  createTxSubmitterWorker,
  submitWithRetry,
  isRetryableSubmitError,
  computeTxBackoff,
  handleTxSubmitJob,
  DEFAULT_CONFIG,
};
