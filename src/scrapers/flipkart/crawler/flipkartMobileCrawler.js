const fs = require('fs');
const path = require('path');
const { Cluster } = require('puppeteer-cluster');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { CATEGORY_SELECTORS, PRODUCT_SELECTORS } = require('./flipkart-selectors');
const RateLimiter = require('../../../rate-limiter/RateLimiter');
const FlipkartRateLimitConfig = require('../../../rate-limiter/configs/flipkart-config');
const Logger = require('../../../utils/logger');

puppeteer.use(StealthPlugin());

class FlipkartCrawler {
  constructor(config = {}) {
    this.category = config.category || 'mobile';
    this.categoryUrl = config.categoryUrl || 'https://www.flipkart.com/mobiles/pr?sid=tyy%2C4io&otracker=categorytree&p%5B%5D=facets.availability%255B%255D%3DExclude%2BOut%2Bof%2BStock&p%5B%5D=facets.type%255B%255D%3DSmartphones&page=1';

    this.logger = new Logger(config.category || 'FLIPKART');

    const checkpointDir = path.join(__dirname, '..', 'checkpoints');
    const rawDataDir = path.join(__dirname, '..', 'raw_data');
    this.ensureDirectory(checkpointDir);
    this.ensureDirectory(rawDataDir);

    this.outputFile = config.outputFile || path.join(rawDataDir, `flipkart_${this.category}_scraped_data.json`);
    this.checkpointFile = config.checkpointFile || path.join(checkpointDir, `flipkart_${this.category}_checkpoint.json`);
    this.productLinks = [];
    this.checkpoint = this.loadCheckpoint();

    this.maxProducts = (config.maxProducts ?? null);
    this.totalMaxProducts = config.totalMaxProducts || null;
    this.maxPages = config.maxPages || 3;
    this.maxConcurrent = config.maxConcurrent || 2;
    this.maxRetries = config.maxRetries || 3;
    this.headless = config.headless !== undefined ? config.headless : true;
    this.productsPerPage = Math.max(1, Math.min(config.productsPerPage || 24, 100));
    this.delayBetweenPages = Math.max(500, config.delayBetweenPages || 2000);

    this.rateLimiter = new RateLimiter({
      redis: { enabled: false },
      defaultAlgorithm: FlipkartRateLimitConfig.algorithm,
      cleanupInterval: 60000
    });
    this.rateLimiter.registerRules('flipkart', FlipkartRateLimitConfig);

    this.relatedProductsConfig = {
      enabled: config.relatedProducts?.enabled ?? true,
      maxPerProduct: config.relatedProducts?.maxPerProduct ?? 5,
    };

    this.seenUrl = new Set();
    this.relatedProductUrls = new Set();

    [...this.checkpoint.productLinks, ...this.checkpoint.relatedLinks].forEach((url) => {
      const normalized = this.normalizeFlipkartUrl(this.addBaseUrl(url));
      if (normalized) this.seenUrl.add(normalized);
    });
    this.checkpoint.relatedLinks.forEach((url) => {
      const normalized = this.normalizeFlipkartUrl(this.addBaseUrl(url));
      if (normalized) this.relatedProductUrls.add(normalized);
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
        if (!cp.relatedLinks) cp.relatedLinks = [];
        if (cp.lastProcessedIndex === undefined) cp.lastProcessedIndex = -1;
        if (cp.lastRelatedIndex === undefined) cp.lastRelatedIndex = -1;
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
      relatedLinks: [],
      lastProcessedIndex: -1,
      lastRelatedIndex: -1,
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

  addBaseUrl(url) {
    if (!url) return url;
    if (url.startsWith('/')) return 'https://www.flipkart.com' + url;
    return url;
  }

  normalizeFlipkartUrl(url) {
    if (!url) return url;
    try {
      const fullUrl = this.addBaseUrl(url);
      const match = fullUrl.match(/^(.*?\?pid=[^&]+)/);
      return match ? match[1] : fullUrl;
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
        existingData.filter(p => p && p.url).map(p => this.normalizeFlipkartUrl(p.url))
      );
      const uniqueNew = newData.filter(p => {
        if (!p || !p.url) return true;
        const norm = this.normalizeFlipkartUrl(p.url);
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
      concurrency: Cluster.CONCURRENCY_PAGE,
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
      timeout: 45000,
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
        'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
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
      page.setDefaultNavigationTimeout(30000);
    } catch (error) {
      this.logger.error(`Error configuring page: ${error.message}`);
    }
  }

  buildPageUrl(pageNumber) {
    if (pageNumber === 1) return this.categoryUrl;
    if (this.categoryUrl.includes('page=')) {
      return this.categoryUrl.replace(/page=\d+/, `page=${pageNumber}`);
    }
    const separator = this.categoryUrl.includes('?') ? '&' : '?';
    return `${this.categoryUrl}${separator}page=${pageNumber}`;
  }

  async hasNextPage(page) {
    try {
      return await page.evaluate((selector) => {
        const result = document.evaluate(
          selector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
        );
        const nextElement = result.singleNodeValue;
        if (!nextElement) return false;
        const isDisabled = nextElement.classList.contains('_2Xp0TH') ||
          nextElement.classList.contains('disabled') ||
          nextElement.hasAttribute('disabled') ||
          nextElement.style.pointerEvents === 'none';
        return !isDisabled && nextElement.href !== window.location.href;
      }, CATEGORY_SELECTORS.NEXT_PAGE);
    } catch {
      return false;
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
      this.logger.startScraper(this.category, logTarget, processedCount);
      this.logger.setTotalCount(logTarget, processedCount);

      await this.scrapeProductDetails();

      if (this.relatedProductsConfig.enabled) {
        let relatedLimit = null;
        if (this.totalMaxProducts) {
          const mainProcessed = this.checkpoint.lastProcessedIndex + 1;
          relatedLimit = Math.max(0, this.totalMaxProducts - mainProcessed);
        }
        if (!relatedLimit || relatedLimit > 0) {
          const relatedCount = relatedLimit
            ? Math.min(relatedLimit, this.checkpoint.relatedLinks.length)
            : this.checkpoint.relatedLinks.length;
          this.logger.setTotalCount(relatedCount, this.checkpoint.lastRelatedIndex + 1);
          await this.processProductArray(
            this.checkpoint.relatedLinks,
            'lastRelatedIndex',
            'related products',
            true,
            relatedLimit || null
          );
        } else {
          this.logger.info('Related processing skipped due to totalMaxProducts cap');
        }
      } else {
        this.logger.info('Related products processing disabled in configuration');
      }

      this.logger.completeScraper();
      await this.shutdown();
    } catch (error) {
      this.logger.error(`Flipkart ${this.category} scraping failed: ${error.message}`);
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

  async scrapeProductLinks() {
    const allProductLinks = [];
    const mainCap = this.maxProducts;
    const startPage = this.checkpoint.lastPageScraped + 1;

    this.logger.info(`Starting: Pages ${startPage}-${this.maxPages} | Target: ${mainCap || 'ALL'} products`);

    for (let currentPage = startPage; currentPage <= this.maxPages; currentPage++) {
      await this.cluster.execute(
        { url: this.buildPageUrl(currentPage), pageNum: currentPage },
        async ({ page, data }) => {
          await this.configurePage(page);
          await page.goto(data.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
          await page.waitForSelector('body', { timeout: 10000 }).catch(() => {});

          const pageLinks = await page.evaluate((xpath) => {
            const links = [];
            const result = document.evaluate(
              xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null
            );
            for (let i = 0; i < result.snapshotLength; i++) {
              const el = result.snapshotItem(i);
              if (el.href && el.href.includes('/p/')) links.push(el.href);
            }
            return links;
          }, CATEGORY_SELECTORS.PRODUCT_LINK);

          let newLinksCount = 0;
          for (const link of pageLinks) {
            if (mainCap && allProductLinks.length >= mainCap) break;
            const normalizedUrl = this.normalizeFlipkartUrl(link);
            if (!this.seenUrl.has(normalizedUrl)) {
              this.seenUrl.add(normalizedUrl);
              allProductLinks.push(normalizedUrl);
              newLinksCount++;
            }
          }

          this.logger.info(`Page ${data.pageNum}: Found ${pageLinks.length} products, ${newLinksCount} new | Total: ${allProductLinks.length}`);

          if (pageLinks.length === 0) return { stop: true };
          if (mainCap && allProductLinks.length >= mainCap) return { stop: true };

          const hasNext = await this.hasNextPage(page);
          return { stop: !hasNext };
        }
      ).then(result => {
        this.checkpoint.lastPageScraped = currentPage;
        this.checkpoint.pagesScraped.push(currentPage);
        this.checkpoint.productLinks = allProductLinks;
        this.saveCheckpoint();
        if (result && result.stop) currentPage = this.maxPages;
      }).catch(error => {
        this.logger.error(`Error scraping page ${currentPage}: ${error.message}`);
        if (error.message.includes('blocked') || error.message.includes('CAPTCHA')) throw error;
      });

      if (mainCap && allProductLinks.length >= mainCap) break;
      if (currentPage < this.maxPages) {
        await new Promise(resolve => setTimeout(resolve, this.delayBetweenPages));
      }
    }

    this.productLinks = allProductLinks;
    this.checkpoint.productLinks = this.productLinks;
    this.saveCheckpoint();
    this.logger.info(`Link collection complete: ${this.productLinks.length} products from ${this.checkpoint.pagesScraped.length} pages`);
  }

  async processProductWithRetry(url, index, isRelated) {
    let lastError;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const rateLimitResult = await this.rateLimiter.checkLimit('scraper', 'flipkart');
        if (!rateLimitResult.allowed) {
          const delayMs = this.rateLimiter.calculateDelay(rateLimitResult);
          this.logger.rateLimit(delayMs);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }

        const productData = await this._scrapeProductDetail(url, isRelated);
        this.logger.updateProgress();

        const delayMs = this.rateLimiter.calculateDelay(rateLimitResult, FlipkartRateLimitConfig.baseDelay);
        await new Promise(resolve => setTimeout(resolve, delayMs));

        return productData;
      } catch (error) {
        lastError = error;
        this.logger.productError(index, error?.message || 'Unknown error occurred');
        if (attempt < this.maxRetries) {
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      }
    }

    throw lastError;
  }

  async scrapeProductDetails() {
    const totalProducts = this.productLinks.length;
    const processingCount = (this.maxProducts && this.maxProducts < totalProducts)
      ? this.maxProducts
      : totalProducts;

    const startIndex = this.checkpoint.lastProcessedIndex + 1;
    const endIndex = Math.min(processingCount, totalProducts);
    const results = [];
    const concurrent = Math.min(this.maxConcurrent, endIndex - startIndex);

    for (let i = startIndex; i < endIndex; i += concurrent) {
      const batchEnd = Math.min(i + concurrent, endIndex);
      const batchPromises = [];

      for (let j = i; j < batchEnd; j++) {
        batchPromises.push(this.processProductWithRetry(this.productLinks[j], j, false));
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
          this.logger.productError(index, errMsg);
          this.checkpoint.failedProducts.push({
            index,
            url: this.productLinks[index],
            error: errMsg,
            timestamp: new Date().toISOString()
          });
        }
      }

      this.saveCheckpoint();

      if (results.length >= 5 || i + concurrent >= endIndex) {
        if (results.length > 0) {
          this.saveData([...results]);
          results.length = 0;
        }
      }

      if (i + concurrent < endIndex) {
        const delayMs = Math.random() * 2000 + 1000;
        this.logger.debug(`Batch delay: ${delayMs}ms`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  async processProductArray(urlArray, indexKey, description, isRelated, maxToProcess = null) {
    const totalProducts = urlArray.length;
    const startIndex = this.checkpoint[indexKey] + 1;
    const endIndex = maxToProcess ? Math.min(totalProducts, startIndex + maxToProcess) : totalProducts;

    if (startIndex >= endIndex) return;

    this.logger.info(`Processing ${description} from index ${startIndex} to ${endIndex - 1} with max ${this.maxConcurrent} concurrent requests`);

    const results = [];
    const concurrent = Math.min(this.maxConcurrent, endIndex - startIndex);

    for (let i = startIndex; i < endIndex; i += concurrent) {
      const batchEnd = Math.min(i + concurrent, endIndex);
      const batchPromises = [];

      for (let j = i; j < batchEnd; j++) {
        batchPromises.push(this.processProductWithRetry(urlArray[j], j, isRelated));
      }

      const batchResults = await Promise.allSettled(batchPromises);

      for (let k = 0; k < batchResults.length; k++) {
        const result = batchResults[k];
        const index = i + k;
        if (result.status === 'fulfilled' && result.value) {
          results.push(result.value);
          this.checkpoint[indexKey] = index;
        } else {
          const errMsg = result.reason?.message || result.reason || 'Unknown error';
          this.logger.error(`Failed to process ${description} at index ${index}: ${errMsg}`);
          this.checkpoint.failedProducts.push({
            index,
            url: urlArray[index],
            error: errMsg,
            timestamp: new Date().toISOString()
          });
        }
      }

      this.saveCheckpoint();

      if (results.length >= 5 || i + concurrent >= endIndex) {
        if (results.length > 0) {
          this.saveData([...results]);
          results.length = 0;
        }
      }

      if (i + concurrent < endIndex) {
        const delayMs = Math.random() * 2000 + 1000;
        this.logger.debug(`Batch delay: ${delayMs}ms`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    this.logger.info(`Completed processing ${endIndex - startIndex} ${description}`);
  }

  async _scrapeProductDetail(url, isRelated = false) {
    return await this.cluster.execute({ url, isRelated }, async ({ page, data }) => {
      await this.configurePage(page);
      await page.goto(data.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 500));

      const productData = await this._extractProductData(page);

      if (!data.isRelated && this.relatedProductsConfig.enabled) {
        await this._extractRelatedProducts(page);
      }

      return { url: data.url, ...productData };
    });
  }

  async _extractProductData(page) {
    try {
      const title = await this._extractTitle(page);
      const pricing = await this._extractPricing(page);
      const rating = await this._extractRating(page);
      const availability = await this._getAvailability(page);
      const specifications = await this._getspecification(page);
      const categories = await this._extractCategories(page);
      const tags = await this._extractTags(page);
      const images = await this._extractImages(page);
      return {
        title,
        price: pricing,
        rating,
        availability,
        specifications,
        category: categories,
        tags,
        image: images.main,
        images: images.all
      };
    } catch (error) {
      this.logger.error(`Error extracting product data: ${error.message}`);
      return { title: null, specifications: {} };
    }
  }

  async _extractTitle(page) {
    try {
      return await page.evaluate((selectors) => {
        const getElementByXPath = (xpath) => {
          const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
          return result.singleNodeValue;
        };
        for (const xpath of selectors.TITLE) {
          const el = getElementByXPath(xpath);
          if (el && el.textContent.trim()) return el.textContent.trim();
        }
        return null;
      }, PRODUCT_SELECTORS);
    } catch (error) {
      this.logger.error(`Error extracting title: ${error.message}`);
      return null;
    }
  }

  async _extractPricing(page) {
    try {
      await new Promise(resolve => setTimeout(resolve, 500));
      return await page.evaluate((selectors) => {
        const getElementByXPath = (xpath) => {
          const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
          return result.singleNodeValue;
        };
        const pricing = { current: null, original: null, discount: null };
        for (const xpath of (selectors.PRICE || [])) {
          const el = getElementByXPath(xpath);
          if (el && el.textContent.includes('₹')) {
            const m = el.textContent.trim().match(/₹([0-9,]+)/);
            if (m) { pricing.current = parseInt(m[1].replace(/,/g, '')); break; }
          }
        }
        for (const xpath of (selectors.ORIGINAL_PRICE || [])) {
          const el = getElementByXPath(xpath);
          if (el && el.textContent.includes('₹')) {
            const m = el.textContent.trim().match(/₹([0-9,]+)/);
            if (m) { pricing.original = parseInt(m[1].replace(/,/g, '')); break; }
          }
        }
        for (const xpath of (selectors.DISCOUNT || [])) {
          const el = getElementByXPath(xpath);
          if (el && el.textContent.includes('%')) {
            const m = el.textContent.trim().match(/([0-9]+)%/);
            if (m) { pricing.discount = `${m[1]}% off`; break; }
          }
        }
        return pricing;
      }, PRODUCT_SELECTORS);
    } catch (error) {
      this.logger.error(`Error extracting pricing: ${error.message}`);
      return { current: null, original: null, discount: null };
    }
  }

  async _extractRating(page) {
    try {
      return await page.evaluate((selectors) => {
        const getElementByXPath = (xpath) => {
          const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
          return result.singleNodeValue;
        };
        const rating = { score: null, count: null };
        for (const xpath of (selectors.RATING || [])) {
          const el = getElementByXPath(xpath);
          if (el && el.textContent.trim()) {
            const m = el.textContent.trim().match(/([0-9.]+)/);
            if (m) { rating.score = parseFloat(m[1]); break; }
          }
        }
        for (const xpath of (selectors.RATING_COUNT || [])) {
          const el = getElementByXPath(xpath);
          if (el && el.textContent.trim()) {
            const m = el.textContent.trim().match(/([0-9,]+)/);
            if (m) { rating.count = parseInt(m[1].replace(/,/g, '')); break; }
          }
        }
        return rating;
      }, PRODUCT_SELECTORS);
    } catch (error) {
      this.logger.error(`Error extracting rating: ${error.message}`);
      return { score: null, count: null };
    }
  }

  async _extractCategories(page) {
    try {
      return await page.evaluate(() => {
        const categories = [];
        const breadcrumbContainer = document.querySelector('div._7dPnhA');
        if (breadcrumbContainer) {
          breadcrumbContainer.querySelectorAll('a.R0cyWM').forEach(a => {
            const text = a.textContent.trim();
            if (text) categories.push(text);
          });
          const finalCat = breadcrumbContainer.querySelector('div.KalC6f p');
          if (finalCat && finalCat.textContent.trim()) categories.push(finalCat.textContent.trim());
        }
        return categories;
      });
    } catch (error) {
      this.logger.error(`Error extracting categories: ${error.message}`);
      return [];
    }
  }

  async _extractTags(page) {
    try {
      return await page.evaluate(() => {
        const tagElements = document.querySelectorAll('[data-testid="product-highlights"] span, .product-tags span');
        return Array.from(tagElements).map(el => el.textContent.trim()).filter(text => text);
      });
    } catch (error) {
      this.logger.error(`Error extracting tags: ${error.message}`);
      return [];
    }
  }

  async _extractImages(page) {
    try {
      return await page.evaluate((selectors) => {
        const getElementByXPath = (xpath) => {
          const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
          return result.singleNodeValue;
        };
        const getAllElementsByXPath = (xpath) => {
          const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
          const elements = [];
          for (let i = 0; i < result.snapshotLength; i++) elements.push(result.snapshotItem(i));
          return elements;
        };
        let mainImage = null;
        const allImages = [];
        for (const xpath of (selectors.MAIN_IMAGE || [])) {
          const el = getElementByXPath(xpath);
          if (el && el.src) { mainImage = el.src; break; }
        }
        const imageXPath = "//img[contains(@class, '_0DkuPH')]";
        getAllElementsByXPath(imageXPath).forEach(img => {
          const src = img.getAttribute('src');
          if (src) allImages.push(src.split(',')[0].trim().split(' ')[0]);
        });
        return { main: mainImage, all: allImages };
      }, PRODUCT_SELECTORS);
    } catch (error) {
      this.logger.error(`Error extracting images: ${error.message}`);
      return { main: null, all: [] };
    }
  }

  async _getAvailability(page) {
    try {
      return await page.evaluate(() => {
        const el = document.querySelector('span.OGrnIL');
        return el ? 'In Stock' : 'Not In Stock';
      });
    } catch (error) {
      this.logger.error(`Error extracting availability: ${error.message}`);
      return 'In Stock';
    }
  }

  async _getspecification(page) {
    try {
      return await page.evaluate(() => {
        const specifications = {};
        const mainContainer = document.querySelector('div._1OjC5I');
        if (!mainContainer) return {};

        mainContainer.querySelectorAll('div.GNDEQ-').forEach(categoryEl => {
          const catNameEl = categoryEl.querySelector('div[class="_4BJ2V+"]');
          const categoryName = catNameEl ? catNameEl.textContent.trim() : null;
          if (!categoryName) return;

          specifications[categoryName] = {};
          categoryEl.querySelectorAll('tr.WJdYP6.row').forEach(row => {
            const fieldName = row.querySelector('td.col-3-12')?.textContent.trim();
            const valueCell = row.querySelector('td.col-9-12');
            const listItem = valueCell?.querySelector('li.HPETK2');
            const fieldValue = listItem ? listItem.textContent.trim() : valueCell?.textContent.trim();
            if (fieldName && fieldValue) specifications[categoryName][fieldName] = fieldValue;
          });

          if (Object.keys(specifications[categoryName]).length === 0) {
            delete specifications[categoryName];
          }
        });

        return specifications;
      });
    } catch (error) {
      this.logger.error(`Error extracting specifications: ${error.message}`);
      return {};
    }
  }

  async _extractRelatedProducts(page) {
    try {
      let scrollAttempts = 0;
      while ((await page.$('div.jOp9db')) == null && scrollAttempts < 20) {
        await page.mouse.wheel({ deltaY: 600 });
        await new Promise(resolve => setTimeout(resolve, 100));
        scrollAttempts++;
      }

      const allRelatedUrls = await page.evaluate(() => {
        const urls = [];
        document.querySelectorAll('.pq8uUv').forEach(section => {
          const headerEl = section.querySelector('div.jOp9db');
          if (headerEl && headerEl.textContent.trim() === 'Similar Products') {
            section.querySelectorAll('a.VJA3rP').forEach(a => {
              if (a.href) urls.push(a.href);
            });
          }
        });
        return urls;
      });

      const maxRelated = this.relatedProductsConfig.maxPerProduct;
      let addedCount = 0;

      for (const url of allRelatedUrls) {
        if (addedCount >= maxRelated) break;
        const normalizedUrl = this.normalizeFlipkartUrl(this.addBaseUrl(url));
        if (normalizedUrl && !this.seenUrl.has(normalizedUrl)) {
          this.seenUrl.add(normalizedUrl);
          this.checkpoint.relatedLinks.push(normalizedUrl);
          this.relatedProductUrls.add(normalizedUrl);
          addedCount++;
        }
      }

      this.logger.debug(`Added ${addedCount} new related products to related queue`);
      if (addedCount > 0) this.saveCheckpoint();
    } catch (error) {
      this.logger.error(`Error extracting related products: ${error.message}`);
    }
  }
}

if (require.main === module) {
  const crawler = new FlipkartCrawler({
    headless: true,
    maxProducts: 3000,
    totalMaxProducts: 5000,
    relatedProducts: { maxPerProduct: 6 },
    maxPages: 42,
    delayBetweenPages: 3000,
    maxConcurrent: 6,
    maxRetries: 3,
  });

  crawler.start()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = FlipkartCrawler;
