const fs = require('fs');
const path = require('path');
const BaseCrawler = require('../../base-crawler');
const { CATEGORY_SELECTORS, PRODUCT_SELECTORS, ERROR_INDICATORS } = require('./croma-selectors');
const RateLimiter = require('../../../rate-limiter/RateLimiter');
const CromaRateLimitConfig = require('../../../rate-limiter/configs/croma-config');
const cheerio = require('cheerio');
const Logger = require('../../../utils/logger');

class ChromeCrawler extends BaseCrawler {
  constructor(config = {}) {
    const defaultConfig = {
      headless: config.headless !== undefined ? config.headless : false,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: {
        width: 1366,
        height: 768,
        deviceScaleFactor: 1
      },
      proxyConfig: {
        useProxy: false
      },
      maxProducts: 5,
      memoryManagement: {
        enabled: true,
        maxMemoryMB: 1536,
        maxPages: 4, // Match FlipkartCrawler proven config
        pagePoolSize: 10, // Match FlipkartCrawler proven config  
        cleanupInterval: 45000,
        forceGCInterval: 180000,
        memoryCheckInterval: 20000,
      },
      ...config
    };
    super({ ...defaultConfig, ...config });

    // Initialize logger for this scraper
    this.logger = new Logger('CROMA');

    // Initialize rate limiter
    this.rateLimiter = new RateLimiter({
      redis: { enabled: false },
      defaultAlgorithm: CromaRateLimitConfig.algorithm,
      cleanupInterval: 60000
    });
    
    // Register Croma-specific rules
    this.rateLimiter.registerRules('croma', CromaRateLimitConfig);

    // Configuration
    this.categoryUrl = config.categoryUrl || 'https://www.croma.com/phones-wearables/c/1?q=%3Arelevance%3Alower_categories%3A95%3Alower_categories%3A97';
    
    // Create separate directories for checkpoints and raw data
    const checkpointDir = path.join(__dirname, '..', 'checkpoints');
    const rawDataDir = path.join(__dirname, '..', 'raw_data');
    
    // Ensure directories exist
    this.ensureDirectory(checkpointDir);
    this.ensureDirectory(rawDataDir);
    
    // Dynamic file paths
    this.checkpointFile = config.checkpointFile || path.join(checkpointDir, 'croma_mobile_checkpoint.json');
    this.outputFile = config.outputFile || path.join(rawDataDir, 'croma_mobile_scraped_data.json');
    
    // Multi-page scraping configuration
    this.maxProducts = config.maxProducts || null;
    this.maxConcurrent = config.maxConcurrent || 2;
    this.maxRetries = config.maxRetries || 3;
    
    // Page-level configuration
    this.productsPerPage = config.productsPerPage || 12;
    this.delayBetweenPages = config.delayBetweenPages || 3000;

    // Load checkpoint
    this.checkpoint = this.loadCheckpoint();
    this.productLinks = this.checkpoint.productLinks || [];
    this.seenUrls = new Set(); // Global deduplication set
    
    // Ensure checkpoint has the required structure
    if (!this.checkpoint.productLinks) {
      this.checkpoint.productLinks = [];
    }
    
    // Restore URLs from checkpoint into the Set for deduplication
    if (this.productLinks.length > 0) {
      this.productLinks.forEach(url => {
        this.seenUrls.add(this.normalizeCromaUrl(url));
      });
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

  async newPage() {
    const page = await super.newPage();
    
    // Configure viewport to emulate 24-inch monitor (1920x1080)
    // await page.setViewport({
    //   width: 1920,
    //   height: 1080,
    //   deviceScaleFactor: 1,
    //   isMobile: false,
    //   hasTouch: false,
    //   isLandscape: true
    // });
  
    return page;
  }

  /**
   * Ensure directory exists
   */
  ensureDirectory(dir) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      this.logger.info(`Created directory: ${dir}`);
    }
  }

  async navigate(page, url) {
    try {
      await page.goto(url, { 
        waitUntil: 'domcontentloaded', 
        timeout: 45000 
      });

      await page.waitForTimeout(2000);

      try {
        await page.waitForSelector('body', { timeout: 10000 });
        this.logger.debug('Page body loaded successfully');
      } catch (error) {
        this.logger.warn('Body selector not found, continuing anyway');
      }

      await page.evaluate(() => {
        return new Promise((resolve) => {
          if (document.readyState === 'complete') {
            resolve();
          } else {
            window.addEventListener('load', resolve);
          }
        });
      });

      this.logger.debug('Navigation completed successfully');
    } catch (error) {
      this.logger.error(`Navigation failed: ${error.message}`);
      throw error;
    }
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
      lastRunTimestamp: null
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
      // Enhanced URL normalization for Croma
      const fullUrl = url.startsWith('http') ? url : `https://www.croma.com${url}`;
      const u = new URL(fullUrl);
      u.hash = '';
      // Remove query parameters for better deduplication
      u.search = '';
      u.hostname = u.hostname.toLowerCase();
      // Remove trailing slash
      if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
        u.pathname = u.pathname.slice(0, -1);
      }
      return u.toString();
    } catch (error) {
      return url;
    }
  }

  // Add URL to global set with normalization
  addUniqueUrl(url) {
    const normalized = this.normalizeCromaUrl(url);
    if (!this.seenUrls.has(normalized)) {
      this.seenUrls.add(normalized);
      this.productLinks.push(normalized);
      return true; // Added
    }
    return false; // Duplicate
  }

  saveData(data) {
    try {
      let existingData = [];
      if (fs.existsSync(this.outputFile)) {
        const fileContent = fs.readFileSync(this.outputFile, 'utf8');
        if (fileContent) {
          existingData = JSON.parse(fileContent);
        }
      }
      
      const newData = Array.isArray(data) ? data : [data];
      
      // Create a normalized URL-based deduplication map
      const existingUrls = new Set();
      existingData.forEach(product => {
        if (product.url) {
          const normalizedUrl = this.normalizeCromaUrl(product.url);
          existingUrls.add(normalizedUrl);
        }
      });
      
      // Filter out products with normalized URLs that already exist
      const uniqueNewData = newData.filter(product => {
        if (!product.url) return true;
        const normalizedUrl = this.normalizeCromaUrl(product.url);
        if (existingUrls.has(normalizedUrl)) {
          this.logger.debug(`🔄 Skipping duplicate URL: ${normalizedUrl.substring(50)}`);
          return false;
        }
        existingUrls.add(normalizedUrl);
        return true;
      });
      
      const combinedData = [...existingData, ...uniqueNewData];
      
      fs.writeFileSync(this.outputFile, JSON.stringify(combinedData, null, 2));
      this.logger.info(`💾 Saved ${uniqueNewData.length}/${newData.length} products (filtered ${newData.length - uniqueNewData.length} duplicates) | Total: ${combinedData.length}`);
    } catch (error) {
      this.logger.error(`Error saving data: ${error.message}`);
    }
  }

  getCurrentDataCount() {
    try {
      if (fs.existsSync(this.outputFile)) {
        const fileContent = fs.readFileSync(this.outputFile, 'utf8');
        if (fileContent) {
          const parsed = JSON.parse(fileContent);
          if (Array.isArray(parsed)) return parsed.length;
          if (parsed && Array.isArray(parsed.products)) return parsed.products.length;
        }
      }
    } catch (error) {
      this.logger.error(`Error reading current data count: ${error.message}`);
    }
    return 0;
  }

  async start() {
    // Set the expected total count for progress tracking, not the actual collected links
    const expectedTotal = this.maxProducts || 1000;
    const currentDataCount = this.getCurrentDataCount();
    this.logger.startScraper('croma', expectedTotal, currentDataCount);

    try {
      // Initialize browser first - prevents multiple browser instances under concurrency
      await this.initialize();

      if (this.checkpoint.productLinks.length === 0) {
        await this.scrapeProductLinks();
        this.saveCheckpoint();
      } else {
        this.productLinks = this.checkpoint.productLinks;
        this.logger.info(`Resuming: ${this.productLinks.length} products from checkpoint`);
      }

      // Update logger with expected total and current processed for progress tracking
      this.logger.setTotalCount(expectedTotal, currentDataCount);

      await this.scrapeProductDetails();
      
      // Retry failed products if any
      if (this.checkpoint.failedProducts.length > 0) {
        this.logger.info(`Retrying ${this.checkpoint.failedProducts.length} failed products`);
        await this.retryFailedProducts();
      }
      
      this.logger.completeScraper();
      
      await this.shutdown();
      
    } catch (error) {
      this.logger.error(`Error during crawling: ${error.message}`);
      
      const errorMemory = this.getMemoryStats();
      this.logger.error(`Memory stats at error: ${JSON.stringify(errorMemory)}`);
      
      this.saveCheckpoint();
      await this.shutdown();
      throw error;
    }
  }

  async shutdown() {
    try {
      if (this.rateLimiter && typeof this.rateLimiter.close === 'function') {
        await this.rateLimiter.close();
        this.logger.debug('Rate limiter closed');
      }
      
      await this.close();
      
      const highestIntervalId = setTimeout(() => {}, 0);
      for (let i = 0; i < highestIntervalId; i++) {
        clearTimeout(i);
        clearInterval(i);
      }
      
      if (global.gc) {
        global.gc();
        this.logger.debug('Final garbage collection performed');
      }
      
      setTimeout(() => {
        process.exit(0);
      }, 2000);
      
    } catch (error) {
      this.logger.error(`Error during shutdown: ${error.message}`);
      setTimeout(() => {
        process.exit(1);
      }, 3000);
    }
  }


  async scrapeProductLinks() {
    let newLinksAdded = 0;
    this.logger.info('🚀 Starting Croma scraping with simplified global Set deduplication');
    
    const page = await this.newPage();
    
    try {
      await page.setJavaScriptEnabled(true);
      await this.navigate(page, this.categoryUrl);
      await this.checkForErrors(page);
      await page.waitForSelector('body', { timeout: 15000 });
      
      // Keep clicking "View More" until we have enough links
      let totalClickCount = 0;
      const productsPerPage = 20;
      const maxTotalClicks = this.maxProducts ? 
        Math.max(0, Math.ceil((this.maxProducts - productsPerPage) / productsPerPage)) : 
        20; // Default to 20 if no maxProducts set
      
      this.logger.info(`🎯 Target: ${this.maxProducts || 'unlimited'} products | Required clicks: ${maxTotalClicks}`);
      
      // Click "View More" button exactly maxTotalClicks times
      while (totalClickCount < maxTotalClicks) {
        let viewMoreButton = null;
        for (const selector of CATEGORY_SELECTORS.VIEW_MORE_BUTTON) {
          try {
            await page.waitForSelector(selector, { timeout: 3000 }).catch(() => {});
            viewMoreButton = await page.$(selector);
            if (viewMoreButton) break;
          } catch (error) {
            continue;
          }
        }
        
        if (!viewMoreButton) {
          this.logger.info(`🔍 No "View More" button found after ${totalClickCount} clicks`);
          break;
        }
        
        const isClickable = await page.evaluate((button) => {
          return button && !button.disabled && button.offsetParent !== null;
        }, viewMoreButton);
        
        if (!isClickable) {
          this.logger.info(`⚠️ View More button not clickable after ${totalClickCount} clicks`);
          break;
        }
        
        try {
          await page.evaluate((button) => {
            button.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, viewMoreButton);
          await page.waitForTimeout(300);
          await viewMoreButton.click();
          totalClickCount++;
          this.logger.info(`🔄 Clicked "View More" (${totalClickCount}/${maxTotalClicks})`);
          await page.waitForTimeout(1500);
        } catch (error) {
          this.logger.error(`❌ Error clicking View More: ${error.message}`);
          break;
        }
      }
      
      // Extract all product links from the fully loaded page
      this.logger.info('🔗 Extracting all product links with global deduplication');
      
      const rawLinks = await page.evaluate((selectors) => {
        const links = [];
        
        // Extract raw links without normalization (done in addUniqueUrl)
        for (const selector of selectors.PRODUCT_LINK) {
          const linkElements = document.querySelectorAll(selector);
          linkElements.forEach(element => {
            const href = element.href || element.getAttribute('href');
            if (href) {
              const absoluteUrl = href.startsWith('http') ? href : `https://www.croma.com${href}`;
              links.push(absoluteUrl);
            }
          });
          
          if (links.length > 0) break; // Use first successful selector
        }
        
        return links;
      }, CATEGORY_SELECTORS);
      
      // Add links using global Set deduplication
      let uniqueCount = 0;
      rawLinks.forEach(link => {
        if (this.addUniqueUrl(link)) {
          uniqueCount++;
          newLinksAdded++;
        }
      });
      
      this.logger.info(`📋 Found ${rawLinks.length} raw links, ${uniqueCount} unique | Total: ${this.productLinks.length}`);
      
      // Log sample links
      if (this.productLinks.length > 0) {
        this.logger.info('🔗 Sample links:');
        this.productLinks.slice(0, 5).forEach((link, i) => {
          this.logger.info(`  ${i + 1}. ${link}`);
        });
      }
      
      // Update checkpoint
      this.checkpoint.productLinks = this.productLinks;
      this.checkpoint.lastPageScraped = 1;
      this.checkpoint.pagesScraped = [1];
      this.saveCheckpoint();
      
    } catch (error) {
      this.logger.error(`❌ Error scraping product links: ${error.message}`);
      await this.safeClosePage(page);
      throw error;
    } finally {
      await this.returnPageToPool(page);
    }
    
    this.logger.info(`✅ Croma link collection complete: ${this.productLinks.length} total products (${newLinksAdded} new)`);
  }

  async scrapeProductDetails() {
    const startIndex = this.checkpoint.lastProcessedIndex + 1;
    // Process only up to maxProducts if specified, otherwise process all collected links
    const endIndex = this.maxProducts ? Math.min(this.productLinks.length, this.maxProducts) : this.productLinks.length;
    
    this.logger.info(`🔍 Processing products ${startIndex + 1}-${endIndex} of ${this.productLinks.length} total (${this.maxConcurrent} concurrent)`);
    
    const results = [];
    const concurrent = Math.min(this.maxConcurrent, endIndex - startIndex);
    
    for (let i = startIndex; i < endIndex; i += concurrent) {
      const batchEnd = Math.min(i + concurrent, endIndex);
      const batchPromises = [];
      
      for (let j = i; j < batchEnd; j++) {
        const url = this.productLinks[j];
        batchPromises.push(this.processProductWithRetry(url, j));
      }
      
      const batchResults = await Promise.allSettled(batchPromises);
      
      for (let k = 0; k < batchResults.length; k++) {
        const result = batchResults[k];
        const index = i + k;
        
        if (result.status === 'fulfilled' && result.value) {
          results.push(result.value);
          this.checkpoint.lastProcessedIndex = index;
        } else {
          const errorMessage = result.reason && result.reason.message ? result.reason.message : (result.reason || 'Unknown error');
          this.logger.error(`Failed to process product at index ${index}: ${errorMessage}`);
          this.checkpoint.failedProducts.push({
            index,
            url: this.productLinks[index],
            error: errorMessage,
            timestamp: new Date().toISOString()
          });
        }
      }
      
      this.saveCheckpoint();
      
      if (results.length >= 5 || i + concurrent >= endIndex) {
        if (results.length > 0) {
          this.saveData(results);
          results.length = 0;
        }
      }
      
      if (i + concurrent < endIndex) {
        const delayMs = Math.random() * 2000 + 1000;
        this.logger.debug(`Batch delay: ${delayMs}ms`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    
    this.logger.info(`✅ Completed batch: ${results.length} products processed | Failed: ${this.checkpoint.failedProducts.length}`);
  }

  async processProductWithRetry(url, index) {
    let lastError;
    
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const rateLimitResult = await this.rateLimiter.checkLimit('scraper', 'croma');
        if (!rateLimitResult.allowed) {
          const delayMs = this.rateLimiter.calculateDelay(rateLimitResult);
          this.logger.rateLimit(delayMs);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }
        
        const productData = await this._scrapeProductDetail(url);
        
        // Update progress
        this.logger.updateProgress();
        
        const delayMs = this.rateLimiter.calculateDelay(rateLimitResult, CromaRateLimitConfig.baseDelay);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        
        return productData;
        
      } catch (error) {
        lastError = error;
        this.logger.productError(index, error.message);
        
        if (attempt < this.maxRetries) {
          const backoffMs = Math.pow(2, attempt) * 1000;
          await new Promise(resolve => setTimeout(resolve, backoffMs));
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
      
      await this.checkForErrors(page);
      
      const productData = await this._extractAllProductData(page);
      
      await this.returnPageToPool(page);
      return { url, ...productData };
      
    } catch (error) {
      await this.safeClosePage(page);
      throw error;
    }
  }

  async checkForErrors(page) {
    try {
      const hasError = await page.evaluate((errorSelectors) => {
        const checkSelector = (selector) => {
          return document.querySelector(selector) !== null;
        };
        
        for (const sel of (errorSelectors.CAPTCHA || [])) {
          if (checkSelector(sel)) return { type: 'CAPTCHA', sel };
        }
        
        for (const sel of (errorSelectors.ACCESS_DENIED || [])) {
          if (checkSelector(sel)) return { type: 'ACCESS_DENIED', sel };
        }
        
        for (const sel of (errorSelectors.NOT_FOUND || [])) {
          if (checkSelector(sel)) return { type: 'NOT_FOUND', sel };
        }
        
        return null;
      }, ERROR_INDICATORS);
      
      if (hasError) {
        throw new Error(`Page error detected: ${hasError.type}`);
      }
    } catch (error) {
      if (error.message.includes('Page error detected')) {
        throw error;
      }
    }
  }

  async _extractAllProductData(page) {
    try {    
      // Get HTML ONCE after all page interactions are done
      const html = await page.content();
      const $ = cheerio.load(html);
      
      const title = await this._extractTitle($);
      //const productName = await this._extractProductName($);
      const pricing = await this._extractPricing($);
      const rating = await this._extractRating($);
      const images = await this._extractImages($);
      //const availability = await this._extractAvailability($);
      const specifications = await this._extractSpecifications($); // No page parameter
      const categories = 'Smartphones'
      
      //const finalCategories = categories.length === 0 ? this._getDefaultCategories(title) : categories;
      
      return {
        title,
        //productName,
        price: pricing,
        rating,
        image: images.main,
        allImages: images.all,
        //availability,
        specifications,
        categories,
        extractedAt: new Date().toISOString()
      };
      
    } catch (error) {
      this.logger.error(`Error extracting product data: ${error.message}`);
      return {
        title: null,
        price: { current: null, original: null, discount: null },
        rating: { value: null, count: null },
        image: null,
        availability: null,
        specifications: {},
        categories: [],
        extractedAt: new Date().toISOString(),
        error: error.message
      };
    }
  }

  _getDefaultCategories(title) {
    const categories = [];
    if (title) {
      const titleLower = title.toLowerCase();
      if (titleLower.includes('phone') || 
          titleLower.includes('mobile') || 
          titleLower.includes('smartphone')) {
        categories.push('Electronics');
        categories.push('Mobile Phones');
      } else if (titleLower.includes('laptop') || 
                 titleLower.includes('computer') ||
                 titleLower.includes('tablet')) {
        categories.push('Electronics');
        categories.push('Computers');
      } else {
        categories.push('Electronics');
      }
    }
    return categories;
  }

  async _extractTitle($) {
    try {
      const title = $('h1.pd-title').text().trim();
      
      if (title) {
        return title.replace(/\s+/g, ' ').trim();
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
        current: null,
        original: null,
        discount: null
      };

      const currentElement = $('span#pdp-product-price').first();
      if (currentElement.length > 0 && currentElement.text().trim()) {
        const priceText = currentElement.text().trim();
        if (priceText.includes('₹')) {
          const cleanPrice = priceText.split('₹')[1]?.split('₹')[0]?.trim();
          if (cleanPrice && cleanPrice.match(/^\d{1,3}(,\d{3})*(\.\d{2})?$/)) {
            pricing.current = '₹' + cleanPrice;
          }
        } else {
          pricing.current = priceText;
        }
      }
      
      
     
      const originalElement = $('span#old-price').first();
      if (originalElement.length > 0 && originalElement.text().trim()) {
        const originalText = originalElement.text().trim();
        if (originalText.includes('₹')) {
          const cleanPrice = originalText.split('₹')[1]?.split('₹')[0]?.trim();
          if (cleanPrice && cleanPrice.match(/^\d{1,3}(,\d{3})*(\.\d{2})?$/)) {
            pricing.original = '₹' + cleanPrice;
          }
        } else {
          pricing.original = originalText;
        }
      }
      
      
      // Calculate discount if both current and original prices are present and not null
      if (pricing.current !== null && pricing.original !== null) {
        // Remove currency symbols and commas for calculation
        const cleanCurrent = parseFloat(pricing.current.replace(/[^\d.]/g, '').replace(/,/g, ''));
        const cleanOriginal = parseFloat(pricing.original.replace(/[^\d.]/g, '').replace(/,/g, ''));
        if (!isNaN(cleanCurrent) && !isNaN(cleanOriginal) && cleanOriginal > 0 && cleanCurrent < cleanOriginal) {
          const discountPercent = Math.round(((cleanOriginal - cleanCurrent) / cleanOriginal) * 100);
          pricing.discount = discountPercent + '%';
        }
      }

      return pricing;
    } catch (error) {
      this.logger.error(`Error extracting pricing: ${error.message}`);
      return { current: null, original: null, discount: null };
    }
  }

  async _extractRating($) {
    try {
      let star = null;
      let rating = null;
      let reviews = null;
  
      // Get the review text from the <a>
      const reviewText = $('a.pr-review.review-text').text().trim();
  
      if (/^Be\s+the\s+First\s+One\s+to\s+Review$/i.test(reviewText)) {
        // No reviews case
        star = 'Not Available';
        rating = 'Not Available';
        reviews = 'Not Available';
      } else {
        // Get the star rating (first <span> before star image)
        const starText = $('.cp-rating span span').first().text().trim();
        if (starText) {
          star = starText;
        }
  
        // Extract ratings count
        const ratingMatch = reviewText.match(/([\d,]+)\s+Ratings?/i);
        if (ratingMatch) {
          rating = ratingMatch[1].replace(/,/g, '');
        }
  
        // Extract reviews count
        const reviewsMatch = reviewText.match(/([\d,]+)\s+Reviews?/i);
        if (reviewsMatch) {
          reviews = reviewsMatch[1].replace(/,/g, '');
        }
      }
      return { star, rating, reviews };
  
    } catch (error) {
      console.error(`Error extracting rating data: ${error.message}`);
      return {
        star: 'Not Available',
        rating: 'Not Available',
        reviews: 'Not Available'
      };
    }
  }

  async _extractImages($) {
    try {
      const imageUrls = [];
      $('.gallery-thumbs img, .gallery-top img').each((_, img) => {
        const $img = $(img);
        // Prefer data-src if available (often higher resolution), else fall back to src
        const url = $img.attr('data-src') || $img.attr('src');
        
        if (url) {
            imageUrls.push(url);
        }
        });
      const mainImage = imageUrls[0];
      const allImages = imageUrls.slice(1, imageUrls.length);
      return {
        main: mainImage,
        all: allImages
      };
      } catch (error) {
      this.logger.error(`Error extracting images: ${error.message}`);
      return { main: null, all: [] };
    }
  }

  async _extractAvailability($) {
    try {
      
      for (const selector of PRODUCT_SELECTORS.AVAILABILITY) {
        const element = $(selector).first();
        if (element.length > 0 && element.text().trim()) {
          return element.text().trim();
        }
      }
      
      return null;
    } catch (error) {
      this.logger.error(`Error extracting availability: ${error.message}`);
      return null;
    }
  }

  async _extractSpecifications($) {
    try {
      const specifications = {};

      // Extract specifications from the already-loaded HTML
      $('#specification_container .cp-specification-info').each((_, section) => {
        const $section = $(section);
      
        // Get the section/category title
        const sectionTitle = $section.find('h3.title').first().text().trim();
      
        // Skip if no section title (outlier elements)
        if (!sectionTitle) return;
      
        // Collect all spec info pairs in this section
        const specs = {};
      
        // Each group of pairs is in <ul class="cp-specification-spec-info">
        $section.find('ul.cp-specification-spec-info').each((_, group) => {
          const $group = $(group);
          // The actual pair is in a <div>, with a title and a value
          $group.find('div').each((_, div) => {
            const $div = $(div);
      
            // Get the spec field name and value
            const name = $div.find('.cp-specification-spec-title h4').first().text().replace(/\s+/g, ' ').trim();
            const value = $div.find('.cp-specification-spec-details').first().text().replace(/\s+/g, ' ').trim();
      
            if (name && value) {
              specs[name] = value;
            }
          });
        });
      
        if (Object.keys(specs).length) {
          specifications[sectionTitle] = specs;
        }
      });
      
      return specifications;

    } catch (error) {
      this.logger.error(`Error extracting specifications: ${error.message}`);
      return {};
    }
  }

  async _extractCategories($) {
    try {
      const categories = [];
      
      const breadcrumbSelectors = [
        '.breadcrumb a',
        '.breadcrumbs a',
        'nav[aria-label="Breadcrumb"] a',
        '[data-testid="breadcrumbs-list"] a'
      ];
      
      for (const selector of breadcrumbSelectors) {
        const elements = $(selector);
        if (elements.length > 0) {
          elements.each((_, element) => {
        const categoryText = $(element).text().trim();
            if (categoryText && categoryText.length > 1 && !categoryText.includes('›') && !categoryText.includes('...')) {
          categories.push(categoryText);
        }
      });
          if (categories.length > 0) break;
        }
      }

      return categories;
    } catch (error) {
      this.logger.error(`Error extracting categories: ${error.message}`);
      return [];
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
          this.saveData(results);
          results.length = 0;
        }
      } catch (error) {
        const errorMessage = error && error.message ? error.message : 'Unknown error';
        this.logger.error(`Retry failed for ${failedProduct.url}: ${errorMessage}`);
        this.checkpoint.failedProducts.push({
          ...failedProduct,
          retryAttempts: (failedProduct.retryAttempts || 0) + 1
        });
      }
    }
    
    if (results.length > 0) {
      this.saveData(results);
    }
    
    this.saveCheckpoint();
  }
}

// Run the crawler if this script is executed directly
if (require.main === module) {
  const crawler = new ChromeCrawler({
    headless: true,
    proxyConfig: {
      useProxy: false
    },
    maxProducts: 5, // Limit to 5 products for testing
    maxConcurrent: 6, // Reduced to match page pool size
    delayBetweenPages: 3000
  });
  
  crawler.start().catch(error => {
    console.error('Crawler failed:', error);
    process.exit(1);
  });
}

module.exports = ChromeCrawler;