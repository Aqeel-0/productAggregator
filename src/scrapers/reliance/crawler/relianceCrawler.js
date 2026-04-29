const fs = require('fs');
const path = require('path');
const { Cluster } = require('puppeteer-cluster');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { CATEGORY_SELECTORS, PRODUCT_SELECTORS } = require('./reliance-selectors');
const RateLimiter = require('../../../rate-limiter/RateLimiter');
const RelianceRateLimitConfig = require('../../../rate-limiter/configs/reliance-config');
const Logger = require('../../../utils/logger');

puppeteer.use(StealthPlugin());

class RelianceCrawler {
  constructor(config = {}) {
    this.category = config.category || 'mobile';
    this.categoryUrl = config.categoryUrl || 'https://www.reliancedigital.in/collection/mobiles/?page_no=1&is_available=true';

    this.logger = new Logger('RELIANCE');

    const checkpointDir = path.join(__dirname, '..', 'checkpoints');
    const rawDataDir = path.join(__dirname, '..', 'raw_data');
    this.ensureDirectory(checkpointDir);
    this.ensureDirectory(rawDataDir);

    this.checkpointFile = config.checkpointFile || path.join(checkpointDir, 'reliance_mobile_checkpoint.json');
    this.outputFile = config.outputFile || path.join(rawDataDir, 'reliance_mobile_scraped_data.json');

    this.maxProducts = config.maxProducts ?? null;
    this.maxPages = config.maxPages || 50;
    this.maxConcurrent = config.maxConcurrent || 5;
    this.maxRetries = config.maxRetries || 3;
    this.headless = config.headless !== undefined ? config.headless : true;
    this.delayBetweenPages = Math.max(500, config.delayBetweenPages || 2000);
    this.productsPerPage = Math.max(1, Math.min(config.productsPerPage || 24, 100));

    this.rateLimiter = new RateLimiter({
      redis: { enabled: false },
      defaultAlgorithm: RelianceRateLimitConfig.algorithm,
      cleanupInterval: 60000
    });
    this.rateLimiter.registerRules('reliance', RelianceRateLimitConfig);

    this.checkpoint = this.loadCheckpoint();
    this.productLinks = this.checkpoint.productLinks ? [...this.checkpoint.productLinks] : [];
    this.seenUrls = new Set();

    this.productLinks.forEach(url => {
      this.seenUrls.add(this.normalizeRelianceProductUrl(url));
    });

    this.cluster = null;
  }

  ensureDirectory(dir) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      this.logger.info(`Created directory: ${dir}`);
    }
  }

  loadCheckpoint() {
    try {
      if (fs.existsSync(this.checkpointFile)) {
        const data = fs.readFileSync(this.checkpointFile, 'utf8');
        const cp = JSON.parse(data);
        if (!cp.productLinks) cp.productLinks = [];
        if (cp.lastProcessedIndex === undefined) cp.lastProcessedIndex = -1;
        if (!cp.failedProducts) cp.failedProducts = [];
        if (!cp.pagesScraped) cp.pagesScraped = [];
        if (cp.lastPageScraped === undefined) cp.lastPageScraped = 0;
        return cp;
      }
    } catch (error) {
      this.logger.error(`Error loading checkpoint: ${error.message}`);
    }
    return {
      productLinks: [],
      lastProcessedIndex: -1,
      failedProducts: [],
      lastRunTimestamp: null,
      pagesScraped: [],
      lastPageScraped: 0
    };
  }

  saveCheckpoint() {
    try {
      this.checkpoint.lastRunTimestamp = new Date().toISOString();
      fs.writeFileSync(this.checkpointFile, JSON.stringify(this.checkpoint, null, 2));
      this.logger.checkpointSaved();
    } catch (error) {
      this.logger.error(`Error saving checkpoint: ${error.message}`);
    }
  }

  normalizeRelianceProductUrl(href) {
    if (!href) return href;
    const absHref = href.startsWith('http') ? href : `https://www.reliancedigital.in${href}`;
    try {
      const url = new URL(absHref);
      url.searchParams.delete('internal_source');
      url.searchParams.delete('internal');
      for (const key of Array.from(url.searchParams.keys())) {
        if (key.startsWith('internal_')) url.searchParams.delete(key);
      }
      url.search = url.searchParams.toString();
      return url.toString();
    } catch {
      return absHref
        .replace(/\?internal_source=search_collection$/, '')
        .replace(/([?&])internal_source=search_collection(&|$)/, (m, p1, p2) => (p1 === '?' && !p2 ? '' : p2 ? p1 : ''))
        .replace(/\?internal=.*$/, '')
        .replace(/([?&])internal=[^&]*/g, (m, p1) => (p1 === '?' ? '?' : ''))
        .replace(/[?&]$/, '');
    }
  }

  saveData(data) {
    try {
      let existingData = [];
      if (fs.existsSync(this.outputFile)) {
        const fileContent = fs.readFileSync(this.outputFile, 'utf8');
        if (fileContent) {
          const parsed = JSON.parse(fileContent);
          existingData = Array.isArray(parsed) ? parsed : [];
        }
      }
      const newData = Array.isArray(data) ? data : [data];
      const existingUrls = new Set(
        existingData.filter(p => p && p.url).map(p => this.normalizeRelianceProductUrl(p.url))
      );
      const uniqueNew = newData.filter(p => {
        if (!p || !p.url) return true;
        const norm = this.normalizeRelianceProductUrl(p.url);
        if (existingUrls.has(norm)) return false;
        existingUrls.add(norm);
        return true;
      });
      fs.writeFileSync(this.outputFile, JSON.stringify([...existingData, ...uniqueNew], null, 2));
    } catch (error) {
      this.logger.error(`Error saving data: ${error.message}`);
    }
  }

  async initializeCluster() {
    this.logger.info('Initializing puppeteer-cluster...');
    this.cluster = await Cluster.launch({
      concurrency: Cluster.CONCURRENCY_PAGE, // All tasks share one browser, each gets its own tab
      maxConcurrency: this.maxConcurrent,
      puppeteerOptions: {
        headless: this.headless ? 'new' : false,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--window-size=1920,1080',
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins,site-per-process',
          '--memory-pressure-off',
          '--disable-background-timer-throttling',
          '--disable-renderer-backgrounding',
          '--disable-backgrounding-occluded-windows',
          '--disable-features=TranslateUI',
          '--aggressive-cache-discard',
          '--disable-extensions',
          '--disable-plugins',
        ],
      },
      retryLimit: 0,
      timeout: 60000,
      monitor: false,
      puppeteer,
    });
    this.logger.info(`Cluster initialized with ${this.maxConcurrent} concurrent tabs (single browser)`);
  }

  async configurePage(page) {
    try {
      await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      );
      await page.setExtraHTTPHeaders({
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      });

      page.removeAllListeners('request');
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        const resourceType = request.resourceType();
        const url = request.url();
        if (['font', 'media'].includes(resourceType)) {
          request.abort();
        } else if (url.includes('google-analytics') || url.includes('facebook') || url.includes('doubleclick')) {
          request.abort();
        } else {
          request.continue();
        }
      });

      page.setDefaultTimeout(30000);
      page.setDefaultNavigationTimeout(45000);
    } catch (error) {
      this.logger.error(`Error configuring page: ${error.message}`);
    }
  }

  async start() {
    try {
      await this.initializeCluster();

      if (this.checkpoint.productLinks.length === 0) {
        await this.scrapeProductLinks();
        this.saveCheckpoint();
      } else {
        this.productLinks = this.checkpoint.productLinks;
        this.logger.info(`Loaded ${this.productLinks.length} product links from checkpoint`);
      }

      const collected = this.checkpoint.productLinks.length;
      const logTarget = this.maxProducts ? Math.min(this.maxProducts, collected) : collected;
      const processedCount = this.checkpoint.lastProcessedIndex + 1;
      this.logger.startScraper('reliance', logTarget, processedCount);

      await this.scrapeProductDetails();

      if (this.checkpoint.failedProducts.length > 0) {
        this.logger.info(`Retrying ${this.checkpoint.failedProducts.length} failed products`);
        await this.retryFailedProducts();
      }

      this.logger.completeScraper();
    } catch (error) {
      this.logger.error(`Reliance crawler failed: ${error.message}`);
      this.saveCheckpoint();
      throw error;
    } finally {
      await this.shutdown();
    }
  }

  async shutdown() {
    if (this.rateLimiter) {
      await this.rateLimiter.close();
      this.logger.debug('Rate limiter closed');
    }
    if (this.cluster) {
      await this.cluster.close();
      this.logger.info('Cluster closed');
    }
    setTimeout(() => process.exit(0), 2000);
  }

  // Returns the href of the first product link on the page (used to detect page advance)
  async getFirstProductHref(page) {
    try {
      return await page.$eval('a[href*="/product/"]', a => a.getAttribute('href') || a.href || null);
    } catch {
      return null;
    }
  }

  // Waits for the product grid to change (page navigation detection)
  async waitForPageAdvance(page, beforeHref, timeoutMs = 5000) {
    const gridWait = page.waitForFunction(
      (before) => {
        const el = document.querySelector('a[href*="/product/"]');
        const now = el ? (el.getAttribute('href') || el.href || '') : '';
        return before && now && now !== before;
      },
      {},
      beforeHref
    ).catch(() => null);

    const timer = new Promise(res => setTimeout(res, timeoutMs));
    await Promise.race([gridWait, timer]);
  }

  // Link collection runs as a single long-lived cluster task so it stays inside
  // the shared browser (one tab for the full pagination session).
  async scrapeProductLinks() {
    let newLinksAdded = 0;

    this.logger.info(`Starting Reliance: Pages ${(this.checkpoint.lastPageScraped || 0) + 1}-${this.maxPages} | Target: ${this.maxProducts || 'ALL'}`);

    await this.cluster.execute({ url: this.categoryUrl }, async ({ page, data }) => {
      await this.configurePage(page);

      let currentPage = (this.checkpoint.lastPageScraped || 0) + 1;
      const targetPages = this.maxPages;

      const cdpClient = await page.createCDPSession();
      await cdpClient.send('Network.clearBrowserCookies');
      await cdpClient.detach();
      await page.goto(data.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForNetworkIdle({ timeout: 10000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 2000));

      while (currentPage <= targetPages) {
        const rl = await this.rateLimiter.checkLimit('scraper', 'reliance');
        if (!rl.allowed) {
          const wait = this.rateLimiter.calculateDelay(rl, RelianceRateLimitConfig.baseDelay) + (Math.random() * 1500 + 500);
          await new Promise(r => setTimeout(r, wait));
        }

        await page.waitForSelector('a[href*="/product/"]', { timeout: 15000 }).catch(() => {});
        await new Promise(r => setTimeout(r, 1000));

        const currentUrl = page.url();
        if (currentUrl.includes('no-search-results') || currentUrl.includes('error')) {
          this.logger.warn(`Invalid page detected on page ${currentPage}: ${currentUrl}`);
          break;
        }

        const pageLinks = await page.$$eval('a[href*="/product/"]', as =>
          as.map(a => a.getAttribute('href') || a.href || '').filter(Boolean)
        );

        let pageUnique = 0;
        for (const rawHref of pageLinks) {
          const normalized = this.normalizeRelianceProductUrl(rawHref);
          if (normalized && !this.seenUrls.has(normalized)) {
            this.seenUrls.add(normalized);
            this.productLinks.push(normalized);
            pageUnique++;
            newLinksAdded++;
          }
        }

        this.logger.info(`Page ${currentPage}: ${pageLinks.length} links, ${pageUnique} new | Total: ${this.productLinks.length}`);

        if (pageLinks.length === 0) {
          this.logger.info(`No products on page ${currentPage} — stopping`);
          break;
        }

        this.checkpoint.lastPageScraped = currentPage;
        if (!this.checkpoint.pagesScraped.includes(currentPage)) {
          this.checkpoint.pagesScraped.push(currentPage);
        }
        this.checkpoint.productLinks = this.productLinks;
        this.saveCheckpoint();

        if (this.maxProducts && this.productLinks.length >= this.maxProducts) {
          this.logger.info(`Target reached: ${this.productLinks.length}/${this.maxProducts} — stopping`);
          break;
        }

        if (currentPage >= targetPages) break;

        // Navigate to next page via Next button with URL fallback
        let nextHandle = null;
        for (const sel of CATEGORY_SELECTORS.NEXT_PAGE) {
          await page.waitForSelector(sel, { timeout: 1200 }).catch(() => {});
          nextHandle = await page.$(sel);
          if (nextHandle) break;
        }

        if (!nextHandle) {
          this.logger.info(`Next button not found on page ${currentPage} — stopping`);
          break;
        }

        try {
          const beforeHref = await this.getFirstProductHref(page);
          await page.evaluate(el => el && el.scrollIntoView({ block: 'center' }), nextHandle);
          await page.evaluate(() => window.scrollBy(0, 80));
          await nextHandle.click();
          await this.waitForPageAdvance(page, beforeHref, this.delayBetweenPages);

          const pageNoAfter = new URL(page.url()).searchParams.get('page_no');
          const firstHrefAfter = await this.getFirstProductHref(page);
          const advanced =
            (pageNoAfter && Number(pageNoAfter) === currentPage + 1) ||
            (beforeHref && firstHrefAfter && beforeHref !== firstHrefAfter);

          if (!advanced) {
            const u = new URL(this.categoryUrl);
            u.searchParams.set('page_no', String(currentPage + 1));
            this.logger.info(`Fallback navigation to: ${u.toString()}`);
            await page.goto(u.toString(), { waitUntil: 'domcontentloaded', timeout: 45000 });
            await page.waitForNetworkIdle({ timeout: 10000 }).catch(() => {});
            await page.waitForSelector('a[href*="/product/"]', { timeout: 15000 }).catch(() => {});
          }

          currentPage++;
        } catch (err) {
          this.logger.warn(`Next button click failed, trying URL fallback: ${err.message}`);
          try {
            const u = new URL(this.categoryUrl);
            u.searchParams.set('page_no', String(currentPage + 1));
            await page.goto(u.toString(), { waitUntil: 'domcontentloaded', timeout: 45000 });
            await page.waitForNetworkIdle({ timeout: 10000 }).catch(() => {});
            await page.waitForSelector('a[href*="/product/"]', { timeout: 15000 }).catch(() => {});
            currentPage++;
          } catch (fallbackErr) {
            this.logger.warn(`URL fallback failed: ${fallbackErr.message}`);
            break;
          }
        }
      }
    });

    this.logger.info(`Link collection complete: ${this.productLinks.length} total (${newLinksAdded} new)`);
  }

  async scrapeProductDetails() {
    const startIndex = this.checkpoint.lastProcessedIndex + 1;
    const endIndex = this.maxProducts
      ? Math.min(this.productLinks.length, this.maxProducts)
      : this.productLinks.length;

    const results = [];

    for (let i = startIndex; i < endIndex; i += this.maxConcurrent) {
      const batchEnd = Math.min(i + this.maxConcurrent, endIndex);
      const batchPromises = [];

      for (let j = i; j < batchEnd; j++) {
        batchPromises.push(this.processProductWithRetry(this.productLinks[j], j));
      }

      const settled = await Promise.allSettled(batchPromises);

      for (let k = 0; k < settled.length; k++) {
        const index = i + k;
        const res = settled[k];
        if (res.status === 'fulfilled' && res.value) {
          results.push(res.value);
          this.checkpoint.lastProcessedIndex = index;
        } else {
          const errMsg = res.reason?.message || String(res.reason) || 'Unknown error';
          this.checkpoint.failedProducts.push({
            index,
            url: this.productLinks[index],
            error: errMsg,
            ts: Date.now()
          });
        }
      }

      this.saveCheckpoint();

      if (results.length > 0) {
        this.saveData([...results]);
        results.length = 0;
      }
    }
  }

  async processProductWithRetry(url, index) {
    let rl;
    while (true) {
      rl = await this.rateLimiter.checkLimit('scraper', 'reliance');
      if (rl.allowed) break;
      const wait = this.rateLimiter.calculateDelay(rl, RelianceRateLimitConfig.baseDelay);
      this.logger.rateLimit(wait);
      await new Promise(r => setTimeout(r, wait));
    }

    let lastError;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const product = await this._scrapeProductDetail(url);
        this.logger.updateProgress();
        const delayMs = this.rateLimiter.calculateDelay(rl, RelianceRateLimitConfig.baseDelay);
        await new Promise(r => setTimeout(r, delayMs + Math.random() * 2000 + 1000));
        return product;
      } catch (err) {
        lastError = err;
        this.logger.productError(index, err.message);
        if (attempt < this.maxRetries) {
          await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
        }
      }
    }

    throw lastError;
  }

  async retryFailedProducts() {
    const toRetry = [...this.checkpoint.failedProducts];
    this.checkpoint.failedProducts = [];
    const results = [];

    for (let i = 0; i < toRetry.length; i += this.maxConcurrent) {
      const batch = toRetry.slice(i, i + this.maxConcurrent);
      const settled = await Promise.allSettled(
        batch.map(fp => this.processProductWithRetry(fp.url, fp.index))
      );
      settled.forEach((res, k) => {
        if (res.status === 'fulfilled' && res.value) {
          results.push(res.value);
        } else {
          this.checkpoint.failedProducts.push({
            ...batch[k],
            retryAttempts: (batch[k].retryAttempts || 0) + 1
          });
        }
      });
      if (results.length > 0) {
        this.saveData([...results]);
        results.length = 0;
      }
      this.saveCheckpoint();
    }
  }

  async _scrapeProductDetail(url) {
    return await this.cluster.execute({ url }, async ({ page, data }) => {
      await this.configurePage(page);
      await page.goto(data.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await new Promise(r => setTimeout(r, 500 + Math.random() * 500));

      const productData = await this._extractAllProductData(page);
      return { url: data.url, ...productData };
    });
  }

  async _extractAllProductData(page) {
    try {
      return await page.evaluate((SELECTORS) => {
        const getText = (selector) => {
          try {
            const el = document.querySelector(selector);
            return el ? el.textContent.trim() : null;
          } catch { return null; }
        };

        const getAttr = (selector, attr) => {
          try {
            const el = document.querySelector(selector);
            return el ? el.getAttribute(attr) : null;
          } catch { return null; }
        };

        // Title
        let title = null;
        for (const selector of SELECTORS.TITLE) {
          const el = document.querySelector(selector);
          if (el) {
            const text = el.textContent.replace(/\s+/g, ' ').trim();
            if (text && text.length > 5 && text.length < 250) { title = text; break; }
          }
        }

        // Pricing
        const pricing = { price: null, originalPrice: null, discount: null };
        for (const selector of SELECTORS.PRICE) {
          const text = getText(selector);
          if (text) { pricing.price = text; break; }
        }
        for (const selector of SELECTORS.ORIGINAL_PRICE) {
          const text = getText(selector);
          if (text) { pricing.originalPrice = text; break; }
        }

        // Rating
        const rating = { rating: null, ratingCount: null };
        for (const selector of SELECTORS.RATING) {
          const el = document.querySelector(selector);
          if (el) {
            const ratingText = el.textContent || el.getAttribute('aria-label') || '';
            const m = ratingText.match(/(\d+\.?\d*)/);
            if (m) { rating.rating = parseFloat(m[1]); break; }
          }
        }
        for (const selector of SELECTORS.RATING_COUNT) {
          const text = getText(selector);
          if (text) {
            const m = text.match(/[\d,]+/);
            if (m) { rating.ratingCount = parseInt(m[0].replace(/,/g, '')); break; }
          }
        }

        // Images
        let mainImage = null;
        const allImages = [];
        let first = true;
        for (const selector of SELECTORS.ALT_IMAGE) {
          document.querySelectorAll(selector).forEach(el => {
            const src = el.getAttribute('src') || el.getAttribute('data-src');
            if (src) {
              if (first) { mainImage = src; first = false; }
              else allImages.push(src);
            }
          });
          if (mainImage) break;
        }

        // Specifications
        const specifications = {};
        document.querySelectorAll('.specifications-header').forEach(header => {
          const sectionTitle = header.textContent.trim();
          if (!sectionTitle) return;
          const sectionSpecs = {};
          const ul = header.nextElementSibling;
          if (ul && ul.tagName === 'UL') {
            ul.querySelectorAll('.specifications-list').forEach(li => {
              const spans = li.querySelectorAll('span');
              const label = spans[0]?.textContent.trim();
              const value = li.querySelector('.specifications-list--right ul')?.textContent.trim();
              if (label && value) sectionSpecs[label] = value;
            });
          }
          if (Object.keys(sectionSpecs).length > 0) specifications[sectionTitle] = sectionSpecs;
        });

        return {
          title,
          price: pricing,
          rating,
          image: { mainImage, allImages },
          specifications,
          availability: 'In Stock',
          categories: 'Smartphones',
          extractedAt: new Date().toISOString()
        };
      }, PRODUCT_SELECTORS);
    } catch (error) {
      this.logger.error(`Error extracting product data: ${error.message}`);
      return {
        title: null,
        price: { price: null, originalPrice: null, discount: null },
        rating: { rating: null, ratingCount: null },
        image: { mainImage: null, allImages: [] },
        specifications: {},
        availability: 'In Stock',
        categories: 'Smartphones',
        extractedAt: new Date().toISOString(),
        error: error.message
      };
    }
  }
}

if (require.main === module) {
  const crawler = new RelianceCrawler({
    headless: true,
    maxPages: 60,
    maxConcurrent: 1,
    maxRetries: 1,
    maxProducts: 5,
  });

  crawler.start()
    .then(() => process.exit(0))
    .catch(e => {
      console.error('Reliance crawler error:', e.message);
      process.exit(1);
    });
}

module.exports = RelianceCrawler;
