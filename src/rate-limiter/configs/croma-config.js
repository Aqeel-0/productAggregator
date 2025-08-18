/**
 * Croma Rate Limiting Configuration
 * Conservative defaults; tune as needed.
 */

const CromaRateLimitConfig = {
  algorithm: 'token-bucket',
  limits: [
    { tier: 'global', requests: 12, window: 1000, burstCapacity: 18 },
    { tier: 'ip', requests: 80, window: 60000 },
    { tier: 'domain', requests: 1000, window: 3600000 }
  ],
  baseDelay: 1000,
  respectfulMode: {
    enabled: true,
    maxConcurrent: 3,
    retryOnRateLimit: true,
    maxRetries: 3
  }
};

module.exports = CromaRateLimitConfig;



