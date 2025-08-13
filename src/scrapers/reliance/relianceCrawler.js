const fs = require('fs');
const path = require('path');
const BaseCrawler = require('../base-crawler');
const cheerio = require('cheerio');
const { CATEGORY_SELECTORS, PRODUCT_SELECTORS } = require('./reliance-selectors');
const RateLimiter = require('../../rate-limiter/RateLimiter');
const RelianceRateLimitConfig = require('../../rate-limiter/configs/reliance-config');

class RelianceCrawler extends BaseCrawler {
  constructor(config = {}) {
    const defaultConfig = {
      headless: config.headless !== undefined ? config.headless : true,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 768, deviceScaleFactor: 1 },
      proxyConfig: { useProxy: false },
      // Memory management
      memoryManagement: {
        enabled: true,
        maxMemoryMB: 1024,
        maxPages: 4,
        pagePoolSize: 3,
        cleanupInterval: 60000,
        forceGCInterval: 240000,
        memoryCheckInterval: 25000,
      },
      maxProducts: null, // unlimited unless set
      maxPages: 50,
      maxConcurrent: 5,
      maxRetries: 3,
      delayBetweenPages: 2000,
      productsPerPage: 24,
    };

    super({ ...defaultConfig, ...config });

    // Placeholder category URL
    this.categoryUrl = config.categoryUrl || 'https://www.reliancedigital.in/collection/mobiles/?page_no=1&is_available=true&page_type=number&page_size=12';
    this.checkpointFile = config.checkpointFile || path.join(__dirname, 'checkpoint.json');
    this.outputFile = config.outputFile || path.join(__dirname, 'reliance_raw.json');
    this.productLinks = [];
    this.checkpoint = this.loadCheckpoint();

    // Instance-level runtime settings
    this.maxProducts = (config.maxProducts ?? defaultConfig.maxProducts) ?? null;
    this.maxPages = config.maxPages || defaultConfig.maxPages;
    this.maxConcurrent = config.maxConcurrent || defaultConfig.maxConcurrent;
    this.maxRetries = config.maxRetries || defaultConfig.maxRetries;
    this.delayBetweenPages = Math.max(500, config.delayBetweenPages || defaultConfig.delayBetweenPages);
    this.productsPerPage = Math.max(1, Math.min(config.productsPerPage || defaultConfig.productsPerPage, 100));

    // Initialize rate limiter
    this.rateLimiter = new RateLimiter({
      redis: { enabled: false },
      defaultAlgorithm: RelianceRateLimitConfig.algorithm,
      cleanupInterval: 60000,
    });
    this.rateLimiter.registerRules('reliance', RelianceRateLimitConfig);

    // Ensure checkpoint has the required structure
    if (!this.checkpoint.productLinks) {
      this.checkpoint.productLinks = [];
    }
    if (this.checkpoint.lastProcessedIndex === undefined) {
      this.checkpoint.lastProcessedIndex = -1;
    }
    if (!this.checkpoint.failedProducts) {
      this.checkpoint.failedProducts = [];
    }
    if (!this.checkpoint.lastRunTimestamp) {
      this.checkpoint.lastRunTimestamp = null;
    }
    if (!this.checkpoint.pagesScraped) {
      this.checkpoint.pagesScraped = [];
    }
    if (this.checkpoint.lastPageScraped === undefined) {
      this.checkpoint.lastPageScraped = 0;
    }
  }

  async initialize() {
    await super.initialize();
    // Configure pages similarly to Amazon: via targetcreated
    this.browser.on('targetcreated', async (target) => {
      if (target.type() !== 'page') return;
      try {
        const page = await target.page();
        if (!page) return;
        await page.setJavaScriptEnabled(true);
        if (this.config.userAgent) await page.setUserAgent(this.config.userAgent);
        await page.setViewport({ width: 1366, height: 768, deviceScaleFactor: 1 });
        await page.setExtraHTTPHeaders({
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache'
        });
      } catch (_) { /* ignore */ }
    });
  }

  loadCheckpoint() {
    try {
      if (fs.existsSync(this.checkpointFile)) {
        const data = fs.readFileSync(this.checkpointFile, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      this.logger.error(`Error loading checkpoint: ${error.message}`);
    }
    return {
      productLinks: [],
      lastProcessedIndex: -1,
      failedProducts: [],
      pagesScraped: [],
      lastPageScraped: 0,
      lastRunTimestamp: null,
    };
  }

  saveCheckpoint() {
    try {
      this.checkpoint.lastRunTimestamp = new Date().toISOString();
      fs.writeFileSync(this.checkpointFile, JSON.stringify(this.checkpoint, null, 2));
    } catch (error) {
      this.logger.error(`Error saving checkpoint: ${error.message}`);
    }
  }

  saveData(data) {
    try {
      const newData = Array.isArray(data) ? data : [data];
      
      // Load existing titles
      let existingTitles = [];
      if (fs.existsSync(this.outputFile)) {
        const fileContent = fs.readFileSync(this.outputFile, 'utf8');
        if (fileContent) {
          const existing = JSON.parse(fileContent);
          if (existing.titles && Array.isArray(existing.titles)) {
            existingTitles = existing.titles;
          } else if (existing.titles && typeof existing.titles === 'string') {
            // Handle old comma-separated format
            existingTitles = existing.titles.split(', ').filter(t => t.trim());
          }
        }
      }
      
      // Extract new titles and combine with existing
      const newTitles = newData.filter(item => item.title).map(item => item.title);
      const allTitles = [...existingTitles, ...newTitles];
      const titleOutput = { titles: allTitles };
      
      // Save titles format (each title on separate line in array)
      fs.writeFileSync(this.outputFile, JSON.stringify(titleOutput, null, 2));
      
      // Comment: Original detailed format (uncomment to use)
      /*
      let existingData = [];
      if (fs.existsSync(this.outputFile)) {
        const fileContent = fs.readFileSync(this.outputFile, 'utf8');
        if (fileContent) existingData = JSON.parse(fileContent);
      }
      const combinedData = [...existingData, ...newData];
      fs.writeFileSync(this.outputFile, JSON.stringify(combinedData, null, 2));
      */
      
      this.logger.info(`Saved ${newTitles.length} product titles | Total titles: ${allTitles.length}`);
    } catch (error) {
      this.logger.error(`Error saving data: ${error.message}`);
    }
  }

  async start() {
    try {
      this.logger.info('Starting Reliance crawler');

      if (this.checkpoint.productLinks.length === 0) {
        await this.scrapeProductLinks();
        this.saveCheckpoint();
      } else {
        this.productLinks = this.checkpoint.productLinks;
        this.logger.info(`Loaded ${this.productLinks.length} product links from checkpoint`);
      }

      await this.scrapeProductDetails();

      this.logger.info('Reliance crawler completed');
    } catch (error) {
      this.logger.error(`Reliance crawler failed: ${error.message}`);
      throw error;
    } finally {
      await this.close();
      if (this.rateLimiter) await this.rateLimiter.close();
    }
  }

  async scrapeProductLinks() {
    this.logger.info('Scraping product links (listing pages)');
    const startPage = this.checkpoint.lastPageScraped || 1;
    const maxPages = this.maxPages;
    const collected = [];

    for (let pageNum = startPage; pageNum <= maxPages; pageNum++) {
      const url = this.buildCategoryPageUrl(this.categoryUrl, pageNum);
      console.log('url: ', url);

      // Rate limit guard
      const rateLimitResult = await this.rateLimiter.checkLimit('scraper', 'reliance');
      if (!rateLimitResult.allowed) {
        const delayMs = this.rateLimiter.calculateDelay(rateLimitResult, RelianceRateLimitConfig.baseDelay);
        // Add extra random delay to be more respectful
        const extraDelay = Math.random() * 1500 + 500; // 0.5-2 seconds extra
        this.logger.warn(`Rate limit hit, waiting ${delayMs + extraDelay}ms`);
        await new Promise((r) => setTimeout(r, delayMs + extraDelay));
      }

      const page = await this.newPage();
      try {
        await this.navigate(page, url);
        // Small scroll to ensure content snaps in even if JS is disabled
        try { await this.humanScroll(page, 600); } catch (_) {}
        const html = await page.content();
        if (pageNum === 1) {
          try {
            const dumpPath = path.join(__dirname, '../../..', 'screenshots', 'reliance_page_1.html');
            fs.writeFileSync(dumpPath, html, 'utf8');
            this.logger.info(`Saved page HTML to ${dumpPath}`);
          } catch (_) { /* ignore */ }
        }
        const $ = cheerio.load(html);

        const newLinks = new Set();
        
        // 1) Extract from JSON-LD structured data (most reliable for Reliance)
        $('script[type="application/ld+json"]').each((_, script) => {
          try {
            const jsonText = $(script).html();
            const data = JSON.parse(jsonText);
            
            // Look for ItemList with itemListElement
            if (data['@type'] === 'ItemList' && data.itemListElement && Array.isArray(data.itemListElement)) {
              data.itemListElement.forEach(item => {
                if (item.url) {
                  // URLs in JSON-LD are relative and HTML-encoded, clean them up
                  let cleanUrl = item.url.replace(/&#x2F;/g, '/'); // Fix HTML-encoded forward slashes
                  const absoluteUrl = cleanUrl.startsWith('http') ? cleanUrl : `https://${cleanUrl}`;
                  newLinks.add(absoluteUrl);
                }
              });
            }
          } catch (e) {
            // Ignore JSON parsing errors
          }
        });
        
        // 2) Fallback: Try CSS selectors if JSON-LD didn't work
        if (newLinks.size === 0) {
          (CATEGORY_SELECTORS.PRODUCT_LINK || []).forEach((sel) => {
            $(String(sel)).each((_, el) => {
              const hrefRaw = $(el).attr('href');
              if (!hrefRaw) return;
              try {
                const absolute = new URL(hrefRaw, 'https://www.reliancedigital.in').href;
                newLinks.add(absolute);
              } catch (_) {
                newLinks.add(this.addBaseUrl(hrefRaw));
              }
            });
          });
        }

        const unique = Array.from(newLinks);
        this.logger.info(`Page ${pageNum}: found ${unique.length} links`);
        collected.push(...unique);

        this.checkpoint.pagesScraped.push({ page: pageNum, url, count: unique.length, ts: Date.now() });
        this.checkpoint.lastPageScraped = pageNum + 1;
        this.saveCheckpoint();

        // Delay between pages
        await new Promise((r) => setTimeout(r, this.delayBetweenPages));
      } catch (error) {
        this.logger.warn(`Failed to process page ${pageNum}: ${error.message}`);
      } finally {
        await this.returnPageToPool(page);
      }

      // Stop early if maxProducts reached
      if (this.maxProducts && collected.length >= this.maxProducts) break;
    }

    // Trim if over-collected
    if (this.maxProducts && collected.length > this.maxProducts) {
      collected.length = this.maxProducts;
    }

    this.productLinks = collected;
    this.checkpoint.productLinks = collected;
    this.saveCheckpoint();
  }

  addBaseUrl(url) {
    if (!url) return url;
    if (url.startsWith('/')) {
      return 'https://www.reliancedigital.in' + url;
    }
    return url;
  }

  buildCategoryPageUrl(baseUrl, pageNum) {
    try {
      const u = new URL(baseUrl);
      if (u.searchParams.has('page_no')) {
        u.searchParams.set('page_no', String(pageNum));
      } else if (u.searchParams.has('page')) {
        u.searchParams.set('page', String(pageNum));
      } else {
        // Default to page_no since Reliance listings use it
        u.searchParams.set('page_no', String(pageNum));
      }
      return u.toString();
    } catch (_) {
      return baseUrl;
    }
  }

  async scrapeProductDetails() {
    const startIndex = this.checkpoint.lastProcessedIndex + 1;
    const endIndex = this.maxProducts ? Math.min(this.productLinks.length, this.maxProducts) : this.productLinks.length;
    const results = [];

    for (let i = startIndex; i < endIndex; i += this.maxConcurrent) {
      const batch = [];
      for (let j = i; j < Math.min(i + this.maxConcurrent, endIndex); j++) {
        const url = this.productLinks[j];
        batch.push(this.processProductWithRetry(url, j));
      }

      const settled = await Promise.allSettled(batch);
      for (let k = 0; k < settled.length; k++) {
        const index = i + k;
        const res = settled[k];
        if (res.status === 'fulfilled' && res.value) {
          results.push(res.value);
          this.checkpoint.lastProcessedIndex = index;
        } else {
          const errMsg = res.reason?.message || String(res.reason) || 'Unknown error';
          this.checkpoint.failedProducts.push({ index, url: this.productLinks[index], error: errMsg, ts: Date.now() });
        }
      }

      this.saveCheckpoint();
      if (results.length > 0) {
        this.saveData(results);
        results.length = 0;
      }
    }
  }

  async processProductWithRetry(url, index) {
    let lastError;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const rate = await this.rateLimiter.checkLimit('scraper', 'reliance');
        if (!rate.allowed) {
          const wait = this.rateLimiter.calculateDelay(rate, RelianceRateLimitConfig.baseDelay);
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
        const product = await this._scrapeProductDetail(url);
        const delayMs = this.rateLimiter.calculateDelay(rate, RelianceRateLimitConfig.baseDelay);
        // Add extra random delay to be more respectful
        const extraDelay = Math.random() * 2000 + 1000; // 1-3 seconds extra
        await new Promise((r) => setTimeout(r, delayMs + extraDelay));
        return product;
      } catch (err) {
        lastError = err;
        if (attempt < this.maxRetries) {
          const backoff = Math.pow(2, attempt) * 1000;
          await new Promise((r) => setTimeout(r, backoff));
        }
      }
    }
    throw lastError;
  }

  async _scrapeProductDetail(url) {
    const page = await this.newPage();
    try { 
      await page.setJavaScriptEnabled(true);
      await this.navigate(page, url);
      await this.delay(500, 1000);

      const productData = await this._extractAllProductData(page);
      await this.returnPageToPool(page);
      return { url, ...productData };
      // return {...productData};
    } catch (error) {
      await this.safeClosePage(page);
      throw error;
    }
  }

  async _extractAllProductData(page) {
    const html = await page.content();
    const $ = cheerio.load(html);

    const title = await this._extractTitle($);
    const pricing = await this._extractPricing($);
    const ratingInfo = await this._extractRating($);
    const image = await this._extractImage($);
    const brand = await this._extractBrand($);
    const specs = await this._extractSpecifications($);

    const product = {
      title,
      price: pricing.price,
      originalPrice: pricing.originalPrice,
      discount: pricing.discount,
      rating: ratingInfo.rating,
      ratingCount: ratingInfo.ratingCount,
      image,
      brand,
      specs,
    };

    return product;
  }

  async _extractTitle($) { 
    try {
      for (const selector of PRODUCT_SELECTORS.TITLE) {
        const titleElement = $(selector).first();
        
        if (titleElement.length > 0) {
          const title = titleElement.text().replace(/\s+/g, ' ').trim();
          
          if (title && title.length > 5 && title.length < 250) {
            return title;
          }
        }
      }
      
      return null;
    } catch (error) {
      this.logger.error(`Error extracting title: ${error.message}`);
      return null;
    }
   }

   async _extractPricing($) {
    try {
      const pricing = {
        price: null,
        originalPrice: null,
        discount: null
      };
      
      for (const selector of PRODUCT_SELECTORS.PRICE) {
        const element = $(selector).first();
        if (element.length > 0 && element.text().trim()) {
          const priceText = element.text().trim();
          pricing.price = priceText;
          break;
        }
      }
      
      for (const selector of PRODUCT_SELECTORS.ORIGINAL_PRICE) {
        const element = $(selector).first();
        if (element.length > 0 && element.text().trim()) {
          const originalText = element.text().trim();
          pricing.originalPrice = originalText;
          break;
        }
      }
      
      for (const selector of PRODUCT_SELECTORS.DISCOUNT) {
        const element = $(selector).first();
        if (element.length > 0 && element.text().trim()) {
          pricing.discount = element.text().trim();
          break;
        }
      }

      return pricing;
    } catch (error) {
      this.logger.error(`Error extracting pricing: ${error.message}`);
      return { price: null, originalPrice: null, discount: null };
    }
   }

   async _extractRating($) {
    try {
      const rating = {
        rating: null,
        ratingCount: null
      };

      for (const selector of PRODUCT_SELECTORS.RATING) {
        const element = $(selector).first();
        if (element.length > 0) {
          const ratingText = element.text() || element.attr('aria-label') || '';
          const ratingMatch = ratingText.match(/(\d+\.?\d*)/);
          if (ratingMatch) {
            rating.rating = parseFloat(ratingMatch[1]);
            break;
          }
        }
      }
      
      for (const selector of PRODUCT_SELECTORS.RATING_COUNT) {
        const element = $(selector).first();
        if (element.length > 0 && element.text().trim()) {
          const countText = element.text();
          const countMatch = countText.match(/[\d,]+/);
          if (countMatch) {
            rating.ratingCount = parseInt(countMatch[0].replace(/,/g, ''));
            break;
          }
        }
      }
      return rating;
    } catch (error) {
      this.logger.error(`Error extracting rating: ${error.message}`);
      return { rating: null, ratingCount: null };
    }
   }

   async _extractImage($) { 
    try {
      let mainImage = null;
      for (const selector of PRODUCT_SELECTORS.IMAGE) {
        const element = $(selector).first();
        if (element.length > 0) {
          mainImage = element.attr('src') || element.attr('data-src');
          if (mainImage) {
            break;
          }
        }
      }
      return mainImage;
    } catch (error) {
      this.logger.error(`Error extracting image: ${error.message}`);
      return null;
    }
   }

   async _extractBrand($) { 
    try {
      for (const selector of PRODUCT_SELECTORS.BRAND) {
        const element = $(selector).first();
        if (element.length > 0 && element.text().trim()) {
          return element.text().trim();
        }
      }
      return null;
    } catch (error) {
      this.logger.error(`Error extracting brand: ${error.message}`);
      return null;
    }
   }

   _extractSpecifications($) {
    try {
      const specifications = {};

      // Basic specifications extraction using selectors
      if (PRODUCT_SELECTORS.SPECS && typeof PRODUCT_SELECTORS.SPECS === 'object') {
        for (const [specKey, selector] of Object.entries(PRODUCT_SELECTORS.SPECS)) {
          const element = $(selector).first();
          if (element.length > 0) {
            const value = element.text().trim();
            if (specKey && value) {
              specifications[specKey] = value;
            }
          }
        }
      }
      
      return specifications;

    } catch (error) {
      this.logger.error(`Error extracting specifications: ${error.message}`);
      return {};
    }
   }
}

  if (require.main === module) {
    const crawler = new RelianceCrawler({
      headless: false,
      maxPages: 60,
      maxConcurrent: 1, // Reduced to prevent blocking
      maxRetries: 5,
      maxProducts: 600,
    });
  crawler
    .start()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error('Reliance crawler error:', e.message);
      process.exit(1);
    });
}

module.exports = RelianceCrawler;