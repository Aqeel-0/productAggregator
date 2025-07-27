/**
 * Amazon Rate Limiting Configuration
 * Conservative approach for Amazon's stricter anti-bot measures
 */

const AmazonRateLimitConfig = {
  // Use token bucket for burst handling
  algorithm: 'token-bucket',
  
  // Multiple tiers for comprehensive limiting
  limits: [
    {
      tier: 'global',           // Overall rate limit
      requests: 10,             // Very conservative: 10 req/sec
      window: 1000,             // 1 second window
      burstCapacity: 15         // Small burst allowance
    },
    {
      tier: 'ip',               // Per IP limiting
      requests: 40,             // 40 requests per minute
      window: 60000             // 1 minute window
    },
    {
      tier: 'domain',           // Per domain overall
      requests: 500,            // 500 requests per hour
      window: 3600000           // 1 hour window
    }
  ],
  
  // Adaptive delays configuration
  baseDelay: 2000,              // 2 second base delay
  
  // Respectful scraping settings
  respectfulMode: {
    enabled: true,
    maxConcurrent: 1,           // Only 1 concurrent request for Amazon
    retryOnRateLimit: true,
    maxRetries: 3,
    backoffMultiplier: 2        // Exponential backoff
  },
  
  // Circuit breaker for temporary blocks
  circuitBreaker: {
    enabled: true,
    failureThreshold: 3,        // Lower threshold for Amazon
    timeout: 120000,            // 2 minutes timeout
    monitoringWindow: 300000    // 5 minutes monitoring
  }
};

module.exports = AmazonRateLimitConfig; 