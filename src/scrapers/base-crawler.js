const puppeteer = require('puppeteer-extra')
const UserAgent = require('user-agents');
const fs = require('fs');
const path = require('path');
const os = require('os');
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
const Logger = require('../utils/logger');

// Apply stealth plugin with all evasions enabled
puppeteer.use(StealthPlugin())

class BaseCrawler {
  constructor(config = {}) {
    this.config = {
      headless: config.headless !== undefined ? config.headless : true,
      proxyConfig: config.proxyConfig || {
        useProxy: false,
        proxyUrl: null
      },
      // Memory management configuration
      memoryManagement: {
        enabled: config.memoryManagement?.enabled !== false,
        maxMemoryMB: config.memoryManagement?.maxMemoryMB || 1024, // 1GB default
        maxPages: config.memoryManagement?.maxPages || 5,
        pagePoolSize: config.memoryManagement?.pagePoolSize || 3,
        cleanupInterval: config.memoryManagement?.cleanupInterval || 60000, // 1 minute
        forceGCInterval: config.memoryManagement?.forceGCInterval || 300000, // 5 minutes
        memoryCheckInterval: config.memoryManagement?.memoryCheckInterval || 30000, // 30 seconds
      },
      ...config
    };
    
    this.browser = null;
    this.logger = new Logger(config.category || 'CRAWLER');
    
    // Memory management state
    this.pagePool = [];
    this.activePagesCount = 0;
    this.memoryStats = {
      peakMemoryMB: 0,
      currentMemoryMB: 0,
      lastCleanup: Date.now(),
      pagesCreated: 0,
      pagesDestroyed: 0,
      gcForced: 0
    };
    
    // Memory monitoring intervals
    this.memoryMonitorInterval = null;
    this.cleanupInterval = null;
    this.forceGCInterval = null;
    
    // Track managed intervals to avoid clearing unrelated timers (Bug fix #2)
    this.managedIntervals = new Set();
    
    // Memory management will be initialized after browser launch (Bug fix #3)
    this.memoryManagementInitialized = false;
  }

  initializeMemoryManagement() {
    // Memory monitoring
    this.memoryMonitorInterval = setInterval(() => {
      this.checkMemoryUsage();
    }, this.config.memoryManagement.memoryCheckInterval);
    this.managedIntervals.add(this.memoryMonitorInterval);

    // Regular cleanup
    this.cleanupInterval = setInterval(() => {
      this.performCleanup();
    }, this.config.memoryManagement.cleanupInterval);
    this.managedIntervals.add(this.cleanupInterval);

    // Force garbage collection
    this.forceGCInterval = setInterval(() => {
      this.forceGarbageCollection();
    }, this.config.memoryManagement.forceGCInterval);
    this.managedIntervals.add(this.forceGCInterval);

    this.logger.debug('Memory management initialized');
  }

  async initialize() {
    if (!this.browser) {
      const options = {
        // Use 'new' headless mode for better stealth (Puppeteer 21.4+)
        headless: this.config.headless === true ? 'new' : this.config.headless,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--window-size=1920,1080',
          // Anti-detection flags
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins,site-per-process',
          // Memory optimization flags
          '--memory-pressure-off',
          '--disable-background-timer-throttling',
          '--disable-renderer-backgrounding',
          '--disable-backgrounding-occluded-windows',
          '--disable-features=TranslateUI',
          '--aggressive-cache-discard',
          '--disable-extensions',
          '--disable-plugins',
          // Note: --disable-images and --disable-javascript can break some sites
          // and make automation more detectable. Only use if absolutely needed.
        ],
      };

      if (this.config.proxyConfig && this.config.proxyConfig.useProxy && this.config.proxyConfig.proxyUrl) {
        options.args.push(`--proxy-server=${this.config.proxyConfig.proxyUrl}`);
      }

      this.browser = await puppeteer.launch(options);
      
      // Monitor browser events
      this.browser.on('disconnected', () => {
        this.logger.warn('Browser disconnected');
        this.cleanup();
      });

      this.logger.debug('Browser initialized with memory optimization');
      
      // Initialize memory management AFTER browser launch (Bug fix #3)
      if (this.config.memoryManagement.enabled && !this.memoryManagementInitialized) {
        this.initializeMemoryManagement();
        this.memoryManagementInitialized = true;
        this.logger.debug('Memory management initialized after browser launch');
      }
    }
  }

  async close() {
    try {
      this.logger.debug('Starting comprehensive cleanup...');
      
      // Clean up intervals first (using our tracked intervals, not global cleanup)
      this.cleanupManagedIntervals();
      this.logger.debug('All managed intervals cleared');

      // Close all pages in pool
      await this.closeAllPages();

      // Close browser with timeout to prevent hanging
      if (this.browser) {
        try {
          const closePromise = this.browser.close();
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Browser close timeout')), 10000)
          );
          
          await Promise.race([closePromise, timeoutPromise]);
          this.browser = null;
          this.logger.debug('Browser closed successfully');
        } catch (error) {
          this.logger.warn(`Browser close error: ${error.message}`);
          // Force kill browser process if needed
          if (this.browser && this.browser.process()) {
            this.browser.process().kill('SIGKILL');
          }
          this.browser = null;
        }
      }

      // Final cleanup
      this.pagePool = [];
      this.activePagesCount = 0;

      this.logger.info(`Memory stats - Peak: ${this.memoryStats.peakMemoryMB}MB, Pages created: ${this.memoryStats.pagesCreated}, Pages destroyed: ${this.memoryStats.pagesDestroyed}, GC forced: ${this.memoryStats.gcForced}`);
      this.logger.debug('Comprehensive cleanup completed');
      
    } catch (error) {
      this.logger.error(`Error during cleanup: ${error.message}`);
      // Ensure browser is killed even if cleanup fails
      if (this.browser && this.browser.process()) {
        try {
          this.browser.process().kill('SIGKILL');
        } catch (killError) {
          this.logger.error(`Error killing browser process: ${killError.message}`);
        }
      }
      this.browser = null;
    }
  }

  async newPage() {
    if (!this.browser) {
      await this.initialize();
    }

    // Check memory limits
    await this.checkMemoryLimits();

    // Try to get page from pool first
    let page = await this.getPageFromPool();
    
    if (!page) {
      // Create new page if pool is empty
      page = await this.createNewPage();
    }

    return page;
  }

  async getPageFromPool() {
    if (this.pagePool.length === 0) {
      return null;
    }

    const page = this.pagePool.pop();

    try {
      // Reset page state before marking as active (Bug fix #3)
      await this.resetPageState(page);
      
      // Only increment count after successful reset
      this.activePagesCount++;
      this.logger.debug(`Reused page from pool. Pool size: ${this.pagePool.length}, Active: ${this.activePagesCount}`);
      return page;
    } catch (error) {
      this.logger.warn(`Failed to reuse page: ${error.message}`);
      // Don't increment count since we're closing the page
      await this.safeClosePage(page);
      return null;
    }
  }

  async createNewPage() {
    // Check if we've hit the page limit
    if (this.activePagesCount >= this.config.memoryManagement.maxPages) {
      await this.forceCleanupOldestPages();
    }

    let page;
    try {
      // Create the page
      page = await this.browser.newPage();
      
      // Configure page for memory efficiency
      await this.configurePageForMemoryEfficiency(page);
      
      // Only increment counters after successful creation and configuration (Bug fix #3)
      this.activePagesCount++;
      this.memoryStats.pagesCreated++;

      this.logger.debug(`Created new page. Active pages: ${this.activePagesCount}`);
      return page;
    } catch (error) {
      // Clean up the page if it was created but configuration failed
      if (page) {
        try {
          await page.close();
        } catch (closeError) {
          // Ignore errors during cleanup
          this.logger.debug(`Error closing failed page: ${closeError.message}`);
        }
      }
      // Re-throw the original error
      throw error;
    }
  }

  async configurePageForMemoryEfficiency(page) {
    try {
      // Add extra stealth: override navigator.webdriver
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', {
          get: () => false,
        });
        
        // Override chrome object to look less automated
        window.chrome = {
          runtime: {},
        };
        
        // Override permissions
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) => (
          parameters.name === 'notifications' ?
            Promise.resolve({ state: Notification.permission }) :
            originalQuery(parameters)
        );
      });
      
      // Set realistic user agent
      if (this.config.userAgent) {
        await page.setUserAgent(this.config.userAgent);
      } else {
        const userAgent = new UserAgent();
        await page.setUserAgent(userAgent.toString());
      }
      
      // Set realistic viewport with slight randomization for stealth
      const viewportWidth = this.config.viewport?.width || (1280 + Math.floor(Math.random() * 200));
      const viewportHeight = this.config.viewport?.height || (720 + Math.floor(Math.random() * 100));
      const viewport = {
        width: viewportWidth,
        height: viewportHeight,
        deviceScaleFactor: this.config.viewport?.deviceScaleFactor || 1,
        hasTouch: false,
        isLandscape: false,
        isMobile: false
      };
      await page.setViewport(viewport);
      
      // Set realistic HTTP headers (stealth plugin handles most, but we can add extras)
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'Upgrade-Insecure-Requests': '1'
      });

      // Remove old request handlers to prevent memory leak (Bug fix #1)
      page.removeAllListeners('request');
      
      // Block unnecessary resources to save memory
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        const resourceType = request.resourceType();
        const url = request.url();
        
        // Block images, stylesheets, fonts for memory efficiency
        if (['font', 'media'].includes(resourceType)) {
          request.abort();
        } else if (url.includes('google-analytics') || url.includes('facebook') || url.includes('doubleclick')) {
          request.abort();
        } else {
          request.continue();
        }
      });

      // Set page timeout
      page.setDefaultTimeout(30000);
      page.setDefaultNavigationTimeout(30000);

    } catch (error) {
      this.logger.warn(`Error configuring page: ${error.message}`);
      throw error; // Re-throw to ensure caller knows configuration failed
    }
  }

  async resetPageState(page) {
    try {
      // Clear cookies and storage
      await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      });

      // Clear cache if possible
      const client = await page.target().createCDPSession();
      await client.send('Network.clearBrowserCache');
      await client.send('Runtime.runIfWaitingForDebugger');
      await client.detach();

    } catch (error) {
      this.logger.debug(`Error resetting page state: ${error.message}`);
      // Non-critical error, continue
    }
  }

  async returnPageToPool(page) {
    if (!page || page.isClosed()) {
      this.activePagesCount = Math.max(0, this.activePagesCount - 1);
      return;
    }

    try {
      // Check if pool is full
      if (this.pagePool.length >= this.config.memoryManagement.pagePoolSize) {
        await this.safeClosePage(page);
        return;
      }

      // Reset page and add to pool
      await this.resetPageState(page);
      this.pagePool.push(page);
      this.activePagesCount--;

      this.logger.debug(`Returned page to pool. Pool size: ${this.pagePool.length}, Active: ${this.activePagesCount}`);
    } catch (error) {
      this.logger.warn(`Error returning page to pool: ${error.message}`);
      await this.safeClosePage(page);
    }
  }

  async safeClosePage(page) {
    try {
      if (page && !page.isClosed()) {
        await page.close();
        this.memoryStats.pagesDestroyed++;
      }
      this.activePagesCount = Math.max(0, this.activePagesCount - 1);
    } catch (error) {
      this.logger.debug(`Error closing page: ${error.message}`);
    }
  }

  async closeAllPages() {
    // Close all pages in pool
    for (const page of this.pagePool) {
      await this.safeClosePage(page);
    }
    this.pagePool = [];

    this.logger.debug('All pages closed');
  }

  async checkMemoryUsage() {
    try {
      const memUsage = process.memoryUsage();
      const memoryMB = Math.round(memUsage.heapUsed / 1024 / 1024);
      
      this.memoryStats.currentMemoryMB = memoryMB;
      if (memoryMB > this.memoryStats.peakMemoryMB) {
        this.memoryStats.peakMemoryMB = memoryMB;
      }

      // Log memory stats periodically
      if (Date.now() - this.memoryStats.lastCleanup > 120000) { // Every 2 minutes
        this.logger.debug(`Memory usage: ${memoryMB}MB (Peak: ${this.memoryStats.peakMemoryMB}MB), Active pages: ${this.activePagesCount}, Pool: ${this.pagePool.length}`);
      }

    } catch (error) {
      this.logger.debug(`Error checking memory: ${error.message}`);
    }
  }

  async checkMemoryLimits() {
    const memoryMB = this.memoryStats.currentMemoryMB;
    const maxMemoryMB = this.config.memoryManagement.maxMemoryMB;

    if (memoryMB > maxMemoryMB * 0.8) { // 80% threshold
      this.logger.warn(`Memory usage high: ${memoryMB}MB / ${maxMemoryMB}MB. Performing cleanup.`);
      await this.performCleanup();
      
      if (memoryMB > maxMemoryMB) {
        throw new Error(`Memory limit exceeded: ${memoryMB}MB > ${maxMemoryMB}MB`);
      }
    }
  }

  async performCleanup() {
    try {
      const now = Date.now();
      
      // Close excess pages in pool if any
      while (this.pagePool.length > Math.floor(this.config.memoryManagement.pagePoolSize / 2)) {
        const page = this.pagePool.shift();
        await this.safeClosePage(page);
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
        this.memoryStats.gcForced++;
      }

      this.memoryStats.lastCleanup = now;
      this.logger.debug('Cleanup performed');

    } catch (error) {
      this.logger.warn(`Error during cleanup: ${error.message}`);
    }
  }

  async forceCleanupOldestPages() {
    this.logger.warn(`Page limit reached. Forcing cleanup of oldest pages.`);
    
    // Close half of the pages in pool
    const pagesToClose = Math.ceil(this.pagePool.length / 2);
    for (let i = 0; i < pagesToClose; i++) {
      const page = this.pagePool.shift();
      if (page) {
        await this.safeClosePage(page);
      }
    }
  }

  forceGarbageCollection() {
    try {
      if (global.gc) {
        global.gc();
        this.memoryStats.gcForced++;
        this.logger.debug('Forced garbage collection');
      }
    } catch (error) {
      this.logger.debug(`Error forcing GC: ${error.message}`);
    }
  }

  cleanup() {
    // Emergency cleanup method
    this.cleanupManagedIntervals();
  }

  /**
   * Clean up only intervals we created (Bug fix #2)
   */
  cleanupManagedIntervals() {
    for (const intervalId of this.managedIntervals) {
      clearInterval(intervalId);
    }
    this.managedIntervals.clear();
    
    // Also clear the individual references
    this.memoryMonitorInterval = null;
    this.cleanupInterval = null;
    this.forceGCInterval = null;
  }

  // Simple navigation with memory management
  async navigate(page, url, options = {}) {
    const customTimeout = options.timeout || 30000;
    const waitUntil = options.waitUntil || 'load';
    
    try {
      await page.goto(url, { 
        waitUntil,
        timeout: customTimeout
      });
      await this.delay();
    } catch (error) {
      this.logger.error(`Navigation error: ${error.message}`);
      await this.takeScreenshot(page, 'navigation-error');
      throw error;
    }
  }

  async takeScreenshot(page, name = 'error') {
    const screenshotPath = path.join(os.tmpdir(), `${name}-${Date.now()}.png`);
    try {
      await page.screenshot({ path: screenshotPath, fullPage: false }); // Reduced memory usage
      this.logger.info(`Screenshot saved to ${screenshotPath}`);
    } catch (error) {
      this.logger.error(`Failed to take screenshot: ${error.message}`);
    }
  }

  // Delay between requests to be respectful to the server
  async delay(min = 500, max = 1000) {
    const delayTime = Math.floor(Math.random() * (max - min + 1)) + min;
    this.logger.debug(`Waiting ${delayTime}ms before next action`);
    return new Promise(resolve => setTimeout(resolve, delayTime));
  }

  async safeClick(page, selector, options = {}) {
    try {
      // Wait for the element to be visible
      await page.waitForSelector(selector, { visible: true, timeout: 10000 });
      
      // Get the element's position
      const elementHandle = await page.$(selector);
      const box = await elementHandle.boundingBox();
      
      // Move mouse to element with some randomness
      const x = box.x + (box.width * (0.3 + Math.random() * 0.4));
      const y = box.y + (box.height * (0.3 + Math.random() * 0.4));
      
      // Move mouse and click with delay
      await page.mouse.move(x, y, { steps: 10 });
      await this.delay(300, 800);
      await page.mouse.down();
      await this.delay(50, 150);
      await page.mouse.up();
      
      await this.delay();
    } catch (error) {
      this.logger.error(`Click error on ${selector}: ${error.message}`);
      await this.takeScreenshot(page, 'click-error');
      throw error;
    }
  }

  async humanScroll(page, scrollDistance = 800) {
    await page.evaluate((distance) => {
      const totalScrolls = Math.floor(distance / 100);
      let scrolled = 0;
      
      return new Promise((resolve) => {
        const scroller = setInterval(() => {
          window.scrollBy(0, 100);
          scrolled++;
          
          if (scrolled >= totalScrolls) {
            clearInterval(scroller);
            resolve();
          }
        }, 120);
      });
    }, scrollDistance);
    
    await this.delay(500, 1000);
  }

  getProxyLaunchArg() {
    if (this.config.proxyConfig && this.config.proxyConfig.useProxy && this.config.proxyConfig.proxyUrl) {
      return [`--proxy-server=${this.config.proxyConfig.proxyUrl}`];
    }
    return [];
  }

  // Get memory statistics
  getMemoryStats() {
    return {
      ...this.memoryStats,
      activePagesCount: this.activePagesCount,
      poolSize: this.pagePool.length,
      config: this.config.memoryManagement
    };
  }

  ensureDirectory(dir) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      this.logger.info(`Created directory: ${dir}`);
    }
  }

  loadCheckpoint(checkpointFile) {
    try {
      if (fs.existsSync(checkpointFile)) {
        const data = fs.readFileSync(checkpointFile, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      this.logger.error(`Error loading checkpoint: ${error.message}`);
    }
    return {
      productLinks: [],
      relatedLinks: [],
      lastProcessedIndex: -1,
      lastRelatedIndex: -1,
      failedProducts: [],
      lastRunTimestamp: null,
      pagesScraped: [],
      lastPageScraped: 0
    };
  }

  saveCheckpoint(checkpoint, checkpointFile) {
    try {
      checkpoint.lastRunTimestamp = new Date().toISOString();
      fs.writeFileSync(checkpointFile, JSON.stringify(checkpoint, null, 2));
      this.logger.checkpointSaved();
    } catch (error) {
      this.logger.error(`Error saving checkpoint: ${error.message}`);
    }
  }

  saveData(data, outputFile, normalizeUrlFn = null) {
    try {
      let existingData = [];
      if (fs.existsSync(outputFile)) {
        const fileContent = fs.readFileSync(outputFile, 'utf8');
        if (fileContent) {
          const parsed = JSON.parse(fileContent);
          existingData = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.products) ? parsed.products : []);
        }
      }
      
      const newData = Array.isArray(data) ? data : [data];
      
      // Create a normalized URL-based deduplication map
      const existingUrls = new Set();
      existingData.forEach(product => {
        if (product.url) {
          const normalizedUrl = normalizeUrlFn ? normalizeUrlFn(product.url) : product.url;
          existingUrls.add(normalizedUrl);
        }
      });
      
      // Filter out products with normalized URLs that already exist
      const uniqueNewData = newData.filter(product => {
        if (!product.url) return true; // Keep products without URLs
        const normalizedUrl = normalizeUrlFn ? normalizeUrlFn(product.url) : product.url;
        if (existingUrls.has(normalizedUrl)) {
          this.logger.debug(`🔄 Skipping duplicate URL: ${normalizedUrl.substring(0, 50)}...`);
          return false;
        }
        existingUrls.add(normalizedUrl);
        return true;
      });
      
      const combinedData = [...existingData, ...uniqueNewData];
      
      fs.writeFileSync(outputFile, JSON.stringify(combinedData, null, 2));
    } catch (error) {
      this.logger.error(`Error saving data: ${error.message}`);
    }
  }

  getCurrentDataCount(outputFile) {
    try {
      if (fs.existsSync(outputFile)) {
        const fileContent = fs.readFileSync(outputFile, 'utf8');
        if (fileContent) {
          const parsed = JSON.parse(fileContent);
          if (Array.isArray(parsed)) return parsed.length;
          if (parsed && Array.isArray(parsed.products)) return parsed.products.length;
        }
      }
    } catch (error) {
      this.logger.error(`Error reading current data count: ${error.message}`);
    }
    return 0;
  }

  addUniqueUrl(url, seenUrls, productLinks, normalizeUrlFn) {
    const normalized = normalizeUrlFn(url);
    if (!seenUrls.has(normalized)) {
      seenUrls.add(normalized);
      productLinks.push(normalized);
      return true; // Added
    }
    return false; // Duplicate
  }

  async gracefulShutdown(callback = null) {
    try {
      this.logger.info('Starting graceful shutdown...');
      
      // Close rate limiter if present
      if (this.rateLimiter && typeof this.rateLimiter.close === 'function') {
        await this.rateLimiter.close();
        this.logger.debug('Rate limiter closed');
      }
      
      // Close the browser and cleanup memory management
      await this.close();
      
      // Clear all intervals and timeouts
      this.cleanupIntervals();
      
      // Final garbage collection
      if (global.gc) {
        global.gc();
        this.logger.debug('Final garbage collection performed');
      }
      
      this.logger.info('Graceful shutdown completed');
      
      // Execute callback if provided
      if (callback && typeof callback === 'function') {
        callback();
      }
      
    } catch (error) {
      this.logger.error(`Error during graceful shutdown: ${error.message}`);
      if (callback && typeof callback === 'function') {
        callback(error);
      }
    }
  }

  cleanupIntervals() {
    this.cleanupManagedIntervals();
    this.logger.debug('All managed intervals cleared');
  }
}

module.exports = BaseCrawler;