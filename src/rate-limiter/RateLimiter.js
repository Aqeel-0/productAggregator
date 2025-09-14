const Redis = require('redis');
const { EventEmitter } = require('events');

/**
 * Rate Limiter Service
 * 
 * Supports multiple algorithms:
 * - Token Bucket: Allows bursts but maintains steady rate
 * - Fixed Window: Simple time-window based limiting  
 * - Sliding Window Log: Precise tracking with memory overhead
 * - Sliding Window Counter: Approximate but memory efficient
 * 
 * Features:
 * - Multi-tier rate limiting (per IP, per user, per API key)
 * - Distributed rate limiting with Redis
 * - Configurable algorithms per domain/service
 * - Rate limit headers for client feedback
 * - Graceful degradation and circuit breaker
 */
class RateLimiter extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      // Default configuration
      defaultAlgorithm: 'token-bucket',
      defaultLimit: 100,
      defaultWindow: 60000, // 1 minute in ms
      
      // Redis configuration
      redis: {
        enabled: config.redis?.enabled || false,
        host: config.redis?.host || 'localhost',
        port: config.redis?.port || 6379,
        password: config.redis?.password || null,
        db: config.redis?.db || 0,
        keyPrefix: config.redis?.keyPrefix || 'rate_limit:',
        ttl: config.redis?.ttl || 3600 // 1 hour
      },
      
      // Circuit breaker for Redis failures
      circuitBreaker: {
        enabled: true,
        failureThreshold: 5,
        timeout: 30000, // 30 seconds
        monitoringWindow: 60000 // 1 minute
      },
      
      // Performance settings
      cleanupInterval: 300000, // 5 minutes
      maxMemoryEntries: 10000,
      
      ...config
    };
    
    // Rate limiting rules per domain/service
    this.rules = new Map();
    
    // In-memory storage for when Redis is not available
    this.memoryStore = new Map();
    
    // Redis client
    this.redisClient = null;
    this.redisAvailable = false;
    
    // Circuit breaker state
    this.circuitBreakerState = {
      failures: 0,
      lastFailureTime: 0,
      isOpen: false
    };
    
    // Store interval references for cleanup
    this.cleanupInterval = null;
    
    this.initialize();
  }
  
  async initialize() {
    // Setup Redis if enabled
    if (this.config.redis.enabled) {
      await this.setupRedis();
    }
    
    // Setup cleanup interval for memory store
    this.setupCleanup();
    
    this.emit('initialized');
  }
  
  async setupRedis() {
    try {
      this.redisClient = Redis.createClient({
        host: this.config.redis.host,
        port: this.config.redis.port,
        password: this.config.redis.password,
        db: this.config.redis.db,
        retry_strategy: (options) => {
          if (options.error && options.error.code === 'ECONNREFUSED') {
            this.handleRedisFailure('Connection refused');
            return new Error('Redis server refused connection');
          }
          
          if (options.total_retry_time > 1000 * 60 * 60) {
            this.handleRedisFailure('Retry time exhausted');
            return new Error('Retry time exhausted');
          }
          
          return Math.min(options.attempt * 100, 3000);
        }
      });
      
      this.redisClient.on('connect', () => {
        this.redisAvailable = true;
        this.resetCircuitBreaker();
        this.emit('redis:connected');
      });
      
      this.redisClient.on('error', (err) => {
        this.handleRedisFailure(err.message);
        this.emit('redis:error', err);
      });
      
      await this.redisClient.connect();
    } catch (error) {
      this.handleRedisFailure(error.message);
    }
  }
  
  handleRedisFailure(error) {
    this.redisAvailable = false;
    this.circuitBreakerState.failures++;
    this.circuitBreakerState.lastFailureTime = Date.now();
    
    if (this.circuitBreakerState.failures >= this.config.circuitBreaker.failureThreshold) {
      this.circuitBreakerState.isOpen = true;
      this.emit('circuit:open', { error, failures: this.circuitBreakerState.failures });
    }
  }
  
  resetCircuitBreaker() {
    this.circuitBreakerState.failures = 0;
    this.circuitBreakerState.isOpen = false;
    this.emit('circuit:closed');
  }
  
  setupCleanup() {
    this.cleanupInterval = setInterval(() => {
      this.cleanupMemoryStore();
    }, this.config.cleanupInterval);
  }
  
  cleanupMemoryStore() {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, data] of this.memoryStore.entries()) {
      // Remove expired entries
      if (data.expiresAt && data.expiresAt < now) {
        this.memoryStore.delete(key);
        cleaned++;
      }
    }
    
    // If memory store is too large, remove oldest entries
    if (this.memoryStore.size > this.config.maxMemoryEntries) {
      const entries = Array.from(this.memoryStore.entries())
        .sort((a, b) => (a[1].lastAccess || 0) - (b[1].lastAccess || 0));
      
      const toRemove = this.memoryStore.size - this.config.maxMemoryEntries;
      for (let i = 0; i < toRemove; i++) {
        this.memoryStore.delete(entries[i][0]);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      this.emit('cleanup', { entriesRemoved: cleaned, totalEntries: this.memoryStore.size });
    }
  }
  
  /**
   * Register rate limiting rules for a specific domain/service
   */
  registerRules(domain, rules) {
    this.rules.set(domain, {
      algorithm: rules.algorithm || this.config.defaultAlgorithm,
      limits: Array.isArray(rules.limits) ? rules.limits : [rules],
      ...rules
    });
  }
  
  /**
   * Main rate limiting check
   */
  async checkLimit(identifier, domain = 'default', metadata = {}) {
    try {
      const rules = this.rules.get(domain) || this.getDefaultRules();
      const results = [];
      
      // Check each limit tier (e.g., per IP, per user, per API key)
      for (const limit of rules.limits) {
        const key = this.generateKey(identifier, domain, limit.tier);
        const result = await this.checkSingleLimit(key, limit, rules.algorithm);
        results.push(result);
        
        // If any limit is exceeded, return the most restrictive result
        if (!result.allowed) {
          return {
            allowed: false,
            ...result,
            domain,
            identifier,
            tier: limit.tier
          };
        }
      }
      
      // Return the most restrictive successful result
      const mostRestrictive = results.reduce((min, curr) => 
        curr.remaining < min.remaining ? curr : min
      );
      
      return {
        allowed: true,
        ...mostRestrictive,
        domain,
        identifier,
        results // Include all tier results for debugging
      };
      
    } catch (error) {
      this.emit('error', { error, identifier, domain });
      
      // Fail open - allow request if rate limiter fails
      return {
        allowed: true,
        remaining: 1,
        resetTime: Date.now() + 60000,
        error: error.message
      };
    }
  }
  
  async checkSingleLimit(key, limit, algorithm) {
    switch (algorithm) {
      case 'token-bucket':
        return this.tokenBucket(key, limit);
      case 'fixed-window':
        return this.fixedWindow(key, limit);
      case 'sliding-window-log':
        return this.slidingWindowLog(key, limit);
      case 'sliding-window-counter':
        return this.slidingWindowCounter(key, limit);
      default:
        throw new Error(`Unknown algorithm: ${algorithm}`);
    }
  }
  
  /**
   * Token Bucket Algorithm
   * Allows bursts but maintains steady rate over time
   */
  async tokenBucket(key, limit) {
    const now = Date.now();
    const windowMs = limit.window || this.config.defaultWindow;
    const maxTokens = limit.requests || this.config.defaultLimit;
    const refillRate = maxTokens / windowMs; // tokens per ms
    
    let bucket = await this.getStorage(key);
    
    if (!bucket) {
      bucket = {
        tokens: maxTokens,
        lastRefill: now,
        expiresAt: now + windowMs * 2
      };
    } else {
      // Refill tokens based on time passed
      const timePassed = now - bucket.lastRefill;
      const tokensToAdd = timePassed * refillRate;
      bucket.tokens = Math.min(maxTokens, bucket.tokens + tokensToAdd);
      bucket.lastRefill = now;
    }
    
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      await this.setStorage(key, bucket);
      
      return {
        allowed: true,
        remaining: Math.floor(bucket.tokens),
        resetTime: now + ((maxTokens - bucket.tokens) / refillRate),
        algorithm: 'token-bucket'
      };
    } else {
      return {
        allowed: false,
        remaining: 0,
        resetTime: now + ((1 - bucket.tokens) / refillRate),
        retryAfter: Math.ceil((1 - bucket.tokens) / refillRate / 1000),
        algorithm: 'token-bucket'
      };
    }
  }
  
  /**
   * Fixed Window Algorithm
   * Simple time-window based limiting
   */
  async fixedWindow(key, limit) {
    const now = Date.now();
    const windowMs = limit.window || this.config.defaultWindow;
    const maxRequests = limit.requests || this.config.defaultLimit;
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const windowKey = `${key}:${windowStart}`;
    
    let count = await this.getStorage(windowKey);
    count = count ? count.requests : 0;
    
    if (count < maxRequests) {
      await this.setStorage(windowKey, {
        requests: count + 1,
        expiresAt: windowStart + windowMs * 2
      });
      
      return {
        allowed: true,
        remaining: maxRequests - count - 1,
        resetTime: windowStart + windowMs,
        algorithm: 'fixed-window'
      };
    } else {
      return {
        allowed: false,
        remaining: 0,
        resetTime: windowStart + windowMs,
        retryAfter: Math.ceil((windowStart + windowMs - now) / 1000),
        algorithm: 'fixed-window'
      };
    }
  }
  
  /**
   * Sliding Window Log Algorithm  
   * Precise but memory intensive
   */
  async slidingWindowLog(key, limit) {
    const now = Date.now();
    const windowMs = limit.window || this.config.defaultWindow;
    const maxRequests = limit.requests || this.config.defaultLimit;
    const cutoff = now - windowMs;
    
    let log = await this.getStorage(key);
    log = log ? log.requests : [];
    
    // Remove old requests
    log = log.filter(timestamp => timestamp > cutoff);
    
    if (log.length < maxRequests) {
      log.push(now);
      await this.setStorage(key, {
        requests: log,
        expiresAt: now + windowMs * 2
      });
      
      return {
        allowed: true,
        remaining: maxRequests - log.length,
        resetTime: log.length > 0 ? log[0] + windowMs : now + windowMs,
        algorithm: 'sliding-window-log'
      };
    } else {
      const oldestRequest = Math.min(...log);
      return {
        allowed: false,
        remaining: 0,
        resetTime: oldestRequest + windowMs,
        retryAfter: Math.ceil((oldestRequest + windowMs - now) / 1000),
        algorithm: 'sliding-window-log'
      };
    }
  }
  
  /**
   * Sliding Window Counter Algorithm
   * Approximate but memory efficient
   */
  async slidingWindowCounter(key, limit) {
    const now = Date.now();
    const windowMs = limit.window || this.config.defaultWindow;
    const maxRequests = limit.requests || this.config.defaultLimit;
    
    const currentWindow = Math.floor(now / windowMs);
    const previousWindow = currentWindow - 1;
    
    const currentKey = `${key}:${currentWindow}`;
    const previousKey = `${key}:${previousWindow}`;
    
    let currentCount = await this.getStorage(currentKey);
    let previousCount = await this.getStorage(previousKey);
    
    currentCount = currentCount ? currentCount.requests : 0;
    previousCount = previousCount ? previousCount.requests : 0;
    
    // Calculate overlap from previous window
    const windowStartTime = currentWindow * windowMs;
    const timeIntoWindow = now - windowStartTime;
    const overlapPercent = Math.max(0, (windowMs - timeIntoWindow) / windowMs);
    
    const estimatedCount = (previousCount * overlapPercent) + currentCount;
    
    if (estimatedCount < maxRequests) {
      await this.setStorage(currentKey, {
        requests: currentCount + 1,
        expiresAt: windowStartTime + windowMs * 2
      });
      
      return {
        allowed: true,
        remaining: Math.floor(maxRequests - estimatedCount - 1),
        resetTime: windowStartTime + windowMs,
        algorithm: 'sliding-window-counter'
      };
    } else {
      return {
        allowed: false,
        remaining: 0,
        resetTime: windowStartTime + windowMs,
        retryAfter: Math.ceil((windowStartTime + windowMs - now) / 1000),
        algorithm: 'sliding-window-counter'
      };
    }
  }
  
  generateKey(identifier, domain, tier = 'default') {
    return `${this.config.redis.keyPrefix}${domain}:${tier}:${identifier}`;
  }
  
  getDefaultRules() {
    return {
      algorithm: this.config.defaultAlgorithm,
      limits: [{
        tier: 'default',
        requests: this.config.defaultLimit,
        window: this.config.defaultWindow
      }]
    };
  }
  
  async getStorage(key) {
    try {
      if (this.redisAvailable && !this.circuitBreakerState.isOpen) {
        const data = await this.redisClient.get(key);
        return data ? JSON.parse(data) : null;
      }
    } catch (error) {
      this.handleRedisFailure(error.message);
    }
    
    // Fallback to memory store
    const entry = this.memoryStore.get(key);
    if (entry) {
      entry.lastAccess = Date.now();
      return entry.data;
    }
    return null;
  }
  
  async setStorage(key, data) {
    try {
      if (this.redisAvailable && !this.circuitBreakerState.isOpen) {
        await this.redisClient.setEx(key, this.config.redis.ttl, JSON.stringify(data));
        return;
      }
    } catch (error) {
      this.handleRedisFailure(error.message);
    }
    
    // Fallback to memory store
    this.memoryStore.set(key, {
      data,
      expiresAt: data.expiresAt || Date.now() + this.config.redis.ttl * 1000,
      lastAccess: Date.now()
    });
  }
  
  /**
   * Get rate limit headers for HTTP responses
   */
  getRateLimitHeaders(result) {
    return {
      'X-RateLimit-Limit': result.limit || 'unknown',
      'X-RateLimit-Remaining': result.remaining || 0,
      'X-RateLimit-Reset': Math.ceil((result.resetTime || Date.now()) / 1000),
      'X-RateLimit-Algorithm': result.algorithm || 'unknown',
      ...(result.retryAfter && { 'Retry-After': result.retryAfter })
    };
  }
  
  /**
   * Calculate optimal delay for respectful scraping
   */
  calculateDelay(result, baseDelay = 700) {
    if (!result.allowed && result.retryAfter) {
      // Ensure we never return a negative delay
      const delay = result.retryAfter * 1000; // Convert to ms
      return Math.max(1000, delay); // Minimum 1 second delay
    }
    
    // Adaptive delay based on remaining quota
    const remainingRatio = result.remaining / (result.limit || 100);
    
    if (remainingRatio > 0.8) {
      return baseDelay * 0.5; // Fast when plenty of quota
    } else if (remainingRatio > 0.5) {
      return baseDelay; // Normal delay
    } else if (remainingRatio > 0.2) {
      return baseDelay * 2; // Slow down
    } else {
      return baseDelay * 4; // Very conservative
    }
  }
  
  async close() {
    // Clear cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    // Close Redis connection
    if (this.redisClient) {
      await this.redisClient.quit();
      this.redisClient = null;
    }
    
    // Remove all event listeners
    this.removeAllListeners();
    
    // Clear memory store
    this.memoryStore.clear();
  }
}

module.exports = RateLimiter; 