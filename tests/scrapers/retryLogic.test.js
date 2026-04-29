const AmazonCrawler = require('../../src/scrapers/amazon/crawler/amazonElectronicsCrawler');
const FlipkartCrawler = require('../../src/scrapers/flipkart/crawler/flipkartMobileCrawler');
const CromaCrawler = require('../../src/scrapers/croma/crawler/cromaCrawler');
const RelianceCrawler = require('../../src/scrapers/reliance/crawler/relianceCrawler');

const os = require('os');

// Use temp paths so tests never touch real checkpoint/output files
const tmpDir = os.tmpdir();
const baseConfig = {
  maxRetries: 3,
  maxConcurrent: 2,
  headless: true,
  checkpointFile: `${tmpDir}/test_checkpoint_${process.pid}.json`,
  outputFile: `${tmpDir}/test_output_${process.pid}.json`,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function stubRateLimiterAllow(crawler) {
  jest.spyOn(crawler.rateLimiter, 'checkLimit').mockResolvedValue({ allowed: true, remaining: 10 });
  jest.spyOn(crawler.rateLimiter, 'calculateDelay').mockReturnValue(0);
}

function silenceSideEffects(crawler) {
  jest.spyOn(crawler, 'saveData').mockImplementation(() => {});
  jest.spyOn(crawler, 'saveCheckpoint').mockImplementation(() => {});
  if (crawler.logger) {
    jest.spyOn(crawler.logger, 'updateProgress').mockImplementation(() => {});
    jest.spyOn(crawler.logger, 'productError').mockImplementation(() => {});
    jest.spyOn(crawler.logger, 'rateLimit').mockImplementation(() => {});
    jest.spyOn(crawler.logger, 'error').mockImplementation(() => {});
    jest.spyOn(crawler.logger, 'info').mockImplementation(() => {});
    jest.spyOn(crawler.logger, 'debug').mockImplementation(() => {});
  }
}

function makeFailedEntry(index, url, retryAttempts = 0) {
  return { index, url, error: 'timeout', timestamp: new Date().toISOString(), retryAttempts };
}

// ── processProductWithRetry ───────────────────────────────────────────────────

describe('processProductWithRetry — succeeds on retry', () => {
  const crawlers = [
    ['Amazon', () => new AmazonCrawler(baseConfig)],
    ['Croma', () => new CromaCrawler(baseConfig)],
    ['Reliance', () => new RelianceCrawler(baseConfig)],
  ];

  test.each(crawlers)('%s: succeeds on 3rd attempt after 2 failures', async (name, factory) => {
    const crawler = factory();
    stubRateLimiterAllow(crawler);
    silenceSideEffects(crawler);

    let calls = 0;
    jest.spyOn(crawler, '_scrapeProductDetail').mockImplementation(async () => {
      calls++;
      if (calls < 3) throw new Error('timeout');
      return { url: 'https://example.com/p/1', title: 'Product A' };
    });

    const result = await crawler.processProductWithRetry('https://example.com/p/1', 0);

    expect(result.title).toBe('Product A');
    expect(calls).toBe(3);
  });

  test('Flipkart: succeeds on 3rd attempt after 2 failures', async () => {
    const crawler = new FlipkartCrawler(baseConfig);
    stubRateLimiterAllow(crawler);
    silenceSideEffects(crawler);

    let calls = 0;
    jest.spyOn(crawler, '_scrapeProductDetail').mockImplementation(async () => {
      calls++;
      if (calls < 3) throw new Error('timeout');
      return { url: 'https://flipkart.com/p/1', title: 'Flipkart Product' };
    });

    const result = await crawler.processProductWithRetry('https://flipkart.com/p/1', 0, false);

    expect(result.title).toBe('Flipkart Product');
    expect(calls).toBe(3);
  });
});

describe('processProductWithRetry — exhausts all retries', () => {
  const crawlers = [
    ['Amazon', () => new AmazonCrawler(baseConfig)],
    ['Flipkart', () => new FlipkartCrawler(baseConfig)],
    ['Croma', () => new CromaCrawler(baseConfig)],
    ['Reliance', () => new RelianceCrawler(baseConfig)],
  ];

  test.each(crawlers)('%s: throws after maxRetries and calls _scrapeProductDetail exactly maxRetries times', async (name, factory) => {
    const crawler = factory();
    stubRateLimiterAllow(crawler);
    silenceSideEffects(crawler);

    jest.spyOn(crawler, '_scrapeProductDetail').mockRejectedValue(new Error('CAPTCHA'));

    const isFlipkart = name === 'Flipkart';
    const call = isFlipkart
      ? crawler.processProductWithRetry('https://example.com/p/1', 0, false)
      : crawler.processProductWithRetry('https://example.com/p/1', 0);

    await expect(call).rejects.toThrow('CAPTCHA');
    expect(crawler._scrapeProductDetail).toHaveBeenCalledTimes(crawler.maxRetries);
  });
});

describe('processProductWithRetry — rate limit blocks before retry loop', () => {
  const crawlers = [
    ['Amazon', () => new AmazonCrawler(baseConfig)],
    ['Flipkart', () => new FlipkartCrawler(baseConfig)],
    ['Croma', () => new CromaCrawler(baseConfig)],
    ['Reliance', () => new RelianceCrawler(baseConfig)],
  ];

  test.each(crawlers)('%s: waits for rate limit then succeeds without burning a retry', async (name, factory) => {
    const crawler = factory();
    silenceSideEffects(crawler);

    // First checkLimit call: not allowed. Second: allowed.
    let rlCalls = 0;
    jest.spyOn(crawler.rateLimiter, 'checkLimit').mockImplementation(async () => {
      rlCalls++;
      if (rlCalls === 1) return { allowed: false, remaining: 0 };
      return { allowed: true, remaining: 5 };
    });
    jest.spyOn(crawler.rateLimiter, 'calculateDelay').mockReturnValue(0);

    jest.spyOn(crawler, '_scrapeProductDetail').mockResolvedValue({
      url: 'https://example.com/p/1',
      title: 'Product'
    });

    const isFlipkart = name === 'Flipkart';
    const result = isFlipkart
      ? await crawler.processProductWithRetry('https://example.com/p/1', 0, false)
      : await crawler.processProductWithRetry('https://example.com/p/1', 0);

    expect(result.title).toBe('Product');
    // _scrapeProductDetail called exactly once — rate-limit wait did not consume a retry
    expect(crawler._scrapeProductDetail).toHaveBeenCalledTimes(1);
    // checkLimit called twice: once blocked, once allowed
    expect(rlCalls).toBe(2);
  });
});

// ── retryFailedProducts ───────────────────────────────────────────────────────

describe('retryFailedProducts — recovers successes, re-queues permanent failures', () => {
  const crawlers = [
    ['Amazon', () => new AmazonCrawler(baseConfig)],
    ['Flipkart', () => new FlipkartCrawler(baseConfig)],
    ['Croma', () => new CromaCrawler(baseConfig)],
    ['Reliance', () => new RelianceCrawler(baseConfig)],
  ];

  test.each(crawlers)('%s: saves recovered products, re-queues still-failing ones with incremented retryAttempts', async (name, factory) => {
    const crawler = factory();
    stubRateLimiterAllow(crawler);
    silenceSideEffects(crawler);

    crawler.checkpoint.failedProducts = [
      makeFailedEntry(0, 'https://example.com/p/AAA'),
      makeFailedEntry(1, 'https://example.com/p/BBB'),
      makeFailedEntry(2, 'https://example.com/p/CCC'),
    ];

    jest.spyOn(crawler, '_scrapeProductDetail').mockImplementation(async (url) => {
      const u = typeof url === 'string' ? url : url.url || url;
      if (u.includes('BBB')) throw new Error('still blocked');
      return { url: u, title: 'Recovered' };
    });

    const saved = [];
    crawler.saveData.mockImplementation(data => saved.push(...data));

    await crawler.retryFailedProducts();

    expect(saved).toHaveLength(2);
    expect(saved.every(p => p.title === 'Recovered')).toBe(true);
    expect(crawler.checkpoint.failedProducts).toHaveLength(1);
    expect(crawler.checkpoint.failedProducts[0].url).toContain('BBB');
    expect(crawler.checkpoint.failedProducts[0].retryAttempts).toBe(1);
    expect(crawler.saveCheckpoint).toHaveBeenCalled();
  });
});

describe('retryFailedProducts — all products recover', () => {
  const crawlers = [
    ['Amazon', () => new AmazonCrawler(baseConfig)],
    ['Flipkart', () => new FlipkartCrawler(baseConfig)],
    ['Croma', () => new CromaCrawler(baseConfig)],
    ['Reliance', () => new RelianceCrawler(baseConfig)],
  ];

  test.each(crawlers)('%s: failedProducts is empty after all recover', async (name, factory) => {
    const crawler = factory();
    stubRateLimiterAllow(crawler);
    silenceSideEffects(crawler);

    crawler.checkpoint.failedProducts = [
      makeFailedEntry(0, 'https://example.com/p/1'),
      makeFailedEntry(1, 'https://example.com/p/2'),
    ];

    jest.spyOn(crawler, '_scrapeProductDetail').mockResolvedValue({
      url: 'https://example.com/p/1',
      title: 'Product'
    });

    await crawler.retryFailedProducts();

    expect(crawler.checkpoint.failedProducts).toHaveLength(0);
  });
});

describe('retryFailedProducts — all products permanently fail', () => {
  const crawlers = [
    ['Amazon', () => new AmazonCrawler(baseConfig)],
    ['Flipkart', () => new FlipkartCrawler(baseConfig)],
    ['Croma', () => new CromaCrawler(baseConfig)],
    ['Reliance', () => new RelianceCrawler(baseConfig)],
  ];

  test.each(crawlers)('%s: all re-queued with retryAttempts incremented, nothing saved', async (name, factory) => {
    const crawler = factory();
    stubRateLimiterAllow(crawler);
    silenceSideEffects(crawler);

    crawler.checkpoint.failedProducts = [
      makeFailedEntry(0, 'https://example.com/p/1', 1),
      makeFailedEntry(1, 'https://example.com/p/2', 1),
    ];

    jest.spyOn(crawler, '_scrapeProductDetail').mockRejectedValue(new Error('blocked'));

    const saved = [];
    crawler.saveData.mockImplementation(data => saved.push(...data));

    await crawler.retryFailedProducts();

    expect(saved).toHaveLength(0);
    expect(crawler.checkpoint.failedProducts).toHaveLength(2);
    expect(crawler.checkpoint.failedProducts[0].retryAttempts).toBe(2);
    expect(crawler.checkpoint.failedProducts[1].retryAttempts).toBe(2);
  });
});

describe('retryFailedProducts — empty queue is a no-op', () => {
  const crawlers = [
    ['Amazon', () => new AmazonCrawler(baseConfig)],
    ['Flipkart', () => new FlipkartCrawler(baseConfig)],
    ['Croma', () => new CromaCrawler(baseConfig)],
    ['Reliance', () => new RelianceCrawler(baseConfig)],
  ];

  test.each(crawlers)('%s: does not call saveData or saveCheckpoint when queue is empty', async (name, factory) => {
    const crawler = factory();
    stubRateLimiterAllow(crawler);
    silenceSideEffects(crawler);

    crawler.checkpoint.failedProducts = [];

    jest.spyOn(crawler, '_scrapeProductDetail');

    await crawler.retryFailedProducts();

    expect(crawler._scrapeProductDetail).not.toHaveBeenCalled();
    expect(crawler.saveData).not.toHaveBeenCalled();
    expect(crawler.saveCheckpoint).not.toHaveBeenCalled();
  });
});

// ── scrapeProductDetails feeds failedProducts ─────────────────────────────────

describe('scrapeProductDetails — failed products land in checkpoint', () => {
  const crawlers = [
    ['Amazon', () => new AmazonCrawler(baseConfig)],
    ['Croma', () => new CromaCrawler(baseConfig)],
    ['Reliance', () => new RelianceCrawler(baseConfig)],
  ];

  test.each(crawlers)('%s: exhausted products added to checkpoint.failedProducts', async (name, factory) => {
    const crawler = factory();
    stubRateLimiterAllow(crawler);
    silenceSideEffects(crawler);

    crawler.productLinks = [
      'https://example.com/p/1',
      'https://example.com/p/2',
      'https://example.com/p/3',
    ];

    jest.spyOn(crawler, '_scrapeProductDetail').mockImplementation(async (url) => {
      const u = typeof url === 'string' ? url : url.url || url;
      if (u.includes('/p/2')) throw new Error('blocked');
      return { url: u, title: 'OK' };
    });

    await crawler.scrapeProductDetails();

    expect(crawler.checkpoint.failedProducts).toHaveLength(1);
    expect(crawler.checkpoint.failedProducts[0].url).toContain('/p/2');
    expect(crawler.checkpoint.lastProcessedIndex).toBe(2);
  });
});

describe('scrapeProductDetails — Flipkart failed products land in checkpoint', () => {
  test('Flipkart: exhausted products added to checkpoint.failedProducts', async () => {
    const crawler = new FlipkartCrawler(baseConfig);
    stubRateLimiterAllow(crawler);
    silenceSideEffects(crawler);

    crawler.productLinks = [
      'https://flipkart.com/p/1',
      'https://flipkart.com/p/2',
      'https://flipkart.com/p/3',
    ];

    jest.spyOn(crawler, '_scrapeProductDetail').mockImplementation(async (url, isRelated) => {
      const u = typeof url === 'string' ? url : url;
      if (u.includes('/p/2')) throw new Error('blocked');
      return { url: u, title: 'OK' };
    });

    await crawler.scrapeProductDetails();

    expect(crawler.checkpoint.failedProducts).toHaveLength(1);
    expect(crawler.checkpoint.failedProducts[0].url).toContain('/p/2');
    expect(crawler.checkpoint.lastProcessedIndex).toBe(2);
  });
});

// ── Concurrent batching in retryFailedProducts ────────────────────────────────

describe('retryFailedProducts — processes in concurrent batches', () => {
  test('Amazon: 5 failed products with maxConcurrent=2 run in 3 batches', async () => {
    const crawler = new AmazonCrawler({ ...baseConfig, maxConcurrent: 2, maxRetries: 1 });
    stubRateLimiterAllow(crawler);
    silenceSideEffects(crawler);

    const urls = Array.from({ length: 5 }, (_, i) => `https://example.com/p/${i}`);
    crawler.checkpoint.failedProducts = urls.map((url, i) => makeFailedEntry(i, url));

    const order = [];
    jest.spyOn(crawler, '_scrapeProductDetail').mockImplementation(async (url) => {
      const u = typeof url === 'string' ? url : url.url || url;
      order.push(u);
      return { url: u, title: 'Product' };
    });

    await crawler.retryFailedProducts();

    // All 5 products were attempted
    expect(order).toHaveLength(5);
    // saveCheckpoint called once per batch (ceil(5/2) = 3 batches)
    expect(crawler.saveCheckpoint).toHaveBeenCalledTimes(3);
    expect(crawler.checkpoint.failedProducts).toHaveLength(0);
  });
});
