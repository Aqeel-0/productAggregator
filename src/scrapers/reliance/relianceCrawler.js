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
        pagePoolSize: 8,
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
    this.categoryUrl = config.categoryUrl || 'https://www.reliancedigital.in/collection/mobiles/?page_no=1&is_available=true';
    this.checkpointFile = config.checkpointFile || path.join(__dirname, 'checkpoint.json');
    this.outputFile = config.outputFile || path.join(__dirname, 'reliance_raw.json');
    this.productLinks = [];
    this.seenUrls = new Set(); // Global deduplication set
    this.checkpoint = this.loadCheckpoint();
    
    // Restore URLs from checkpoint into the Set for deduplication
    if (this.checkpoint.productLinks && this.checkpoint.productLinks.length > 0) {
      this.productLinks = [...this.checkpoint.productLinks];
      this.checkpoint.productLinks.forEach(url => {
        this.seenUrls.add(this.normalizeRelianceProductUrl(url));
      });
    }

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
        await page.setJavaScriptEnabled(false);
        if (this.config.userAgent) await page.setUserAgent(this.config.userAgent);
        // await page.setViewport({ width: 1366, height: 768, deviceScaleFactor: 1 });
        // await page.setExtraHTTPHeaders({
        //   'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        //   'Accept-Language': 'en-US,en;q=0.9',
        //   'Cache-Control': 'no-cache'
        // });
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

      // 1) Write/append full product objects to the main output file (array of objects)
      let existingData = [];
      if (fs.existsSync(this.outputFile)) {
        const fileContent = fs.readFileSync(this.outputFile, 'utf8');
        if (fileContent) {
          try {
            const parsed = JSON.parse(fileContent);
            existingData = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.products) ? parsed.products : []);
          } catch (_) {
            existingData = [];
          }
        }
      }
      const combinedData = [...existingData, ...newData];
      fs.writeFileSync(this.outputFile, JSON.stringify(combinedData, null, 2));
    } catch (error) {
      this.logger.error(`Error saving data: ${error.message}`);
    }
  }

  async start() {
    try {
      this.logger.info('Starting Reliance crawler');
      
      // Initialize browser first - this is critical for proper page pooling
      await this.initialize();

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

  async normalizeRelianceProductUrl(href) {
    if (!href) return href;

    // Ensure absolute URL
    const absHref = href.startsWith('http')
      ? href
      : `https://www.reliancedigital.in${href}`;

    try {
      const url = new URL(absHref);

      // Remove tracking params related to "internal"
      url.searchParams.delete('internal_source');
      url.searchParams.delete('internal');
      for (const key of Array.from(url.searchParams.keys())) {
        if (key.startsWith('internal_')) url.searchParams.delete(key);
      }

      url.search = url.searchParams.toString();
      return url.toString();
    } catch {
      // String fallback if URL parsing fails
      return absHref
        .replace(/\?internal_source=search_collection$/, '')
        .replace(/([?&])internal_source=search_collection(&|$)/, (m, p1, p2) => (p1 === '?' && !p2 ? '' : p2 ? p1 : ''))
        .replace(/\?internal=.*$/, '')
        .replace(/([?&])internal=[^&]*/g, (m, p1) => (p1 === '?' ? '?' : ''))
        .replace(/[?&]$/, '');
    }
  }
  
  addUniqueUrl(rawUrl) {
    if (!rawUrl) return false;

    // Lazy-init the Set on first use
    if (!this.urlSeen) this.urlSeen = new Set();

    let url = rawUrl.trim();

    // Fast de-duplication
    if (this.urlSeen.has(url)) return false;

    this.urlSeen.add(url);
    if (!Array.isArray(this.productLinks)) this.productLinks = [];
    this.productLinks.push(url);
    return true;
  }

  // Returns the href of the first product link on the page (or null)
  async getFirstProductHref(page) {
    try {
      return await page.$eval('a[href*="/product/"]', a => a.getAttribute('href') || a.href || null);
    } catch {
      return null;
    }
  }

  // Waits for first product href to change from beforeHref
  async waitForPageAdvance(page, targetNo, beforeHref, timeoutMs = 5000) {

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

  async scrapeProductLinks() {
    let currentPage = (this.checkpoint.lastPageScraped || 0) + 1;
    const targetPages = this.maxPages;
    let newLinksAdded = 0;

    this.logger.info(`🚀 Starting Reliance link collection (Next-button only): up to ${targetPages} pages`);

    const page = await this.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1, isMobile: false });
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    );

    try {
      await page.setJavaScriptEnabled(true);

      // Always start from the base category URL
      await this.navigate(page, this.categoryUrl);

      while (currentPage <= targetPages) {
        // Rate limiting
        const rl = await this.rateLimiter.checkLimit('scraper', 'reliance');
        if (!rl.allowed) {
          const wait =
            this.rateLimiter.calculateDelay(rl, RelianceRateLimitConfig.baseDelay) +
            (Math.random() * 1500 + 500);
          await new Promise((r) => setTimeout(r, wait));
        }

        // Wait for product links to appear
        await page.waitForSelector('a[href*="/product/"]', { timeout: 15000 }).catch(() => {});
        await new Promise((r) => setTimeout(r, 500));

        // Collect and normalize product links
        const pageLinks = await page.$$eval('a[href*="/product/"]', (as) =>
          as
            .map((a) => a.getAttribute('href') || a.href || '')
            .filter(Boolean)
        );

        // Apply normalization in Node context (using the separated function)
        let pageUnique = 0;
        for (const rawHref of pageLinks) {
          const normalized = await this.normalizeRelianceProductUrl(rawHref);
          if (normalized && this.addUniqueUrl(normalized)) {
            pageUnique++;
            newLinksAdded++;
          }
        }

        if (pageLinks.length === 0) {
          this.logger.info(`✅ No products on page ${currentPage} — stopping`);
          break;
        }

        // Update checkpoints
        this.checkpoint.lastPageScraped = currentPage;
        if (!this.checkpoint.pagesScraped.includes(currentPage)) {
          this.checkpoint.pagesScraped.push(currentPage);
        }
        this.checkpoint.productLinks = this.productLinks;
        this.saveCheckpoint();

        // Respect max products if set
        if (this.maxProducts && this.productLinks.length >= this.maxProducts) {
          this.logger.info(`🎯 Target reached: ${this.productLinks.length} products`);
          break;
        }

        // Move to next page by clicking the Next button
        if (currentPage < targetPages) {
          let nextHandle = null;
        
          // Try each provided Next selector
          for (const sel of CATEGORY_SELECTORS.NEXT_PAGE) {
            await page.waitForSelector(sel, { timeout: 1200 }).catch(() => {});
            nextHandle = await page.$(sel);
            if (nextHandle) break;
          }
        
          if (!nextHandle) {
            this.logger.info(`🔚 Next button not found on page ${currentPage} — stopping`);
            break;
          }
        
          try {
            const targetNo = currentPage + 1;
            const beforeFirstHref = await this.getFirstProductHref(page);
        
            // Ensure the next button is in view to avoid overlay issues
            await page.evaluate((el) => el && el.scrollIntoView({ block: 'center' }), nextHandle);
            // Small nudge to escape sticky bars if any
            await page.evaluate(() => window.scrollBy(0, 80));
        
            // Click Next
            await nextHandle.click();
        
            // Wait for either URL page_no change or grid refresh
            await this.waitForPageAdvance(page, targetNo, beforeFirstHref, this.delayBetweenPages || 2000);
        
            // If neither URL nor grid changed, fall back to URL increment
            const pageNoAfter = new URL(page.url()).searchParams.get('page_no');
            const firstHrefAfter = await this.getFirstProductHref(page);
            const advanced =
              (pageNoAfter && Number(pageNoAfter) === targetNo) ||
              (beforeFirstHref && firstHrefAfter && beforeFirstHref !== firstHrefAfter);
        
            if (!advanced) {
              // Fallback: programmatically increment page_no
              const u = new URL(page.url());
              const now = Number(u.searchParams.get('page_no') || String(currentPage));
              u.searchParams.set('page_no', String(now));
              await this.navigate(page, u.toString());
              await page.waitForSelector('a[href*="/product/"]', { timeout: 15000 }).catch(() => {});
            }
        
            currentPage++;
            this.logger.info(`🔄 Moved to page ${currentPage}`);
          } catch (err) {
            this.logger.warn(`❌ Failed to advance via Next, attempting URL fallback: ${err.message}`);
            try {
              const u = new URL(page.url());
              const now = Number(u.searchParams.get('page_no') || String(currentPage));
              u.searchParams.set('page_no', String(now + 1));
              await this.navigate(page, u.toString());
              await page.waitForSelector('a[href*="/product/"]', { timeout: 15000 }).catch(() => {});
              currentPage++;
              this.logger.info(`🔄 Moved to page ${currentPage} (URL fallback)`);
            } catch (fallbackErr) {
              this.logger.warn(`🛑 Fallback navigation failed: ${fallbackErr.message}`);
              break;
            }
          }
        } else {
          break;
        }
      }
    } catch (err) {
      this.logger.error(`❌ Error during link collection: ${err.message}`);
      throw err;
    } finally {
      await this.returnPageToPool(page);
    }

    this.logger.info(
      `✅ Complete: ${this.productLinks.length} total (${newLinksAdded} new) across ${this.checkpoint.pagesScraped.length} pages`
    );
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
    const specifications = await this._extractSpecifications($);

    const product = {
      title,
      price: pricing,
      rating: ratingInfo,
      image,
      specifications,
      availability: 'In Stock',
      categories: 'Smartphones',  
      extractedAt: new Date().toISOString()
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
      // calculate discount in normalizer

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
      let allImages = [];
      let first = true;
      for (const selector of PRODUCT_SELECTORS.ALT_IMAGE) {
        const element = $(selector);
        element.each((_, el) => {
          const src = $(el).attr('src') || $(el).attr('data-src');
          if (src) {
            if (first) {
              mainImage = src;
              first = false;
            }
            else allImages.push(src);
          }
        });
      }
      return { mainImage, allImages };
    } catch (error) {
      this.logger.error(`Error extracting image: ${error.message}`);
      return null;
    }
   }

   async _extractSpecifications($) {
    try {
      const specifications = {};

      // Basic specifications extraction using selectors
      $('.specifications-header').each((_, header) => {
        const sectionTitle = $(header).text().trim();
        if (!sectionTitle) return;
  
        const sectionSpecs = {};
  
        // Find the sibling <ul> after the header
        const $ul = $(header).next('ul');
  
        // Each spec row
        $ul.find('.specifications-list').each((_, li) => {
          const label = $(li).find('span').first().text().trim();
          const value = $(li).find('.specifications-list--right ul').text().trim();
  
          if (label && value) {
            sectionSpecs[label] = value;
          }
        });
  
        if (Object.keys(sectionSpecs).length > 0) {
          specifications[sectionTitle] = sectionSpecs;
        }
      });
      
      return specifications;

    } catch (error) {
      this.logger.error(`Error extracting specifications: ${error.message}`);
      return {};
    }
   }
}

  if (require.main === module) {
    const crawler = new RelianceCrawler({
      headless: true,
      maxPages: 60,
      maxConcurrent: 1, // Reduced to prevent blocking
      maxRetries: 1,
      maxProducts: 800,
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