const puppeteer = require('puppeteer');
const UserAgent = require('user-agents');
const fs = require('fs');
const path = require('path');
const os = require('os');

class BaseCrawler {
  constructor(config = {}) {
    this.config = {
      headless: config.headless !== undefined ? config.headless : true,
      proxyConfig: config.proxyConfig || {
        useProxy: false,
        proxyUrl: null
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
        ],
      };

      if (this.config.proxyConfig && this.config.proxyConfig.useProxy && this.config.proxyConfig.proxyUrl) {
        options.args.push(`--proxy-server=${this.config.proxyConfig.proxyUrl}`);
      }

      this.browser = await puppeteer.launch(options);
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  async newPage() {
    if (!this.browser) {
      await this.initialize();
    }

    const page = await this.browser.newPage();
    
    // Set user agent (use config if provided, otherwise random)
    if (this.config.userAgent) {
      await page.setUserAgent(this.config.userAgent);
    } else {
      const userAgent = new UserAgent();
      await page.setUserAgent(userAgent.toString());
    }
    
    // Set viewport (use config if provided, otherwise default)
    const viewport = {
      width: this.config.viewport?.width || 1920,
      height: this.config.viewport?.height || 1080,
      deviceScaleFactor: this.config.viewport?.deviceScaleFactor || 1,
    };
    await page.setViewport(viewport);
    
    // Set extra HTTP headers
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
    });
    
    return page;
  }

  async navigate(page, url) {
    try {
      await page.goto(url, { 
        waitUntil: 'domcontentloaded',
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
      await page.screenshot({ path: screenshotPath, fullPage: true });
      this.logger.info(`Screenshot saved to ${screenshotPath}`);
    } catch (error) {
      this.logger.error(`Failed to take screenshot: ${error.message}`);
    }
  }

  // Delay between requests to be respectful to the server
  async delay(min = 500, max = 1000) { // Reduced from default 2000-5000 range
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
}

module.exports = BaseCrawler;