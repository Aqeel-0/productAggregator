const fs = require('fs');
const path = require('path');
const { Cluster } = require('puppeteer-cluster');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const RateLimiter = require('../../../rate-limiter/RateLimiter');
const FlipkartRateLimitConfig = require('../../../rate-limiter/configs/flipkart-config');
const Logger = require('../../../utils/logger');

puppeteer.use(StealthPlugin());

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const SPEC_CONTAINER_CLASS = '._1psv1zeb9._1psv1ze0._1psv1ze4i._1psv1ze29';

class FlipkartCrawler {
  constructor(config = {}) {
    this.category = config.category || 'mobile';
    this.categoryUrl = config.categoryUrl || 'https://www.flipkart.com/mobiles/pr?sid=tyy%2C4io&otracker=categorytree&p%5B%5D=facets.availability%255B%255D%3DExclude%2BOut%2Bof%2BStock&p%5B%5D=facets.type%255B%255D%3DSmartphones&page=1';

    this.logger = new Logger(this.category.toUpperCase());

    const checkpointDir = path.join(__dirname, '..', 'checkpoints');
    const rawDataDir = path.join(__dirname, '..', 'raw_data');
    this.ensureDirectory(checkpointDir);
    this.ensureDirectory(rawDataDir);

    this.checkpointFile = config.checkpointFile || path.join(checkpointDir, `flipkart_${this.category}_checkpoint.json`);
    this.outputFile = config.outputFile || path.join(rawDataDir, `flipkart_${this.category}_scraped_data.json`);

    this.maxProducts = config.maxProducts ?? null;
    this.totalMaxProducts = config.totalMaxProducts || null;
    this.maxPages = config.maxPages || 3;
    this.maxConcurrent = config.maxConcurrent || 3;
    this.maxRetries = config.maxRetries || 3;
    this.headless = config.headless !== undefined ? config.headless : true;
    this.delayBetweenPages = Math.max(500, config.delayBetweenPages || 2000);

    this.relatedProductsConfig = {
      enabled: config.relatedProducts?.enabled ?? false,
      maxPerProduct: config.relatedProducts?.maxPerProduct ?? 5
    };

    this.rateLimiter = new RateLimiter({
      redis: { enabled: false },
      defaultAlgorithm: FlipkartRateLimitConfig.algorithm,
      cleanupInterval: 60000
    });
    this.rateLimiter.registerRules('flipkart', FlipkartRateLimitConfig);

    this.checkpoint = this.loadCheckpoint();
    this.productLinks = this.checkpoint.productLinks;
    this.seenUrls = new Set();
    [...this.checkpoint.productLinks, ...this.checkpoint.relatedLinks].forEach(u => this.seenUrls.add(this.normalizeUrl(u)));

    this.cluster = null;
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
          relatedLinks: cp.relatedLinks || [],
          lastProcessedIndex: cp.lastProcessedIndex ?? -1,
          lastRelatedIndex: cp.lastRelatedIndex ?? -1,
          failedProducts: cp.failedProducts || [],
          lastPageScraped: cp.lastPageScraped ?? 0,
          pagesScraped: cp.pagesScraped || [],
          lastRunTimestamp: cp.lastRunTimestamp || null
        };
      }
    } catch (e) {
      this.logger.error(`Error loading checkpoint: ${e.message}`);
    }
    return { productLinks: [], relatedLinks: [], lastProcessedIndex: -1, lastRelatedIndex: -1, failedProducts: [], lastPageScraped: 0, pagesScraped: [], lastRunTimestamp: null };
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
      const full = url.startsWith('/') ? 'https://www.flipkart.com' + url : url;
      const m = full.match(/^(.*?\?pid=[^&]+)/);
      return m ? m[1] : full;
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
      timeout: 90000,
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
      if (['font', 'media'].includes(rt)) req.abort();
      else if (url.includes('google-analytics') || url.includes('facebook') || url.includes('doubleclick')) req.abort();
      else req.continue();
    });
    page.setDefaultTimeout(45000);
    page.setDefaultNavigationTimeout(45000);
  }

  async shutdown() {
    if (this.rateLimiter) await this.rateLimiter.close();
    if (this.cluster) {
      await this.cluster.close();
      this.logger.info('Cluster closed');
    }
  }

  async start() {
    try {
      await this.initializeCluster();

      if (this.productLinks.length === 0) {
        await this.collectProductLinks();
        this.saveCheckpoint();
      } else {
        this.logger.info(`Resuming: ${this.productLinks.length} product links from checkpoint`);
      }

      const total = this.maxProducts ? Math.min(this.maxProducts, this.productLinks.length) : this.productLinks.length;
      const processed = this.checkpoint.lastProcessedIndex + 1;
      this.logger.startScraper(this.category, total, processed);

      await this.processProducts(this.productLinks, 'lastProcessedIndex', false, this.maxProducts);

      if (this.checkpoint.failedProducts.length > 0) {
        this.logger.info(`Retrying ${this.checkpoint.failedProducts.length} failed products`);
        await this.retryFailedProducts();
      }

      if (this.relatedProductsConfig.enabled && this.checkpoint.relatedLinks.length > 0) {
        let relatedLimit = null;
        if (this.totalMaxProducts) {
          const mainDone = this.checkpoint.lastProcessedIndex + 1;
          relatedLimit = Math.max(0, this.totalMaxProducts - mainDone);
        }
        if (!relatedLimit || relatedLimit > 0) {
          const count = relatedLimit ? Math.min(relatedLimit, this.checkpoint.relatedLinks.length) : this.checkpoint.relatedLinks.length;
          this.logger.setTotalCount(count, this.checkpoint.lastRelatedIndex + 1);
          await this.processProducts(this.checkpoint.relatedLinks, 'lastRelatedIndex', true, relatedLimit);
        }
      }

      this.logger.completeScraper();
      await this.shutdown();
    } catch (e) {
      this.logger.error(`Scraping failed: ${e.message}`);
      this.saveCheckpoint();
      await this.shutdown();
      throw e;
    }
  }

  async collectProductLinks() {
    const startPage = this.checkpoint.lastPageScraped + 1;
    const cap = this.maxProducts;

    this.logger.info(`Collecting links: pages ${startPage}-${this.maxPages}, cap ${cap || 'none'}`);

    for (let pageNum = startPage; pageNum <= this.maxPages; pageNum++) {
      if (cap && this.productLinks.length >= cap) break;

      const url = this.buildPageUrl(pageNum);
      let stop = false;

      try {
        await this.cluster.execute({ url, pageNum }, async ({ page, data }) => {
          await this.configurePage(page);
          await page.goto(data.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await new Promise(r => setTimeout(r, 1500));

          const pageLinks = await page.evaluate(() => {
            const links = new Set();
            document.querySelectorAll('a[href*="/p/"]').forEach(a => {
              if (a.href && a.href.includes('pid=')) links.add(a.href);
            });
            return Array.from(links);
          });

          let added = 0;
          for (const link of pageLinks) {
            if (cap && this.productLinks.length >= cap) break;
            const norm = this.normalizeUrl(link);
            if (!this.seenUrls.has(norm)) {
              this.seenUrls.add(norm);
              this.productLinks.push(norm);
              added++;
            }
          }

          this.logger.info(`Page ${data.pageNum}: ${pageLinks.length} found, ${added} new | Total: ${this.productLinks.length}`);

          if (pageLinks.length === 0) stop = true;
          if (cap && this.productLinks.length >= cap) stop = true;

          const hasNext = await page.evaluate(() => {
            return !!Array.from(document.querySelectorAll('a')).find(a => a.textContent.trim() === 'Next');
          });
          if (!hasNext) stop = true;
        });

        this.checkpoint.lastPageScraped = pageNum;
        this.checkpoint.pagesScraped.push(pageNum);
        this.checkpoint.productLinks = this.productLinks;
        this.saveCheckpoint();

        if (stop) break;
      } catch (e) {
        this.logger.error(`Page ${pageNum} error: ${e.message}`);
        if (/blocked|captcha/i.test(e.message)) throw e;
      }

      await new Promise(r => setTimeout(r, this.delayBetweenPages));
    }

    this.logger.info(`Link collection complete: ${this.productLinks.length} products`);
  }

  buildPageUrl(pageNum) {
    if (pageNum === 1) return this.categoryUrl;
    if (this.categoryUrl.includes('page=')) return this.categoryUrl.replace(/page=\d+/, `page=${pageNum}`);
    const sep = this.categoryUrl.includes('?') ? '&' : '?';
    return `${this.categoryUrl}${sep}page=${pageNum}`;
  }

  async processProducts(urls, indexKey, isRelated, maxToProcess = null) {
    const start = this.checkpoint[indexKey] + 1;
    const end = maxToProcess ? Math.min(urls.length, start + maxToProcess) : urls.length;
    if (start >= end) return;

    this.logger.info(`Processing ${end - start} products [${start}-${end - 1}] (concurrent=${this.maxConcurrent})`);

    const batchBuffer = [];
    const tasks = [];

    for (let i = start; i < end; i++) {
      tasks.push(this.scrapeProductWithRetry(urls[i], i, isRelated)
        .then(product => ({ ok: true, index: i, product }))
        .catch(err => ({ ok: false, index: i, error: err?.message || String(err) })));
    }

    for (let i = 0; i < tasks.length; i += this.maxConcurrent) {
      const batch = tasks.slice(i, i + this.maxConcurrent);
      const results = await Promise.all(batch);

      for (const r of results) {
        if (r.ok) {
          batchBuffer.push(r.product);
          this.checkpoint[indexKey] = Math.max(this.checkpoint[indexKey], r.index);
        } else {
          this.logger.productError(r.index, r.error);
          this.checkpoint.failedProducts.push({
            index: r.index,
            url: urls[r.index],
            error: r.error,
            isRelated,
            timestamp: new Date().toISOString()
          });
        }
      }

      if (batchBuffer.length >= 5 || i + this.maxConcurrent >= tasks.length) {
        if (batchBuffer.length > 0) {
          this.saveData(batchBuffer.splice(0));
        }
      }
      this.saveCheckpoint();
    }
  }

  async scrapeProductWithRetry(url, index, isRelated) {
    let rl;
    while (true) {
      rl = await this.rateLimiter.checkLimit('scraper', 'flipkart');
      if (rl.allowed) break;
      const d = this.rateLimiter.calculateDelay(rl);
      this.logger.rateLimit(d);
      await new Promise(r => setTimeout(r, d));
    }

    let lastError;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const product = await this.scrapeProductDetail(url, isRelated);
        this.logger.updateProgress();
        const d = this.rateLimiter.calculateDelay(rl, FlipkartRateLimitConfig.baseDelay);
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
      this.scrapeProductWithRetry(fp.url, fp.index, fp.isRelated)
        .then(p => ({ ok: true, product: p }))
        .catch(e => ({ ok: false, original: fp, error: e?.message || String(e) }))
    );

    const buffer = [];
    for (let i = 0; i < tasks.length; i += this.maxConcurrent) {
      const batch = tasks.slice(i, i + this.maxConcurrent);
      const results = await Promise.all(batch);
      for (const r of results) {
        if (r.ok) buffer.push(r.product);
        else this.checkpoint.failedProducts.push({ ...r.original, retryAttempts: (r.original.retryAttempts || 0) + 1 });
      }
      if (buffer.length > 0) this.saveData(buffer.splice(0));
      this.saveCheckpoint();
    }
  }

  async scrapeProductDetail(url, isRelated) {
    return await this.cluster.execute({ url, isRelated }, async ({ page, data }) => {
      await this.configurePage(page);
      await page.goto(data.url, { waitUntil: 'domcontentloaded', timeout: 45000 });

      await page.waitForFunction(() => {
        return !!document.querySelector('h1')
          && !!Array.from(document.querySelectorAll('div[font]'))
            .find(e => e.textContent.trim() === 'Specifications' && e.children.length === 0);
      }, { timeout: 15000 }).catch(() => {});

      await new Promise(r => setTimeout(r, 1200));

      const basic = await this.extractBasicFields(page);
      const specifications = await this.extractSpecifications(page);

      let relatedUrls = [];
      if (!data.isRelated && this.relatedProductsConfig.enabled) {
        relatedUrls = await this.extractRelatedLinks(page);
      }

      if (relatedUrls.length > 0) {
        let added = 0;
        for (const r of relatedUrls) {
          if (added >= this.relatedProductsConfig.maxPerProduct) break;
          const n = this.normalizeUrl(r);
          if (!this.seenUrls.has(n)) {
            this.seenUrls.add(n);
            this.checkpoint.relatedLinks.push(n);
            added++;
          }
        }
      }

      return { url: data.url, ...basic, specifications };
    });
  }

  async extractBasicFields(page) {
    return await page.evaluate(() => {
      const toInt = t => {
        const m = t.match(/([\d,]+)/);
        return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
      };

      const title = document.querySelector('h1')?.textContent.trim() || null;

      const priceRe = /^₹[\d,]+(\.\d+)?$/;
      const allRupees = Array.from(document.querySelectorAll('*')).filter(e => {
        if (e.children.length !== 0) return false;
        if (!priceRe.test(e.textContent.trim())) return false;
        const r = e.getBoundingClientRect();
        return r.top > 100 && r.top < 1500 && r.left > 600;
      });
      const withSize = allRupees.map(e => ({ el: e, size: parseFloat(getComputedStyle(e).fontSize) }));
      withSize.sort((a, b) => b.size - a.size);
      const mainPriceEl = withSize[0]?.el || null;
      const current = mainPriceEl ? toInt(mainPriceEl.textContent) : null;

      let original = null;
      let discount = null;
      if (mainPriceEl) {
        const priceRow = mainPriceEl.parentElement?.parentElement;
        if (priceRow) {
          priceRow.querySelectorAll('*').forEach(el => {
            if (el.children.length !== 0) return;
            const t = el.textContent.trim();
            const style = el.getAttribute('style') || '';
            const cs = getComputedStyle(el);
            if (original === null && /^[\d,]+$/.test(t) && cs.textDecoration.includes('line-through')) {
              original = toInt(t);
            }
            if (discount === null && /^\d+%$/.test(t) && /rgb\(0,\s*128,\s*66\)/.test(style)) {
              discount = t + ' OFF';
            }
          });
        }
      }

      let rating = null, ratingCount = null;
      const ratingLink = document.querySelector('a[href*="ratings-reviews-details-page"]');
      if (ratingLink) {
        const txt = ratingLink.textContent.trim();
        const m = txt.match(/(\d\.\d)[\s|•·]*([\d,]+)/);
        if (m) {
          rating = parseFloat(m[1]);
          ratingCount = parseInt(m[2].replace(/,/g, ''), 10);
        }
      }

      const hasNotify = Array.from(document.querySelectorAll('button, div, span')).some(e =>
        e.children.length === 0 && e.textContent.trim() === 'Notify Me'
      );
      const availability = hasNotify ? 'Out of Stock' : 'In Stock';

      const categories = [];
      document.querySelectorAll('a[href^="/"]').forEach(a => {
        const txt = a.textContent.trim();
        if (txt.length < 2 || txt.length > 50) return;
        if (/\n/.test(txt)) return;
        const cls = a.getAttribute('class') || '';
        if (!/v1zwn21m/.test(cls)) return;
        const href = a.getAttribute('href') || '';
        if (!/^\/(mobile|smartphone|accessor|brand)/i.test(href) && !/~brand/.test(href)) return;
        if (!categories.includes(txt)) categories.push(txt);
      });

      const imgUrls = new Set();
      let main = null;
      document.querySelectorAll('img').forEach(img => {
        const src = img.src || '';
        if (!src.includes('rukminim') || !src.includes('mobile')) return;
        if (!/\/800\/1070\//.test(src)) return;
        if (!main) main = src;
        imgUrls.add(src);
      });

      return {
        title,
        price: { current, original, discount },
        rating: { score: rating, count: ratingCount },
        availability,
        category: categories,
        image: main,
        images: Array.from(imgUrls)
      };
    });
  }

  async extractSpecifications(page) {
    const clicked = await page.evaluate(() => {
      const t = Array.from(document.querySelectorAll('div[font], button[font]'))
        .find(e => e.textContent.trim() === 'Specifications'
          && e.children.length === 0
          && e.offsetParent !== null);
      if (!t) return false;
      t.scrollIntoView({ block: 'center', behavior: 'instant' });
      t.click();
      return true;
    });
    if (!clicked) throw new Error('Specifications button not found');

    const rendered = await page.waitForFunction((sel) => {
      const matches = Array.from(document.querySelectorAll(sel))
        .filter(el => el.querySelector('[font="default-fk-font-l"]')
          && el.querySelectorAll('.grid-formation-dynamic').length > 0);
      return matches.length >= 3;
    }, { timeout: 6000 }, SPEC_CONTAINER_CLASS).then(() => true).catch(() => false);

    if (!rendered) throw new Error('Specs did not render');

    return await page.evaluate((sel) => {
      const specs = {};
      const sections = Array.from(document.querySelectorAll(sel)).filter(el =>
        el.querySelector('[font="default-fk-font-l"]')
        && el.querySelectorAll('.grid-formation-dynamic').length > 0
      );
      for (const section of sections) {
        const title = section.querySelector('[font="default-fk-font-l"]')?.textContent.trim();
        if (!title) continue;
        const rows = {};
        section.querySelectorAll('.grid-formation-dynamic').forEach(row => {
          const label = row.querySelector('[font="default-fk-font-m"]')?.textContent.trim();
          if (!label) return;
          let value = '';
          row.querySelectorAll('[font="s"]').forEach(v => {
            const style = v.getAttribute('style') || '';
            if (style.includes('rgba(0, 0, 0, 0)')) return;
            const t = v.textContent.trim();
            if (t && !value.includes(t)) value = value ? value + ' ' + t : t;
          });
          if (value) rows[label] = value;
        });
        if (Object.keys(rows).length > 0) specs[title] = rows;
      }
      return specs;
    }, SPEC_CONTAINER_CLASS);
  }

  async extractRelatedLinks(page) {
    try {
      await page.evaluate(() => {
        const header = Array.from(document.querySelectorAll('div, h2'))
          .find(e => e.textContent.trim() === 'Similar Products');
        if (header) header.scrollIntoView({ block: 'center' });
      });
      await new Promise(r => setTimeout(r, 1500));

      return await page.evaluate(() => {
        const headers = Array.from(document.querySelectorAll('*')).filter(e =>
          e.children.length === 0 && e.textContent.trim() === 'Similar Products'
        );
        if (headers.length === 0) return [];
        let section = headers[0];
        for (let i = 0; i < 8; i++) {
          section = section.parentElement;
          if (!section) return [];
          if (section.querySelectorAll('a[href*="/p/"]').length > 3) break;
        }
        return Array.from(section.querySelectorAll('a[href*="/p/"]'))
          .map(a => a.href)
          .filter(h => h.includes('pid='));
      });
    } catch (e) {
      this.logger.error(`Error extracting related: ${e.message}`);
      return [];
    }
  }
}

if (require.main === module) {
  const crawler = new FlipkartCrawler({
    headless: true,
    maxProducts: 50,
    maxPages: 5,
    maxConcurrent: 6,
    maxRetries: 3,
    relatedProducts: { enabled: false }
  });

  crawler.start()
    .then(() => process.exit(0))
    .catch(err => { console.error('Crawler failed:', err); process.exit(1); });
}

module.exports = FlipkartCrawler;
