const fs = require('fs');
const path = require('path');
const BaseCrawler = require('../../base-crawler');
const cheerio = require('cheerio');
const { CATEGORY_SELECTORS, PRODUCT_SELECTORS } = require('./reliance-selectors');
const RateLimiter = require('../../../rate-limiter/RateLimiter');
const RelianceRateLimitConfig = require('../../../rate-limiter/configs/reliance-config');
const Logger = require('../../../utils/logger');

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

    // Initialize logger for this scraper
    this.logger = new Logger('RELIANCE');

    // Configuration
    this.category = config.category || 'mobile';
    this.categoryUrl = config.categoryUrl || 'https://www.reliancedigital.in/collection/mobiles/?page_no=1&is_available=true';
    
    // Create separate directories for checkpoints and raw data
    const checkpointDir = path.join(__dirname, '..', 'checkpoints');
    const rawDataDir = path.join(__dirname, '..', 'raw_data');
    
    // Ensure directories exist
    this.ensureDirectory(checkpointDir);
    this.ensureDirectory(rawDataDir);
    
    // Dynamic file paths
    this.checkpointFile = config.checkpointFile || path.join(checkpointDir, 'reliance_mobile_checkpoint.json');
    this.outputFile = config.outputFile || path.join(rawDataDir, 'reliance_mobile_scraped_data.json');
    this.productLinks = [];
    this.seenUrls = new Set(); // Global deduplication set
    this.checkpoint = super.loadCheckpoint(this.checkpointFile);
    
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

  // ensureDirectory() moved to BaseCrawler

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

  // loadCheckpoint() and saveCheckpoint() moved to BaseCrawler

  // saveData() and getCurrentDataCount() moved to BaseCrawler

  async start() {
    // Set the expected total count for progress tracking, not the actual collected links
    const expectedTotal = this.maxProducts || (this.maxPages * this.productsPerPage);
    const currentDataCount = super.getCurrentDataCount(this.outputFile);
    this.logger.startScraper('reliance', expectedTotal, currentDataCount);

    try {
      // Initialize browser first - this is critical for proper page pooling
      await this.initialize();

      if (this.checkpoint.productLinks.length === 0) {
        await this.scrapeProductLinks();
        super.saveCheckpoint(this.checkpoint, this.checkpointFile);
      } else {
        this.productLinks = this.checkpoint.productLinks;
        this.logger.info(`Loaded ${this.productLinks.length} product links from checkpoint`);
      }

      // Update logger with expected total for progress tracking
      this.logger.setTotalCount(expectedTotal, currentDataCount);

      await this.scrapeProductDetails();

      this.logger.completeScraper();
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
  
  // addUniqueUrl() moved to BaseCrawler (using seenUrls instead of urlSeen)

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
    const initialLinkCount = this.productLinks.length;

    this.logger.info(`🚀 Starting Reliance: Pages ${currentPage}-${targetPages} | Target: ${this.maxProducts || 'ALL'} products | Starting with ${initialLinkCount} existing links`);
    this.logger.info(`📍 Using URL: ${this.categoryUrl}`);

    const page = await this.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1, isMobile: false });
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    );

    try {
      await page.setJavaScriptEnabled(true);

      // Clear cookies and set consistent headers to avoid session issues
      await page.deleteCookie();
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

      // Always start from the base category URL with proper wait
      this.logger.info(`🌐 Navigating to: ${this.categoryUrl}`);
      await this.navigate(page, this.categoryUrl);
      
      // Wait for page to fully load and verify we're on the right page
      // Wait for network to be idle (Puppeteer method)
      await page.waitForNetworkIdle({ timeout: 10000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 2000)); // Additional wait for dynamic content

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
        await new Promise((r) => setTimeout(r, 1000)); // Increased wait for stability

        // Verify we're on the correct page by checking URL and content
        const currentUrl = page.url();
        const pageTitle = await page.title();
        this.logger.info(`🔍 Page ${currentPage}: URL="${currentUrl.substring(0, 80)}..." | Title="${pageTitle.substring(0, 40)}..."`);

        // Check if we're on a valid product listing page
        if (currentUrl.includes('no-search-results') || currentUrl.includes('error') || !currentUrl.includes('products')) {
          this.logger.warn(`⚠️ Page ${currentPage}: Invalid page detected - ${currentUrl}`);
          break;
        }

        // Collect and normalize product links
        const pageLinks = await page.$$eval('a[href*="/product/"]', (as) =>
          as
            .map((a) => a.getAttribute('href') || a.href || '')
            .filter(Boolean)
        );

        // Apply normalization in Node context (using the separated function)
        let pageUnique = 0;
        let pageDuplicates = 0;
        for (const rawHref of pageLinks) {
          const normalized = await this.normalizeRelianceProductUrl(rawHref);
          if (normalized) {
            if (super.addUniqueUrl(normalized, this.seenUrls, this.productLinks, (url) => url)) {
              pageUnique++;
              newLinksAdded++;
            } else {
              pageDuplicates++;
            }
          }
        }

        this.logger.info(`📄 Page ${currentPage}: Found ${pageLinks.length} links, ${pageUnique} unique, ${pageDuplicates} duplicates | Total: ${this.productLinks.length}`);

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
        super.saveCheckpoint(this.checkpoint, this.checkpointFile);

        // Respect max products if set
        if (this.maxProducts && this.productLinks.length >= this.maxProducts) {
          this.logger.info(`🎯 Target reached: ${this.productLinks.length}/${this.maxProducts} products - stopping pagination`);
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
        
            // Verify page navigation was successful
            const pageNoAfter = new URL(page.url()).searchParams.get('page_no');
            const firstHrefAfter = await this.getFirstProductHref(page);
            const advanced =
              (pageNoAfter && Number(pageNoAfter) === targetNo) ||
              (beforeFirstHref && firstHrefAfter && beforeFirstHref !== firstHrefAfter);
        
            if (!advanced) {
              // Fallback: programmatically increment page_no with proper URL construction
              const u = new URL(this.categoryUrl);
              u.searchParams.set('page_no', String(targetNo));
              this.logger.info(`🔄 Fallback navigation to: ${u.toString()}`);
              await this.navigate(page, u.toString());
              await page.waitForNetworkIdle({ timeout: 10000 }).catch(() => {});
              await page.waitForSelector('a[href*="/product/"]', { timeout: 15000 }).catch(() => {});
            }
        
            currentPage++;
            this.logger.info(`🔄 Moved to page ${currentPage}`);
          } catch (err) {
            this.logger.warn(`❌ Failed to advance via Next, attempting URL fallback: ${err.message}`);
            try {
              // Use the original category URL as base for consistent navigation
              const u = new URL(this.categoryUrl);
              u.searchParams.set('page_no', String(currentPage + 1));
              this.logger.info(`🔄 URL fallback navigation to: ${u.toString()}`);
              await this.navigate(page, u.toString());
              await page.waitForNetworkIdle({ timeout: 10000 }).catch(() => {});
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

    const totalDuplicates = (this.checkpoint.pagesScraped.length * 24) - this.productLinks.length; // Estimate duplicates
    this.logger.info(
      `✅ Link collection complete: ${this.productLinks.length} total links (${newLinksAdded} new, ~${totalDuplicates} duplicates filtered) across ${this.checkpoint.pagesScraped.length} pages`
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

      super.saveCheckpoint(this.checkpoint, this.checkpointFile);
      if (results.length > 0) {
        super.saveData(results, this.outputFile, null);
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
          this.logger.rateLimit(wait);
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
        const product = await this._scrapeProductDetail(url);
        
        // Update progress
        this.logger.updateProgress();
        
        const delayMs = this.rateLimiter.calculateDelay(rate, RelianceRateLimitConfig.baseDelay);
        // Add extra random delay to be more respectful
        const extraDelay = Math.random() * 2000 + 1000; // 1-3 seconds extra
        await new Promise((r) => setTimeout(r, delayMs + extraDelay));
        return product;
      } catch (err) {
        lastError = err;
        this.logger.productError(index, err.message);
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
  async shutdown() {
    await super.gracefulShutdown(() => {
      setTimeout(() => {
        process.exit(0);
      }, 2000);
    });
  }
}

  if (require.main === module) {
    const crawler = new RelianceCrawler({
      headless: true,
      maxPages: 60,
      maxConcurrent: 1, // Reduced to prevent blocking
      maxRetries: 1,
      maxProducts: 5, // Limit to 5 products for testing
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
