'use strict';

const DEFAULT_TTL_SECONDS = 30;
const MIN_TTL_SECONDS = 5;
const MAX_TTL_SECONDS = 300;

const DEFAULT_LEDGER_GAP_THRESHOLD = 3;
const MAX_LEDGER_GAP_THRESHOLD = 1000;

/**
 * Parses a positive integer from a raw value with fallback and range clamping.
 *
 * @param {any} rawValue - The value to parse.
 * @param {number} fallback - The default value if parsing fails.
 * @param {number} min - The minimum allowed value.
 * @param {number} max - The maximum allowed value.
 * @returns {number} The parsed and clamped integer.
 */
function parsePositiveInt(rawValue, fallback, min, max) {
  const parsed = Number.parseInt(String(rawValue || ''), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
}

/**
 * Parses the Redis escrow cache configuration from environment variables.
 *
 * @param {Object} [env=process.env] - The environment variables object.
 * @returns {Object} The parsed configuration.
 */
function parseRedisEscrowCacheConfig(env = process.env) {
  const enabled = String(env.REDIS_ESCROW_CACHE_ENABLED || '').toLowerCase() === 'true';
  const redisUrl = env.REDIS_URL || '';

  return {
    enabled: enabled && Boolean(redisUrl),
    redisUrl,
    ttlSeconds: parsePositiveInt(
      env.REDIS_ESCROW_CACHE_TTL_SECONDS,
      DEFAULT_TTL_SECONDS,
      MIN_TTL_SECONDS,
      MAX_TTL_SECONDS
    ),
    ledgerGapThreshold: parsePositiveInt(
      env.REDIS_ESCROW_LEDGER_GAP_THRESHOLD,
      DEFAULT_LEDGER_GAP_THRESHOLD,
      1,
      MAX_LEDGER_GAP_THRESHOLD
    ),
  };
}

/**
 * Creates a Redis client based on the provided configuration.
 *
 * @param {Object} [config=parseRedisEscrowCacheConfig()] - The configuration object.
 * @param {Function} [RedisCtor] - Optional Redis constructor for testing.
 * @returns {Object|null} The Redis client instance or null if disabled.
 */
function createRedisClient(config = parseRedisEscrowCacheConfig(), RedisCtor) {
  if (!config.enabled) {
    return null;
  }

  const Redis = RedisCtor || require('ioredis');
  return new Redis(config.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
}

/**
 * Validates an invoice ID format for cache keys.
 *
 * @param {string} invoiceId - The invoice ID to validate.
 * @returns {boolean} True if the invoice ID is valid.
 */
function isValidInvoiceId(invoiceId) {
  return typeof invoiceId === 'string' && /^[a-zA-Z0-9:_-]{1,128}$/.test(invoiceId);
}

/**
 * Cache implementation for escrow summaries using Redis.
 */
class RedisEscrowSummaryCache {
  /**
   * Initializes the cache with a Redis client and settings.
   *
   * @param {Object} options - Configuration options.
   * @param {Object} options.client - The Redis client instance.
   * @param {number} [options.ttlSeconds=30] - Time-to-live for cache entries in seconds.
   * @param {number} [options.ledgerGapThreshold=3] - Maximum ledger gap allowed before invalidation.
   * @param {string} [options.keyPrefix='escrow:summary'] - Prefix for Redis keys.
   */
  constructor({
    client,
    ttlSeconds = DEFAULT_TTL_SECONDS,
    ledgerGapThreshold = DEFAULT_LEDGER_GAP_THRESHOLD,
    keyPrefix = 'escrow:summary',
  }) {
    this.client = client;
    this.ttlSeconds = ttlSeconds;
    this.ledgerGapThreshold = ledgerGapThreshold;
    this.keyPrefix = keyPrefix;
  }

  /**
   * Generates a Redis key for a given invoice ID.
   *
   * @param {string} invoiceId - The invoice ID.
   * @returns {string} The Redis key.
   */
  key(invoiceId) {
    return `${this.keyPrefix}:${invoiceId}`;
  }

  /**
   * Retrieves a cached escrow summary if valid.
   *
   * @param {string} invoiceId - The invoice ID.
   * @param {number} [currentLedger] - The current ledger sequence for gap validation.
   * @returns {Promise<{hit: boolean, reason?: string, value?: Object}>} The cache result.
   */
  async getSummary(invoiceId, currentLedger) {
    if (!this.client || !isValidInvoiceId(invoiceId)) {
      return { hit: false, reason: 'invalid_input' };
    }

    const key = this.key(invoiceId);

    try {
      const raw = await this.client.get(key);
      if (!raw) {
        return { hit: false, reason: 'miss' };
      }

      const entry = JSON.parse(raw);
      if (
        Number.isFinite(currentLedger) &&
        Number.isFinite(entry.cachedLedger) &&
        Math.abs(currentLedger - entry.cachedLedger) > this.ledgerGapThreshold
      ) {
        await this.client.del(key);
        return { hit: false, reason: 'ledger_gap' };
      }

      return { hit: true, value: entry.summary };
    } catch (_error) {
      return { hit: false, reason: 'cache_error' };
    }
  }

  /**
   * Caches an escrow summary.
   *
   * @param {string} invoiceId - The invoice ID.
   * @param {Object} summary - The summary data to cache.
   * @param {number} [currentLedger] - The current ledger sequence at the time of caching.
   * @returns {Promise<boolean>} True if the summary was successfully cached.
   */
  async setSummary(invoiceId, summary, currentLedger) {
    if (!this.client || !isValidInvoiceId(invoiceId)) {
      return false;
    }

    const key = this.key(invoiceId);
    const payload = JSON.stringify({
      summary,
      cachedLedger: Number.isFinite(currentLedger) ? currentLedger : null,
      cachedAt: new Date().toISOString(),
    });

    try {
      await this.client.set(key, payload, 'EX', this.ttlSeconds);
      return true;
    } catch (_error) {
      return false;
    }
  }
}

/**
 * Factory function to create a RedisEscrowSummaryCache instance.
 *
 * @param {Object} [options={}] - Creation options.
 * @param {Object} [options.env=process.env] - Environment variables.
 * @param {Object} [options.client] - Optional pre-existing Redis client.
 * @param {Function} [options.RedisCtor] - Optional Redis constructor.
 * @returns {RedisEscrowSummaryCache|null} The cache instance or null if disabled.
 */
function createRedisEscrowSummaryCache({ env = process.env, client, RedisCtor } = {}) {
  const config = parseRedisEscrowCacheConfig(env);
  const redisClient = client || createRedisClient(config, RedisCtor);

  if (!redisClient) {
    return null;
  }

  return new RedisEscrowSummaryCache({
    client: redisClient,
    ttlSeconds: config.ttlSeconds,
    ledgerGapThreshold: config.ledgerGapThreshold,
  });
}

module.exports = {
  RedisEscrowSummaryCache,
  createRedisClient,
  createRedisEscrowSummaryCache,
  isValidInvoiceId,
  parseRedisEscrowCacheConfig,
};
