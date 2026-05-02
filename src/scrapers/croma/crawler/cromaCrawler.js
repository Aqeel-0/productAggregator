const fs = require('fs');
const path = require('path');
const { Cluster } = require('puppeteer-cluster');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { CATEGORY_SELECTORS, PRODUCT_SELECTORS, ERROR_INDICATORS } = require('./croma-selectors');
const RateLimiter = require('../../../rate-limiter/RateLimiter');
const CromaRateLimitConfig = require('../../../rate-limiter/configs/croma-config');
const Logger = require('../../../utils/logger');
const { createMemoryTracker, setupSignalHandlers } = require('../../crawler-utils');
const ScrapingHealthMonitor = require('../../scraping-health-monitor');

puppeteer.use(StealthPlugin());

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

class CromaCrawler {
  constructor(config = {}) {
    this.category = config.category || 'mobile';
    this.categoryUrl = config.categoryUrl || 'https://www.croma.com/phones-wearables/c/1?q=%3Arelevance%3Alower_categories%3A95%3Alower_categories%3A97';

    this.logger = new Logger(`CROMA-${this.category.toUpperCase()}`);

    const checkpointDir = path.join(__dirname, '..', 'checkpoints');
    const rawDataDir = path.join(__dirname, '..', 'raw_data');
    this.ensureDirectory(checkpointDir);
    this.ensureDirectory(rawDataDir);

    this.checkpointFile = config.checkpointFile || path.join(checkpointDir, `croma_${this.category}_checkpoint.json`);
    this.outputFile = config.outputFile || path.join(rawDataDir, `croma_${this.category}_scraped_data.json`);

    this.maxProducts = 200;
    this.maxConcurrent = 3;
    this.maxRetries = 3;
    this.headless = true;
    this.delayBetweenPages = 1500;

    this.rateLimiter = new RateLimiter({
      redis: { enabled: false },
      defaultAlgorithm: CromaRateLimitConfig.algorithm,
      cleanupInterval: 60000
    });
    this.rateLimiter.registerRules('croma', CromaRateLimitConfig);

    this.checkpoint = this.loadCheckpoint();
    this.productLinks = [...this.checkpoint.productLinks];
    this.seenUrls = new Set();
    this.productLinks.forEach(u => this.seenUrls.add(this.normalizeUrl(u)));

    this.cluster = null;
    this.memoryTracker = createMemoryTracker('croma');
    this.healthMonitor = new ScrapingHealthMonitor({ platform: 'croma', logger: this.logger });
  }

  ensureDirectory(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  loadCheckpoint() {
    try {
      if (fs.existsSync(this.checkpointFile)) {
        const cp = JSON.parse(fs.readFileSync(this.checkpointFile, 'utf8'));
        return {
          productLinks: cp.productLinks || [],
          lastProcessedIndex: cp.lastProcessedIndex ?? -1,
          failedProducts: cp.failedProducts || [],
          lastRunTimestamp: cp.lastRunTimestamp || null,
          viewMoreClicks: cp.viewMoreClicks ?? 0
        };
      }
    } catch (e) {
      this.logger.error(`Error loading checkpoint: ${e.message}`);
    }
    return { productLinks: [], lastProcessedIndex: -1, failedProducts: [], lastRunTimestamp: null, viewMoreClicks: 0 };
  }

  saveCheckpoint() {
    try {
      this.checkpoint.lastRunTimestamp = new Date().toISOString();
      fs.writeFileSync(this.checkpointFile, JSON.stringify(this.checkpoint, null, 2));
      this.logger.checkpointSaved();
    } catch (e) {
      this.logger.error(`Error saving checkpoint: ${e.message}`);
    }
  }

  normalizeUrl(url) {
    if (!url) return url;
    try {
      const full = url.startsWith('http') ? url : `https://www.croma.com${url}`;
      const u = new URL(full);
      u.hash = '';
      u.search = '';
      u.hostname = u.hostname.toLowerCase();
      if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1);
      return u.toString();
    } catch {
      return url;
    }
  }

  saveData(products) {
    try {
      let existing = [];
      if (fs.existsSync(this.outputFile)) {
        const content = fs.readFileSync(this.outputFile, 'utf8');
        if (content) existing = JSON.parse(content);
      }
      const seen = new Set(existing.filter(p => p?.url).map(p => this.normalizeUrl(p.url)));
      const fresh = products.filter(p => {
        if (!p?.url) return true;
        const n = this.normalizeUrl(p.url);
        if (seen.has(n)) return false;
        seen.add(n);
        return true;
      });
      fs.writeFileSync(this.outputFile, JSON.stringify([...existing, ...fresh], null, 2));
    } catch (e) {
      this.logger.error(`Error saving data: ${e.message}`);
    }
  }

  async initializeCluster() {
    this.logger.info('Initializing puppeteer-cluster...');
    this.cluster = await Cluster.launch({
      concurrency: Cluster.CONCURRENCY_PAGE,
      maxConcurrency: this.maxConcurrent,
      puppeteerOptions: {
        headless: this.headless ? 'new' : false,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--window-size=1366,768',
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins,site-per-process',
          '--disable-extensions',
          '--disable-plugins'
        ]
      },
      retryLimit: 0,
      timeout: 120000,
      monitor: false,
      puppeteer
    });
    this.logger.info(`Cluster initialized with ${this.maxConcurrent} concurrent tabs`);
  }

  async configurePage(page) {
    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent(USER_AGENT);
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const rt = req.resourceType();
      const url = req.url();
      if (['font', 'media', 'image'].includes(rt)) req.abort();
      else if (url.includes('google-analytics') || url.includes('facebook') || url.includes('doubleclick')) req.abort();
      else req.continue();
    });
    page.setDefaultTimeout(45000);
    page.setDefaultNavigationTimeout(45000);
  }

  async shutdown() {
    this.memoryTracker.stop();
    if (this.rateLimiter) await this.rateLimiter.close();
    if (this.cluster) {
      await this.cluster.close();
      this.logger.info('Cluster closed');
    }
  }

  async start() {
    this.memoryTracker.start();
    try {
      await this.initializeCluster();

      if (this.productLinks.length === 0) {
        await this.collectProductLinks();
        this.saveCheckpoint();
      } else {
        this.logger.info(`Resuming: ${this.productLinks.length} products from checkpoint`);
      }

      const total = this.maxProducts ? Math.min(this.maxProducts, this.productLinks.length) : this.productLinks.length;
      const processed = this.checkpoint.lastProcessedIndex + 1;
      this.logger.startScraper('croma', total, processed);

      await this.scrapeProductDetails();

      if (this.checkpoint.failedProducts.length > 0) {
        this.logger.info(`Retrying ${this.checkpoint.failedProducts.length} failed products`);
        await this.retryFailedProducts();
      }

      this.logger.completeScraper();
    } catch (e) {
      this.logger.error(`Croma crawler failed: ${e.message}`);
      this.saveCheckpoint();
      throw e;
    } finally {
      await this.shutdown();
    }
  }

  async collectProductLinks() {
    const target = this.maxProducts || 100;
    this.logger.info(`Collecting links (target: ${target})`);

    await this.cluster.execute({ url: this.categoryUrl }, async ({ page, data }) => {
      await this.configurePage(page);
      await page.goto(data.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await new Promise(r => setTimeout(r, 2000));
      await this.checkForErrors(page);
      await page.waitForSelector('body', { timeout: 15000 });

      let clicks = 0;
      const maxClicks = 50;

      const extractLinks = async () => {
        const links = await page.evaluate((selectors) => {
          const out = [];
          for (const selector of selectors.PRODUCT_LINK) {
            const els = document.querySelectorAll(selector);
            els.forEach(el => {
              const href = el.href || el.getAttribute('href');
              if (href) out.push(href.startsWith('http') ? href : `https://www.croma.com${href}`);
            });
            if (out.length > 0) break;
          }
          return out;
        }, CATEGORY_SELECTORS);

        let added = 0;
        for (const link of links) {
          const n = this.normalizeUrl(link);
          if (!this.seenUrls.has(n)) {
            this.seenUrls.add(n);
            this.productLinks.push(n);
            added++;
          }
        }
        return added;
      };

      await extractLinks();
      this.logger.info(`Initial extraction: ${this.productLinks.length} unique links`);

      while (this.productLinks.length < target && clicks < maxClicks) {
        let btn = null;
        for (const selector of CATEGORY_SELECTORS.VIEW_MORE_BUTTON) {
          try {
            await page.waitForSelector(selector, { timeout: 3000 }).catch(() => {});
            btn = await page.$(selector);
            if (btn) break;
          } catch { continue; }
        }

        if (!btn) {
          this.logger.info(`No "View More" button after ${clicks} clicks`);
          break;
        }

        const clickable = await page.evaluate(b => b && !b.disabled && b.offsetParent !== null, btn);
        if (!clickable) {
          this.logger.info(`View More not clickable after ${clicks} clicks`);
          break;
        }

        try {
          await page.evaluate(b => b.scrollIntoView({ behavior: 'smooth', block: 'center' }), btn);
          await new Promise(r => setTimeout(r, 300));
          await btn.click();
          clicks++;
          await new Promise(r => setTimeout(r, 1500));

          const added = await extractLinks();
          this.logger.info(`Click ${clicks}: +${added} new | Total: ${this.productLinks.length}/${target}`);

          this.checkpoint.productLinks = this.productLinks;
          this.checkpoint.viewMoreClicks = clicks;
          this.saveCheckpoint();
        } catch (e) {
          this.logger.error(`View More click failed: ${e.message}`);
          break;
        }
      }

      this.checkpoint.productLinks = this.productLinks;
      this.checkpoint.viewMoreClicks = clicks;
    });

    this.logger.info(`Link collection complete: ${this.productLinks.length} products`);
  }

  async scrapeProductDetails() {
    const start = this.checkpoint.lastProcessedIndex + 1;
    const end = this.maxProducts ? Math.min(this.productLinks.length, this.maxProducts) : this.productLinks.length;
    if (start >= end) return;

    this.logger.info(`Processing products ${start + 1}-${end} of ${this.productLinks.length} (concurrent=${this.maxConcurrent})`);

    const buffer = [];

    for (let i = start; i < end; i += this.maxConcurrent) {
      const batchEnd = Math.min(i + this.maxConcurrent, end);
      const batch = [];

      for (let j = i; j < batchEnd; j++) {
        batch.push(
          this.scrapeProductWithRetry(this.productLinks[j], j)
            .then(p => ({ ok: true, index: j, product: p }))
            .catch(err => ({ ok: false, index: j, error: err?.message || String(err) }))
        );
      }

      const results = await Promise.all(batch);

      for (const r of results) {
        if (r.ok) {
          buffer.push(r.product);
          this.checkpoint.lastProcessedIndex = Math.max(this.checkpoint.lastProcessedIndex, r.index);
          if (this.healthMonitor.evaluate(r.product)) {
            this.saveCheckpoint();
            const err = new Error(`Bot detection triggered — ${this.healthMonitor.consecutiveNulls} consecutive null products`);
            err.name = 'BotDetectedError';
            throw err;
          }
        } else {
          this.logger.productError(r.index, r.error);
          this.checkpoint.failedProducts.push({
            index: r.index,
            url: this.productLinks[r.index],
            error: r.error,
            timestamp: new Date().toISOString()
          });
          this.healthMonitor.evaluate(null);
        }
      }

      if (buffer.length >= 5 || batchEnd >= end) {
        if (buffer.length > 0) this.saveData(buffer.splice(0));
      }
      this.saveCheckpoint();

      if (batchEnd < end) {
        await new Promise(r => setTimeout(r, this.delayBetweenPages));
      }
    }
  }

  async scrapeProductWithRetry(url, index) {
    let rl;
    while (true) {
      rl = await this.rateLimiter.checkLimit('scraper', 'croma');
      if (rl.allowed) break;
      const d = this.rateLimiter.calculateDelay(rl);
      this.logger.rateLimit(d);
      await new Promise(r => setTimeout(r, d));
    }

    let lastError;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const product = await this.scrapeProductDetail(url);
        this.logger.updateProgress();
        const d = this.rateLimiter.calculateDelay(rl, CromaRateLimitConfig.baseDelay);
        await new Promise(r => setTimeout(r, d));
        return product;
      } catch (e) {
        lastError = e;
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

    const tasks = toRetry.map(fp =>
      this.scrapeProductWithRetry(fp.url, fp.index)
        .then(p => ({ ok: true, product: p }))
        .catch(e => ({ ok: false, original: fp, error: e?.message || String(e) }))
    );

    const buffer = [];
    for (let i = 0; i < tasks.length; i += this.maxConcurrent) {
      const batch = tasks.slice(i, i + this.maxConcurrent);
      const results = await Promise.all(batch);
      for (const r of results) {
        if (r.ok) {
          buffer.push(r.product);
          if (this.healthMonitor.evaluate(r.product)) {
            this.saveCheckpoint();
            const err = new Error(`Bot detection triggered during retries — ${this.healthMonitor.consecutiveNulls} consecutive null products`);
            err.name = 'BotDetectedError';
            throw err;
          }
        } else {
          this.checkpoint.failedProducts.push({ ...r.original, retryAttempts: (r.original.retryAttempts || 0) + 1 });
          this.healthMonitor.evaluate(null);
        }
      }
      if (buffer.length > 0) this.saveData(buffer.splice(0));
      this.saveCheckpoint();
    }
  }

  async scrapeProductDetail(url) {
    return await this.cluster.execute({ url }, async ({ page, data }) => {
      await this.configurePage(page);
      await page.goto(data.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await new Promise(r => setTimeout(r, 500 + Math.random() * 300));

      await this.checkForErrors(page);

      try {
        await page.waitForSelector('span#pdp-product-price', { timeout: 6000 });
      } catch {
        await page.evaluate(() => window.scrollBy(0, 300));
        await new Promise(r => setTimeout(r, 800));
        await page.waitForSelector('span#pdp-product-price', { timeout: 3000 });
      }

      const productData = await this.extractAllProductData(page);
      return { url: data.url, ...productData };
    });
  }

  async checkForErrors(page) {
    const err = await page.evaluate((errs) => {
      for (const sel of (errs.CAPTCHA || [])) if (document.querySelector(sel)) return { type: 'CAPTCHA' };
      for (const sel of (errs.ACCESS_DENIED || [])) if (document.querySelector(sel)) return { type: 'ACCESS_DENIED' };
      for (const sel of (errs.NOT_FOUND || [])) if (document.querySelector(sel)) return { type: 'NOT_FOUND' };
      return null;
    }, ERROR_INDICATORS);
    if (err) throw new Error(`Page error detected: ${err.type}`);
  }

  async extractAllProductData(page) {
    return await page.evaluate(() => {
      const clean = t => (t || '').replace(/\s+/g, ' ').trim();

      const title = clean(document.querySelector('h1.pd-title')?.textContent) || null;

      const extractPrice = (el) => {
        if (!el) return null;
        const text = clean(el.textContent);
        if (text.includes('₹')) {
          const m = text.match(/₹\s*([\d,]+(?:\.\d{2})?)/);
          if (m) return '₹' + m[1];
        }
        return text || null;
      };

      const pricing = { current: null, original: null, discount: null };
      pricing.current = extractPrice(document.querySelector('span#pdp-product-price'));
      pricing.original = extractPrice(document.querySelector('span#old-price'));

      if (pricing.current && pricing.original) {
        const cur = parseFloat(pricing.current.replace(/[^\d.]/g, ''));
        const orig = parseFloat(pricing.original.replace(/[^\d.]/g, ''));
        if (!isNaN(cur) && !isNaN(orig) && orig > 0 && cur < orig) {
          pricing.discount = Math.round(((orig - cur) / orig) * 100) + '%';
        }
      }

      let star = null, ratingCount = null, reviews = null;
      const reviewLink = document.querySelector('a.pr-review.review-text');
      const reviewText = clean(reviewLink?.textContent);
      if (reviewText && /^Be\s+the\s+First\s+One\s+to\s+Review$/i.test(reviewText)) {
        star = 'Not Available';
        ratingCount = 'Not Available';
        reviews = 'Not Available';
      } else if (reviewText) {
        const starText = clean(document.querySelector('.cp-rating span span')?.textContent);
        if (starText) star = starText;
        const rm = reviewText.match(/([\d,]+)\s+Ratings?/i);
        if (rm) ratingCount = rm[1].replace(/,/g, '');
        const revm = reviewText.match(/([\d,]+)\s+Reviews?/i);
        if (revm) reviews = revm[1].replace(/,/g, '');
      }
      const rating = { star, rating: ratingCount, reviews };

      const imageUrls = [];
      document.querySelectorAll('.gallery-thumbs img, .gallery-top img').forEach(img => {
        const url = img.getAttribute('data-src') || img.getAttribute('src');
        if (url) imageUrls.push(url);
      });
      const image = { main: imageUrls[0] || null, all: imageUrls.slice(1) };

      const specifications = {};
      document.querySelectorAll('#specification_container .cp-specification-info').forEach(section => {
        const sectionTitle = clean(section.querySelector('h3.title')?.textContent);
        if (!sectionTitle) return;
        const specs = {};
        section.querySelectorAll('ul.cp-specification-spec-info').forEach(group => {
          group.querySelectorAll('div').forEach(div => {
            const name = clean(div.querySelector('.cp-specification-spec-title h4')?.textContent);
            const value = clean(div.querySelector('.cp-specification-spec-details')?.textContent);
            if (name && value) specs[name] = value;
          });
        });
        if (Object.keys(specs).length) specifications[sectionTitle] = specs;
      });

      return {
        title,
        price: pricing,
        rating,
        image: image.main,
        allImages: image.all,
        specifications,
        categories: 'Smartphones',
        extractedAt: new Date().toISOString()
      };
    });
  }
}

if (require.main === module) {
  const crawler = new CromaCrawler({
    headless: true,
    maxProducts: 3,
    maxConcurrent: 3,
    maxRetries: 2
  });

  const cleanupSignals = setupSignalHandlers(() => crawler.shutdown(), crawler.logger);
  crawler.start()
    .then(() => { cleanupSignals(); process.exit(0); })
    .catch(err => { crawler.logger.error(`Crawler failed: ${err.message}`); cleanupSignals(); process.exit(1); });
}

module.exports = CromaCrawler;
