const fs = require('fs');
const path = require('path');
const { Cluster } = require('puppeteer-cluster');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { CATEGORY_SELECTORS, PRODUCT_SELECTORS, ERROR_INDICATORS } = require('./croma-selectors');
const RateLimiter = require('../../../rate-limiter/RateLimiter');
const CromaRateLimitConfig = require('../../../rate-limiter/configs/croma-config');
const Logger = require('../../../utils/logger');

puppeteer.use(StealthPlugin());

class CromaCrawler {
  constructor(config = {}) {
    this.category = config.category || 'mobile';
    this.categoryUrl = config.categoryUrl || 'https://www.croma.com/phones-wearables/c/1?q=%3Arelevance%3Alower_categories%3A95%3Alower_categories%3A97';

    this.logger = new Logger('CROMA');

    const checkpointDir = path.join(__dirname, '..', 'checkpoints');
    const rawDataDir = path.join(__dirname, '..', 'raw_data');
    this.ensureDirectory(checkpointDir);
    this.ensureDirectory(rawDataDir);

    this.checkpointFile = config.checkpointFile || path.join(checkpointDir, 'croma_mobile_checkpoint.json');
    this.outputFile = config.outputFile || path.join(rawDataDir, 'croma_mobile_scraped_data.json');

    this.maxProducts = config.maxProducts || null;
    this.maxConcurrent = config.maxConcurrent || 2;
    this.maxRetries = config.maxRetries || 3;
    this.headless = config.headless !== undefined ? config.headless : true;
    this.productsPerPage = config.productsPerPage || 12;
    this.delayBetweenPages = config.delayBetweenPages || 3000;

    this.rateLimiter = new RateLimiter({
      redis: { enabled: false },
      defaultAlgorithm: CromaRateLimitConfig.algorithm,
      cleanupInterval: 60000
    });
    this.rateLimiter.registerRules('croma', CromaRateLimitConfig);

    this.checkpoint = this.loadCheckpoint();
    this.productLinks = this.checkpoint.productLinks || [];
    this.seenUrls = new Set();

    if (this.productLinks.length > 0) {
      this.productLinks.forEach(url => this.seenUrls.add(this.normalizeCromaUrl(url)));
    }

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

  normalizeCromaUrl(url) {
    if (!url) return url;
    try {
      const fullUrl = url.startsWith('http') ? url : `https://www.croma.com${url}`;
      const u = new URL(fullUrl);
      u.hash = '';
      u.search = '';
      u.hostname = u.hostname.toLowerCase();
      if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
        u.pathname = u.pathname.slice(0, -1);
      }
      return u.toString();
    } catch {
      return url;
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
        existingData.filter(p => p && p.url).map(p => this.normalizeCromaUrl(p.url))
      );
      const uniqueNew = newData.filter(p => {
        if (!p || !p.url) return true;
        const norm = this.normalizeCromaUrl(p.url);
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
          '--window-size=1366,768',
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
      await page.setViewport({ width: 1366, height: 768, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );
      await page.setExtraHTTPHeaders({
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Upgrade-Insecure-Requests': '1'
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
        this.logger.info(`Resuming: ${this.productLinks.length} products from checkpoint`);
      }

      const collected = this.checkpoint.productLinks.length;
      const logTarget = this.maxProducts ? Math.min(this.maxProducts, collected) : collected;
      this.logger.startScraper('croma', logTarget, this.checkpoint.lastProcessedIndex + 1);

      await this.scrapeProductDetails();

      if (this.checkpoint.failedProducts.length > 0) {
        this.logger.info(`Retrying ${this.checkpoint.failedProducts.length} failed products`);
        await this.retryFailedProducts();
      }

      this.logger.completeScraper();
      await this.shutdown();
    } catch (error) {
      this.logger.error(`Error during crawling: ${error.message}`);
      this.saveCheckpoint();
      await this.shutdown();
      throw error;
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

  // Link collection uses a single long-lived page (not the cluster) because it
  // requires stateful "View More" button clicking on a single page session.
  async scrapeProductLinks() {
    this.logger.info('Starting Croma link collection via View More clicks');
    const targetProducts = this.maxProducts || 100;

    // Use cluster for the single listing page task
    await this.cluster.execute({ url: this.categoryUrl }, async ({ page, data }) => {
      await this.configurePage(page);
      await page.goto(data.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await new Promise(r => setTimeout(r, 2000));
      await page.waitForSelector('body', { timeout: 15000 }).catch(() => {});

      await page.evaluate(() => {
        return new Promise(resolve => {
          if (document.readyState === 'complete') resolve();
          else window.addEventListener('load', resolve);
        });
      });

      await this.checkForErrors(page);

      let totalClickCount = 0;
      const maxTotalClicks = 50;

      while (this.productLinks.length < targetProducts && totalClickCount < maxTotalClicks) {
        let viewMoreButton = null;
        for (const selector of CATEGORY_SELECTORS.VIEW_MORE_BUTTON) {
          try {
            await page.waitForSelector(selector, { timeout: 3000 }).catch(() => {});
            viewMoreButton = await page.$(selector);
            if (viewMoreButton) break;
          } catch { continue; }
        }

        if (!viewMoreButton) {
          this.logger.info(`No "View More" button found after ${totalClickCount} clicks`);
          break;
        }

        const isClickable = await page.evaluate(btn => {
          return btn && !btn.disabled && btn.offsetParent !== null;
        }, viewMoreButton);

        if (!isClickable) {
          this.logger.info(`View More button not clickable after ${totalClickCount} clicks`);
          break;
        }

        try {
          await page.evaluate(btn => btn.scrollIntoView({ behavior: 'smooth', block: 'center' }), viewMoreButton);
          await new Promise(r => setTimeout(r, 300));
          await viewMoreButton.click();
          totalClickCount++;
          this.logger.info(`Clicked "View More" (${totalClickCount}) | Products so far: ${this.productLinks.length}/${targetProducts}`);
          await new Promise(r => setTimeout(r, 1500));

          const rawLinks = await page.evaluate((selectors) => {
            const links = [];
            for (const selector of selectors.PRODUCT_LINK) {
              document.querySelectorAll(selector).forEach(el => {
                const href = el.href || el.getAttribute('href');
                if (href) {
                  links.push(href.startsWith('http') ? href : `https://www.croma.com${href}`);
                }
              });
              if (links.length > 0) break;
            }
            return links;
          }, CATEGORY_SELECTORS);

          rawLinks.forEach(link => {
            const norm = this.normalizeCromaUrl(link);
            if (!this.seenUrls.has(norm)) {
              this.seenUrls.add(norm);
              this.productLinks.push(norm);
            }
          });
        } catch (error) {
          this.logger.error(`Error clicking View More: ${error.message}`);
          break;
        }
      }

      // Final extraction pass
      const rawLinks = await page.evaluate((selectors) => {
        const links = [];
        for (const selector of selectors.PRODUCT_LINK) {
          document.querySelectorAll(selector).forEach(el => {
            const href = el.href || el.getAttribute('href');
            if (href) {
              links.push(href.startsWith('http') ? href : `https://www.croma.com${href}`);
            }
          });
          if (links.length > 0) break;
        }
        return links;
      }, CATEGORY_SELECTORS);

      for (const link of rawLinks) {
        if (this.maxProducts && this.productLinks.length >= this.maxProducts) break;
        const norm = this.normalizeCromaUrl(link);
        if (!this.seenUrls.has(norm)) {
          this.seenUrls.add(norm);
          this.productLinks.push(norm);
        }
      }

      this.checkpoint.productLinks = this.productLinks;
      this.checkpoint.lastPageScraped = 1;
      this.checkpoint.pagesScraped = [1];
    });

    this.logger.info(`Link collection complete: ${this.productLinks.length} total products`);
  }

  async scrapeProductDetails() {
    const startIndex = this.checkpoint.lastProcessedIndex + 1;
    const endIndex = this.maxProducts
      ? Math.min(this.productLinks.length, this.maxProducts)
      : this.productLinks.length;

    this.logger.info(`Processing products ${startIndex + 1}-${endIndex} (${this.maxConcurrent} concurrent)`);

    const results = [];

    for (let i = startIndex; i < endIndex; i += this.maxConcurrent) {
      const batchEnd = Math.min(i + this.maxConcurrent, endIndex);
      const batchPromises = [];

      for (let j = i; j < batchEnd; j++) {
        batchPromises.push(this.processProductWithRetry(this.productLinks[j], j));
      }

      const batchResults = await Promise.allSettled(batchPromises);

      for (let k = 0; k < batchResults.length; k++) {
        const result = batchResults[k];
        const index = i + k;
        if (result.status === 'fulfilled' && result.value) {
          results.push(result.value);
          this.checkpoint.lastProcessedIndex = index;
        } else {
          const errMsg = result.reason?.message || result.reason || 'Unknown error';
          this.logger.error(`Failed product at index ${index}: ${errMsg}`);
          this.checkpoint.failedProducts.push({
            index,
            url: this.productLinks[index],
            error: errMsg,
            timestamp: new Date().toISOString()
          });
        }
      }

      this.saveCheckpoint();

      if (results.length >= 5 || i + this.maxConcurrent >= endIndex) {
        if (results.length > 0) {
          this.saveData([...results]);
          results.length = 0;
        }
      }

      if (i + this.maxConcurrent < endIndex) {
        await new Promise(r => setTimeout(r, Math.random() * 2000 + 1000));
      }
    }

    this.logger.info(`Batch complete. Failed: ${this.checkpoint.failedProducts.length}`);
  }

  async processProductWithRetry(url, index) {
    let lastError;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const rateLimitResult = await this.rateLimiter.checkLimit('scraper', 'croma');
        if (!rateLimitResult.allowed) {
          const delayMs = this.rateLimiter.calculateDelay(rateLimitResult);
          this.logger.rateLimit(delayMs);
          await new Promise(r => setTimeout(r, delayMs));
          continue;
        }

        const productData = await this._scrapeProductDetail(url);
        this.logger.updateProgress();

        const delayMs = this.rateLimiter.calculateDelay(rateLimitResult, CromaRateLimitConfig.baseDelay);
        await new Promise(r => setTimeout(r, delayMs));

        return productData;
      } catch (error) {
        lastError = error;
        this.logger.productError(index, error.message);
        if (attempt < this.maxRetries) {
          await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
        }
      }
    }

    throw lastError;
  }

  async _scrapeProductDetail(url) {
    return await this.cluster.execute({ url }, async ({ page, data }) => {
      await this.configurePage(page);
      await page.goto(data.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
      await this.checkForErrors(page);

      const productData = await this._extractAllProductData(page);
      return { url: data.url, ...productData };
    });
  }

  async checkForErrors(page) {
    try {
      const hasError = await page.evaluate((errorSelectors) => {
        for (const sel of (errorSelectors.CAPTCHA || [])) {
          if (document.querySelector(sel)) return { type: 'CAPTCHA', sel };
        }
        for (const sel of (errorSelectors.ACCESS_DENIED || [])) {
          if (document.querySelector(sel)) return { type: 'ACCESS_DENIED', sel };
        }
        for (const sel of (errorSelectors.NOT_FOUND || [])) {
          if (document.querySelector(sel)) return { type: 'NOT_FOUND', sel };
        }
        return null;
      }, ERROR_INDICATORS);

      if (hasError) throw new Error(`Page error detected: ${hasError.type}`);
    } catch (error) {
      if (error.message.includes('Page error detected')) throw error;
    }
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

        // Title
        const title = getText('h1.pd-title')?.replace(/\s+/g, ' ') || null;

        // Pricing
        const pricing = { current: null, original: null, discount: null };
        const currentText = getText('span#pdp-product-price');
        if (currentText && currentText.includes('₹')) {
          const clean = currentText.split('₹')[1]?.split('₹')[0]?.trim();
          if (clean && /^\d{1,3}(,\d{3})*(\.\d{2})?$/.test(clean)) {
            pricing.current = '₹' + clean;
          }
        } else if (currentText) {
          pricing.current = currentText;
        }

        const originalText = getText('span#old-price');
        if (originalText && originalText.includes('₹')) {
          const clean = originalText.split('₹')[1]?.split('₹')[0]?.trim();
          if (clean && /^\d{1,3}(,\d{3})*(\.\d{2})?$/.test(clean)) {
            pricing.original = '₹' + clean;
          }
        } else if (originalText) {
          pricing.original = originalText;
        }

        if (pricing.current !== null && pricing.original !== null) {
          const curr = parseFloat(pricing.current.replace(/[^\d.]/g, ''));
          const orig = parseFloat(pricing.original.replace(/[^\d.]/g, ''));
          if (!isNaN(curr) && !isNaN(orig) && orig > 0 && curr < orig) {
            pricing.discount = Math.round(((orig - curr) / orig) * 100) + '%';
          }
        }

        // Rating
        const reviewText = document.querySelector('a.pr-review.review-text')?.textContent.trim() || '';
        let star = null, ratingCount = null, reviewCount = null;
        if (/^Be\s+the\s+First\s+One\s+to\s+Review$/i.test(reviewText)) {
          star = 'Not Available';
          ratingCount = 'Not Available';
          reviewCount = 'Not Available';
        } else {
          const starEl = document.querySelector('.cp-rating span span');
          if (starEl) star = starEl.textContent.trim();
          const ratingMatch = reviewText.match(/([\d,]+)\s+Ratings?/i);
          if (ratingMatch) ratingCount = ratingMatch[1].replace(/,/g, '');
          const reviewsMatch = reviewText.match(/([\d,]+)\s+Reviews?/i);
          if (reviewsMatch) reviewCount = reviewsMatch[1].replace(/,/g, '');
        }
        const rating = { star, rating: ratingCount, reviews: reviewCount };

        // Images
        const imageUrls = [];
        document.querySelectorAll('.gallery-thumbs img, .gallery-top img').forEach(img => {
          const url = img.getAttribute('data-src') || img.getAttribute('src');
          if (url) imageUrls.push(url);
        });
        const mainImage = imageUrls[0] || null;
        const allImages = imageUrls.slice(1);

        // Specifications
        const specifications = {};
        document.querySelectorAll('#specification_container .cp-specification-info').forEach(section => {
          const sectionTitle = section.querySelector('h3.title')?.textContent.trim();
          if (!sectionTitle) return;

          const specs = {};
          section.querySelectorAll('ul.cp-specification-spec-info').forEach(group => {
            group.querySelectorAll('div').forEach(div => {
              const name = div.querySelector('.cp-specification-spec-title h4')?.textContent.replace(/\s+/g, ' ').trim();
              const value = div.querySelector('.cp-specification-spec-details')?.textContent.replace(/\s+/g, ' ').trim();
              if (name && value) specs[name] = value;
            });
          });

          if (Object.keys(specs).length > 0) specifications[sectionTitle] = specs;
        });

        return {
          title,
          price: pricing,
          rating,
          image: mainImage,
          allImages,
          specifications,
          categories: 'Smartphones',
          extractedAt: new Date().toISOString()
        };
      }, PRODUCT_SELECTORS);
    } catch (error) {
      this.logger.error(`Error extracting product data: ${error.message}`);
      return {
        title: null,
        price: { current: null, original: null, discount: null },
        rating: { star: null, rating: null, reviews: null },
        image: null,
        allImages: [],
        specifications: {},
        categories: [],
        extractedAt: new Date().toISOString(),
        error: error.message
      };
    }
  }

  async retryFailedProducts() {
    const failedProducts = [...this.checkpoint.failedProducts];
    this.checkpoint.failedProducts = [];

    const results = [];
    for (const failedProduct of failedProducts) {
      try {
        const productData = await this.processProductWithRetry(failedProduct.url, failedProduct.index);
        results.push(productData);
        if (results.length >= 5) {
          this.saveData([...results]);
          results.length = 0;
        }
      } catch (error) {
        this.logger.error(`Retry failed for ${failedProduct.url}: ${error.message}`);
        this.checkpoint.failedProducts.push({
          ...failedProduct,
          retryAttempts: (failedProduct.retryAttempts || 0) + 1
        });
      }
    }

    if (results.length > 0) this.saveData(results);
    this.saveCheckpoint();
  }
}

if (require.main === module) {
  const crawler = new CromaCrawler({
    headless: true,
    maxProducts: 5,
    maxConcurrent: 6,
    delayBetweenPages: 3000
  });

  crawler.start().catch(error => {
    console.error('Crawler failed:', error);
    process.exit(1);
  });
}

module.exports = CromaCrawler;
