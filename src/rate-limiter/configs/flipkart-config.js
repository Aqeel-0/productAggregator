/**
 * Flipkart Rate Limiting Configuration
 * Based on Flipkart's API guidelines: 20 calls per second
 */

const FlipkartRateLimitConfig = {
  // Use token bucket for burst handling
  algorithm: 'token-bucket',
  
  // Multiple tiers for comprehensive limiting
  limits: [
    {
      tier: 'global',           // Overall rate limit
      requests: 18,             // Conservative: 18 req/sec (90% of 20/sec limit)
      window: 1000,             // 1 second window
      burstCapacity: 25         // Allow small bursts
    },
    {
      tier: 'ip',               // Per IP limiting
      requests: 60,             // 60 requests per minute
      window: 60000             // 1 minute window
    },
    {
      tier: 'domain',           // Per domain overall
      requests: 1000,           // 1000 requests per hour
      window: 3600000           // 1 hour window
    }
  ],
  
  // Adaptive delays configuration (for calculateDelay method)
  baseDelay: 1000,              // 1 second base delay
  
  // Respectful scraping settings (not used by RateLimiter but good for documentation)
  respectfulMode: {
    enabled: true,
    maxConcurrent: 1,           // Only 1 concurrent request to be respectful
    retryOnRateLimit: true,
    maxRetries: 3
  }
};

module.exports = FlipkartRateLimitConfig; 