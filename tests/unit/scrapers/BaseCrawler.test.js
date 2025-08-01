// Simple BaseCrawler test without complex mocking
describe('BaseCrawler Simple Test', () => {
  test('should be able to require BaseCrawler', () => {
    // Mock puppeteer before requiring BaseCrawler
    jest.doMock('puppeteer', () => ({
      launch: jest.fn().mockResolvedValue({
        newPage: jest.fn().mockResolvedValue({
          setUserAgent: jest.fn(),
          setViewport: jest.fn(),
          setExtraHTTPHeaders: jest.fn(),
          setRequestInterception: jest.fn(),
          setDefaultTimeout: jest.fn(),
          setDefaultNavigationTimeout: jest.fn(),
          on: jest.fn(),
          close: jest.fn()
        }),
        close: jest.fn(),
        on: jest.fn()
      })
    }));

    jest.doMock('user-agents', () => {
      return jest.fn(() => ({
        toString: () => 'Mozilla/5.0 (Test User Agent)'
      }));
    });

    // Now require BaseCrawler
    const BaseCrawler = require('../../../src/scrapers/base-crawler');
    
    expect(BaseCrawler).toBeDefined();
    expect(typeof BaseCrawler).toBe('function');
    
    // Test basic instantiation
    const crawler = new BaseCrawler();
    expect(crawler).toBeInstanceOf(BaseCrawler);
    expect(crawler.config).toBeDefined();
    expect(crawler.config.headless).toBe(true);
  });

  test('should initialize with custom config', () => {
    // Mock dependencies first
    jest.doMock('puppeteer', () => ({
      launch: jest.fn()
    }));

    jest.doMock('user-agents', () => {
      return jest.fn(() => ({
        toString: () => 'Test Agent'
      }));
    });

    const BaseCrawler = require('../../../src/scrapers/base-crawler');
    
    const customConfig = {
      headless: false,
      memoryManagement: {
        enabled: false,
        maxMemoryMB: 2048
      }
    };

    const crawler = new BaseCrawler(customConfig);
    
    expect(crawler.config.headless).toBe(false);
    expect(crawler.config.memoryManagement.enabled).toBe(false);
    expect(crawler.config.memoryManagement.maxMemoryMB).toBe(2048);
  });

  test('should have all required methods', () => {
    jest.doMock('puppeteer', () => ({
      launch: jest.fn()
    }));

    jest.doMock('user-agents', () => {
      return jest.fn(() => ({
        toString: () => 'Test Agent'
      }));
    });

    const BaseCrawler = require('../../../src/scrapers/base-crawler');
    const crawler = new BaseCrawler();

    // Check that all important methods exist
    expect(typeof crawler.initialize).toBe('function');
    expect(typeof crawler.close).toBe('function');
    expect(typeof crawler.newPage).toBe('function');
    expect(typeof crawler.navigate).toBe('function');
    expect(typeof crawler.safeClick).toBe('function');
    expect(typeof crawler.humanScroll).toBe('function');
    expect(typeof crawler.takeScreenshot).toBe('function');
    expect(typeof crawler.delay).toBe('function');
    expect(typeof crawler.getMemoryStats).toBe('function');
  });

  test('should track memory statistics', () => {
    jest.doMock('puppeteer', () => ({
      launch: jest.fn()
    }));

    jest.doMock('user-agents', () => {
      return jest.fn(() => ({
        toString: () => 'Test Agent'
      }));
    });

    const BaseCrawler = require('../../../src/scrapers/base-crawler');
    const crawler = new BaseCrawler();

    const stats = crawler.getMemoryStats();
    
    expect(stats).toBeDefined();
    expect(stats.peakMemoryMB).toBeDefined();
    expect(stats.currentMemoryMB).toBeDefined();
    expect(stats.activePagesCount).toBeDefined();
    expect(stats.poolSize).toBeDefined();
    expect(stats.pagesCreated).toBeDefined();
    expect(stats.pagesDestroyed).toBeDefined();
    expect(stats.gcForced).toBeDefined();
  });

  test('should handle proxy configuration', () => {
    jest.doMock('puppeteer', () => ({
      launch: jest.fn()
    }));

    jest.doMock('user-agents', () => {
      return jest.fn(() => ({
        toString: () => 'Test Agent'
      }));
    });

    const BaseCrawler = require('../../../src/scrapers/base-crawler');
    
    const crawlerWithProxy = new BaseCrawler({
      proxyConfig: {
        useProxy: true,
        proxyUrl: 'http://proxy.example.com:8080'
      }
    });

    const proxyArgs = crawlerWithProxy.getProxyLaunchArg();
    expect(proxyArgs).toEqual(['--proxy-server=http://proxy.example.com:8080']);

    const crawlerWithoutProxy = new BaseCrawler();
    const noProxyArgs = crawlerWithoutProxy.getProxyLaunchArg();
    expect(noProxyArgs).toEqual([]);
  });
});