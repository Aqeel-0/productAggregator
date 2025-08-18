/**
 * Reliance Digital Rate Limiting Configuration
 * Conservative defaults; tune as needed.
 */

const RelianceRateLimitConfig = {
  algorithm: 'token-bucket',
  limits: [
    { tier: 'global', requests: 3, window: 5000, burstCapacity: 5 },
    { tier: 'ip', requests: 20, window: 60000 },
    { tier: 'domain', requests: 200, window: 3600000 }
  ],
  baseDelay: 3000,
  respectfulMode: {
    enabled: true,
    maxConcurrent: 1,
    retryOnRateLimit: true,
    maxRetries: 5
  }
};

module.exports = RelianceRateLimitConfig;



