const puppeteer = require('puppeteer-extra')
const UserAgent = require('user-agents');
const fs = require('fs');
const path = require('path');
const os = require('os');
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
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
    this.logger = {
      info: console.log,
      error: console.error,
      warn: console.warn,
      debug: console.log
    };
    
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
    
    // Initialize memory management
    if (this.config.memoryManagement.enabled) {
      this.initializeMemoryManagement();
    }
  }

  initializeMemoryManagement() {
    // Memory monitoring
    this.memoryMonitorInterval = setInterval(() => {
      this.checkMemoryUsage();
    }, this.config.memoryManagement.memoryCheckInterval);

    // Regular cleanup
    this.cleanupInterval = setInterval(() => {
      this.performCleanup();
    }, this.config.memoryManagement.cleanupInterval);

    // Force garbage collection
    this.forceGCInterval = setInterval(() => {
      this.forceGarbageCollection();
    }, this.config.memoryManagement.forceGCInterval);

    this.logger.debug('Memory management initialized');
  }

  async initialize() {
    if (!this.browser) {
      const options = {
        headless: this.config.headless,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--window-size=1920,1080',
          // Memory optimization flags
          '--memory-pressure-off',
          '--max-old-space-size=2048',
          '--disable-background-timer-throttling',
          '--disable-renderer-backgrounding',
          '--disable-backgrounding-occluded-windows',
          '--disable-features=TranslateUI',
          '--aggressive-cache-discard',
          '--disable-extensions',
          '--disable-plugins',
          '--disable-images', // Disable image loading to save memory
          '--disable-javascript', // Can be enabled per page if needed
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
    }
  }

  async close() {
    try {
      this.logger.debug('Starting comprehensive cleanup...');
      
      // Clean up intervals first
      if (this.memoryMonitorInterval) {
        clearInterval(this.memoryMonitorInterval);
        this.memoryMonitorInterval = null;
        this.logger.debug('Memory monitor interval cleared');
      }
      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval);
        this.cleanupInterval = null;
        this.logger.debug('Cleanup interval cleared');
      }
      if (this.forceGCInterval) {
        clearInterval(this.forceGCInterval);
        this.forceGCInterval = null;
        this.logger.debug('Force GC interval cleared');
      }

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
    this.activePagesCount++;

    try {
      // Reset page state
      await this.resetPageState(page);
      this.logger.debug(`Reused page from pool. Pool size: ${this.pagePool.length}, Active: ${this.activePagesCount}`);
      return page;
    } catch (error) {
      this.logger.warn(`Failed to reuse page: ${error.message}`);
      await this.safeClosePage(page);
      return null;
    }
  }

  async createNewPage() {
    // Check if we've hit the page limit
    if (this.activePagesCount >= this.config.memoryManagement.maxPages) {
      await this.forceCleanupOldestPages();
    }

    const page = await this.browser.newPage();
    this.activePagesCount++;
    this.memoryStats.pagesCreated++;

    // Configure page for memory efficiency
    await this.configurePageForMemoryEfficiency(page);

    this.logger.debug(`Created new page. Active pages: ${this.activePagesCount}`);
    return page;
  }

  async configurePageForMemoryEfficiency(page) {
    try {
      // Set user agent
      if (this.config.userAgent) {
        await page.setUserAgent(this.config.userAgent);
      } else {
        const userAgent = new UserAgent();
        await page.setUserAgent(userAgent.toString());
      }
      
      // Set viewport
      const viewport = {
        width: this.config.viewport?.width || 1366,
        height: this.config.viewport?.height || 768,
        deviceScaleFactor: this.config.viewport?.deviceScaleFactor || 1,
      };
      await page.setViewport(viewport);
      
      // Set extra HTTP headers
      // await page.setExtraHTTPHeaders({
      //   'Accept-Language': 'en-US,en;q=0.9',
      //   'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      //   'Accept-Encoding': 'gzip, deflate, br',
      //   'Connection': 'keep-alive',
      //   'Cache-Control': 'no-cache'
      // });

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
    if (this.memoryMonitorInterval) {
      clearInterval(this.memoryMonitorInterval);
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    if (this.forceGCInterval) {
      clearInterval(this.forceGCInterval);
    }
  }

  // Enhanced navigation with memory management
  async navigate(page, url) {
    try {
      await page.goto(url, { 
        waitUntil: 'load',
        timeout: 30000
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
}

module.exports = BaseCrawler;