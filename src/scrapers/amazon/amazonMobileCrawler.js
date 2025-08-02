const fs = require('fs');
const path = require('path');
const BaseCrawler = require('../base-crawler');
const { CATEGORY_SELECTORS, PRODUCT_SELECTORS, ERROR_INDICATORS } = require('./amazon-selectors');
const RateLimiter = require('../../rate-limiter/RateLimiter');
const AmazonRateLimitConfig = require('../../rate-limiter/configs/amazon-config');
const cheerio = require('cheerio'); // Added for Cheerio

class AmazonDetailCrawler extends BaseCrawler {
  constructor(config = {}) {
    const memoryConfig = {
      headless: config.headless !== undefined ? config.headless : false, // Changed to false for debugging
      memoryManagement: {
        enabled: true,
        maxMemoryMB: 1536, // 1.5GB for Amazon (more generous)
        maxPages: 3, // Conservative for Amazon
        pagePoolSize: 2, // Small pool for Amazon
        cleanupInterval: 45000, // 45 seconds
        forceGCInterval: 180000, // 3 minutes
        memoryCheckInterval: 20000, // 20 seconds
      },
      ...config
    };
    super(memoryConfig);

    // Initialize rate limiter
    this.rateLimiter = new RateLimiter({
      redis: { enabled: false }, // Use memory-based for simplicity
      defaultAlgorithm: AmazonRateLimitConfig.algorithm,
      cleanupInterval: 60000
    });
    
    // Register Amazon-specific rules
    this.rateLimiter.registerRules('amazon', AmazonRateLimitConfig);

    // Configuration
    this.categoryUrl = config.categoryUrl || 'https://www.amazon.in/s?i=electronics&rh=n%3A1389432031&s=popularity-rank&fs=true&page=1';
    this.outputFile = config.outputFile || path.join(__dirname, 'amazon_scraped_data.json');
    this.checkpointFile = config.checkpointFile || path.join(__dirname, 'checkpoint.json');
    
    // Multi-page scraping configuration
    this.maxProducts = config.maxProducts || null; // If null, uses maxPages instead
    this.maxPages = config.maxPages || 3; // Default: scrape 3 pages
    this.maxConcurrent = config.maxConcurrent || 1;
    this.maxRetries = config.maxRetries || 3;
    
    // Page-level configuration
    this.productsPerPage = config.productsPerPage || 16; // Amazon typically shows 16 products per page
    this.delayBetweenPages = config.delayBetweenPages || 3000; // 3 seconds between pages

    // Load checkpoint
    this.checkpoint = this.loadCheckpoint();
    this.productLinks = this.checkpoint.productLinks || [];
    
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

    // Rate limiter and memory management initialized
  }

  async initialize() {
    await super.initialize();
    
    // Set default page settings for all new pages
    this.browser.on('targetcreated', async target => {
      if (target.type() === 'page') {
        const page = await target.page();
        if (page) {
          await this.configurePageForAmazon(page);
        }
      }
    });
  }

  async configurePageForAmazon(page) {
    try {
      // Set desktop viewport
      await page.setViewport({
        width: 1920,
        height: 1080,
        deviceScaleFactor: 1,
        isMobile: false,
        hasTouch: false,
        isLandscape: true
      });

      // Set desktop user agent
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      // Enable JavaScript
      await page.setJavaScriptEnabled(true);

      // Set extra HTTP headers
      await page.setExtraHTTPHeaders({
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Cache-Control': 'max-age=0'
      });

      this.logger.debug('Page configured for Amazon with desktop settings');
    } catch (error) {
      this.logger.error(`Error configuring page for Amazon: ${error.message}`);
    }
  }

  async newPage() {
    const page = await super.newPage();
    await this.configurePageForAmazon(page);
    return page;
  }

  async navigate(page, url) {
    try {
      // Navigating to page
      
      // Navigate with more reliable wait conditions (networkidle0 can be too strict)
      await page.goto(url, { 
        waitUntil: 'domcontentloaded', 
        timeout: 45000 
      });

      // Wait for page to be fully loaded
      await page.waitForTimeout(2000);

      // Wait for specific Amazon elements to be present
      try {
        await page.waitForSelector('body', { timeout: 10000 });
        this.logger.debug('Page body loaded successfully');
      } catch (error) {
        this.logger.warn('Body selector not found, continuing anyway');
      }

      // Additional wait for dynamic content
      await page.evaluate(() => {
        return new Promise((resolve) => {
          // Wait for any pending JavaScript to complete
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
      this.logger.debug('Checkpoint saved');
    } catch (error) {
      this.logger.error(`Error saving checkpoint: ${error.message}`);
    }
  }

  normalizeAmazonUrl(url) {
    if (!url) return url;
    
    try {
      // Match up to and including the ASIN (/dp/ASIN/)
      const match = url.match(/^(.*?\/dp\/[A-Z0-9]{10})/);
      return match ? match[1] : url;
    } catch (error) {
      return url;
    }
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
          const normalizedUrl = this.normalizeAmazonUrl(product.url);
          existingUrls.add(normalizedUrl);
        }
      });
      
      // Filter out products with normalized URLs that already exist
      const uniqueNewData = newData.filter(product => {
        if (!product.url) return true; // Keep products without URLs
        const normalizedUrl = this.normalizeAmazonUrl(product.url);
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

  async start() {
    try {
      this.logger.info('🚀 Amazon Crawler Starting');
      
      // Initialize memory monitoring
      
      if (this.checkpoint.productLinks.length === 0) {
        await this.scrapeProductLinks();
        this.saveCheckpoint();
      } else {
        this.productLinks = this.checkpoint.productLinks;
        this.logger.info(`📋 Resuming: ${this.productLinks.length} products from checkpoint`);
      }

      await this.scrapeProductDetails();
      
      // Retry failed products if any
      if (this.checkpoint.failedProducts.length > 0) {
        this.logger.info(`🔄 Retrying ${this.checkpoint.failedProducts.length} failed products`);
        await this.retryFailedProducts();
      }
      
      this.logger.info('✅ Amazon crawling completed successfully');
      
      // Enhanced cleanup to ensure proper shutdown
      await this.shutdown();
      
    } catch (error) {
      this.logger.error(`Error during crawling: ${error.message}`);
      
      // Log memory stats on error
      const errorMemory = this.getMemoryStats();
      this.logger.error(`Memory stats at error: ${JSON.stringify(errorMemory)}`);
      
      this.saveCheckpoint();
      await this.shutdown();
      throw error;
    }
  }

  /**
   * Enhanced shutdown method to ensure complete cleanup
   */
  async shutdown() {
    try {
              // Starting shutdown process
      
      // Close rate limiter if it has cleanup methods
      if (this.rateLimiter && typeof this.rateLimiter.close === 'function') {
        await this.rateLimiter.close();
        this.logger.debug('Rate limiter closed');
      }
      
      // Close the base crawler (browser, memory management, etc.)
      await this.close();
      
      // Force any remaining intervals to clear
      const highestIntervalId = setTimeout(() => {}, 0);
      for (let i = 0; i < highestIntervalId; i++) {
        clearTimeout(i);
        clearInterval(i);
      }
      
      // Final garbage collection
      if (global.gc) {
        global.gc();
        this.logger.debug('Final garbage collection performed');
      }
      
              // Shutdown completed
      
      // Force process exit after a short delay to ensure everything is cleaned up
      setTimeout(() => {
        // Forcing clean exit
        process.exit(0);
      }, 2000);
      
    } catch (error) {
      this.logger.error(`Error during shutdown: ${error.message}`);
      // Force exit even if cleanup fails
      setTimeout(() => {
        process.exit(1);
      }, 3000);
    }
  }

  /**
   * Build URL for specific page number
   */
  buildPageUrl(pageNumber) {
    if (pageNumber === 1) {
      return this.categoryUrl;
    }
    
    // Replace existing page parameter or add it
    if (this.categoryUrl.includes('page=')) {
      return this.categoryUrl.replace(/page=\d+/, `page=${pageNumber}`);
    } else {
      const separator = this.categoryUrl.includes('?') ? '&' : '?';
      return `${this.categoryUrl}${separator}page=${pageNumber}`;
    }
  }

  /**
   * Check if there's a next page available
   */
  async hasNextPage(page) {
    try {
      const nextButton = await page.evaluate((selectors) => {
        const getAllElementsByXPath = (xpath) => {
          const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
          const elements = [];
          for (let i = 0; i < result.snapshotLength; i++) {
            elements.push(result.snapshotItem(i));
          }
          return elements;
        };
        
        const nextButtons = getAllElementsByXPath(selectors.NEXT_PAGE);
        return nextButtons.length > 0 && !nextButtons[0].classList.contains('a-disabled');
      }, CATEGORY_SELECTORS);
      
      return nextButton;
    } catch (error) {
      this.logger.debug(`Error checking next page: ${error.message}`);
      return false;
    }
  }

  /**
   * Determine how many pages to scrape based on configuration
   */
  calculatePagesToScrape() {
    if (this.maxProducts) {
      // Calculate pages needed for desired number of products
      const pagesNeeded = Math.ceil(this.maxProducts / this.productsPerPage);
      // Target products calculated
      return Math.min(pagesNeeded, this.maxPages || 10); // Cap at maxPages if set
    } else {
      // Use maxPages directly
              // Target pages set
      return this.maxPages;
    }
  }

  /**
   * Enhanced multi-page product link scraping
   */
  async scrapeProductLinks() {
    const allProductLinks = [];
    const targetPages = this.calculatePagesToScrape();
    const startPage = this.checkpoint.lastPageScraped + 1;
    
          this.logger.info(`🚀 Starting: Pages ${startPage}-${targetPages} | Target: ${this.maxProducts || 'ALL'} products`);
    
    for (let currentPage = startPage; currentPage <= targetPages; currentPage++) {
      const page = await this.newPage();
      
      try {
        // Enable JavaScript for category page
        await page.setJavaScriptEnabled(true);
        
        const pageUrl = this.buildPageUrl(currentPage);
                  // Scraping current page
        
        await this.navigate(page, pageUrl);
        
        // Check for access issues
        await this.checkForErrors(page);
        
        // Wait for product grid to load
        await page.waitForSelector('.s-main-slot.s-result-list', { timeout: 15000 });
        
        // Extract product links from current page
        const pageLinks = await page.evaluate((selectors) => {
          const getAllElementsByXPath = (xpath) => {
            const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            const elements = [];
            for (let i = 0; i < result.snapshotLength; i++) {
              elements.push(result.snapshotItem(i));
            }
            return elements;
          };
          
          const links = [];
          const seenUrls = new Set(); // Track normalized URLs to prevent duplicates within same page
          
          // Try each XPath selector in the array
          if (selectors.PRODUCT_LINK) {
            for (const xpath of selectors.PRODUCT_LINK) {
              const linkElements = getAllElementsByXPath(xpath);
              if (linkElements.length > 0) {
                linkElements.forEach(element => {
                  if (element.href && element.href.includes('/dp/')) {
                    // Extract normalized URL (up to ASIN)
                    const normalizedUrl = element.href.match(/^(.*?\/dp\/[A-Z0-9]{10})/);
                    const cleanUrl = normalizedUrl ? normalizedUrl[1] : element.href;
                    
                    if (!seenUrls.has(cleanUrl)) {
                      seenUrls.add(cleanUrl);
                      links.push(cleanUrl); // Store normalized URL directly
                    }
                  }
                });
                if (links.length > 0) break; // Use first successful selector
              }
            }
          }
          
          return links;
        }, CATEGORY_SELECTORS);
        
                  this.logger.info(`📄 Page ${currentPage}: Found ${pageLinks.length} products | Total: ${allProductLinks.length + pageLinks.length}`);
        
        // Stop if no products found (end of results)
        if (pageLinks.length === 0) {
                      this.logger.info(`✅ Page ${currentPage}: No products found - stopping pagination`);
          await this.returnPageToPool(page);
          break;
        }
        
        // Add unique links to collection (deduplicate by normalized URL)
        const uniqueLinks = pageLinks.filter(link => {
          // Since we're already storing normalized URLs, just check for duplicates
          return !allProductLinks.includes(link);
        });
        
        allProductLinks.push(...uniqueLinks);
        
        // Update checkpoint
        this.checkpoint.lastPageScraped = currentPage;
        this.checkpoint.pagesScraped.push(currentPage);
        this.saveCheckpoint();
        
                  // Total links collected
        
        // Check if we have enough products
        if (this.maxProducts && allProductLinks.length >= this.maxProducts) {
                      this.logger.info(`🎯 Target reached: ${allProductLinks.length} products collected`);
          await this.returnPageToPool(page);
          break;
        }
        
        // Check for next page (only if we haven't reached our target pages)
        if (currentPage < targetPages) {
          const hasNext = await this.hasNextPage(page);
          if (!hasNext) {
            // No more pages available
            await this.returnPageToPool(page);
            break;
          }
        }
        
        // Return page to pool
        await this.returnPageToPool(page);
        
        // Delay between pages for respectful scraping
        if (currentPage < targetPages) {
                      // Waiting between pages
          await new Promise(resolve => setTimeout(resolve, this.delayBetweenPages));
        }
        
      } catch (error) {
        this.logger.error(`Error scraping page ${currentPage}: ${error.message}`);
        await this.safeClosePage(page);
        
        // Continue with next page unless it's a critical error
        if (error.message.includes('CAPTCHA') || error.message.includes('blocked')) {
          throw error;
        }
      }
    }
    
    // Limit to maxProducts if specified
    if (this.maxProducts && allProductLinks.length > this.maxProducts) {
      allProductLinks.splice(this.maxProducts);
              // Limited to requested product count
    }
    
    this.productLinks = allProductLinks;
    this.checkpoint.productLinks = this.productLinks;
    this.saveCheckpoint();
    
          this.logger.info(`✅ Link collection complete: ${this.productLinks.length} products from ${this.checkpoint.pagesScraped.length} pages`);
  }

  async scrapeProductDetails() {
    const startIndex = this.checkpoint.lastProcessedIndex + 1;
    const endIndex = Math.min(this.productLinks.length, startIndex + this.maxProducts);
    
          this.logger.info(`🔍 Processing products ${startIndex + 1}-${endIndex} (${this.maxConcurrent} concurrent)`);
    
    const results = [];
    const concurrent = Math.min(this.maxConcurrent, endIndex - startIndex);
    
    // Process products in batches for controlled concurrency
    for (let i = startIndex; i < endIndex; i += concurrent) {
      const batchEnd = Math.min(i + concurrent, endIndex);
      const batchPromises = [];
      
      for (let j = i; j < batchEnd; j++) {
        const url = this.productLinks[j];
        batchPromises.push(this.processProductWithRetry(url, j));
      }
      
      const batchResults = await Promise.allSettled(batchPromises);
      
      // Process results and update checkpoint
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
      
      // Save progress
      this.saveCheckpoint();
      
      // Save data in batches
      if (results.length >= 5 || i + concurrent >= endIndex) {
        if (results.length > 0) {
          this.saveData(results);
          results.length = 0; // Clear the array
        }
      }
      
      // Add batch delay
      if (i + concurrent < endIndex) {
        const delayMs = Math.random() * 2000 + 1000; // 1-3 seconds
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
        // Check rate limits
        const rateLimitResult = await this.rateLimiter.checkLimit('scraper', 'amazon');
        if (!rateLimitResult.allowed) {
          const delayMs = this.rateLimiter.calculateDelay(rateLimitResult);
          this.logger.warn(`Rate limit hit, waiting ${delayMs}ms`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue; // Don't count this as a retry
        }
        
                  // Processing product
        const productData = await this._scrapeProductDetail(url);
        
        // Adaptive delay based on rate limit status
        const delayMs = this.rateLimiter.calculateDelay(rateLimitResult, AmazonRateLimitConfig.baseDelay);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        
        return productData;
        
      } catch (error) {
        lastError = error;
        this.logger.warn(`Attempt ${attempt} failed for ${url}: ${error.message}`);
        
        if (attempt < this.maxRetries) {
          const backoffMs = Math.pow(2, attempt) * 1000; // Exponential backoff
          this.logger.debug(`Retrying in ${backoffMs}ms`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
        }
      }
    }
    
    throw lastError;
  }

  async _scrapeProductDetail(url) {
    const page = await this.newPage();
    try {
      // Enable JavaScript for this page since it's needed for Amazon
      await page.setJavaScriptEnabled(true);
      
      await this.navigate(page, url);
      await this.delay(500, 1000);
      
      // Check for errors or blocks
      await this.checkForErrors(page);
      
      // Single comprehensive data extraction
      const productData = await this._extractAllProductData(page);
      
      // Return page to pool instead of closing
      await this.returnPageToPool(page);
      return { url, ...productData };
      
    } catch (error) {
      // Close page on error
      await this.safeClosePage(page);
      throw error;
    }
  }

  async checkForErrors(page) {
    try {
      const hasError = await page.evaluate((errorSelectors) => {
        const checkSelector = (xpath) => {
          const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
          return result.singleNodeValue !== null;
        };
        
        // Check for CAPTCHA
        for (const xpath of errorSelectors.CAPTCHA) {
          if (checkSelector(xpath)) return { type: 'CAPTCHA', xpath };
        }
        
        // Check for access denied
        for (const xpath of errorSelectors.ACCESS_DENIED) {
          if (checkSelector(xpath)) return { type: 'ACCESS_DENIED', xpath };
        }
        
        // Check for not found
        for (const xpath of errorSelectors.NOT_FOUND) {
          if (checkSelector(xpath)) return { type: 'NOT_FOUND', xpath };
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
      // Ignore evaluation errors, they might be due to page not fully loaded
    }
  }

  async _extractAllProductData(page) {
    try {
      // Get HTML once and load with Cheerio
      const html = await page.content();
      const $ = cheerio.load(html);
      
      // Pass $ (Cheerio object) to all extraction methods
      const title = await this._extractTitle($);
      const productName = await this._extractProductName($);
      const pricing = await this._extractPricing($);
      const rating = await this._extractRating($);
      const images = await this._extractImages($);
      const availability = await this._extractAvailability($);
      const specifications = await this._extractSpecifications($);
      const categories = await this._extractCategories($);
      
      // Ensure we have at least Electronics category for mobile products (like Flipkart)
      const finalCategories = categories.length === 0 ? this._getDefaultCategories(title) : categories;
      
      return {
        title,
        productName,
        price: pricing,
        rating,
        image: images.main,
        availability,
        specifications,
        categories: finalCategories,
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
      for (const selector of PRODUCT_SELECTORS.TITLE) {
        const titleElement = $(selector).first();
        
        // Check if element exists and has text
        if (titleElement.length > 0) {
          const title = titleElement.text().replace(/\s+/g, ' ').trim();
          
          if (title && title.length > 10 && title.length < 250) {
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
  
  async _extractProductName($) {
    try {
      for (const selector of PRODUCT_SELECTORS.PRODUCT_NAME) {
        const nameElement = $(selector).first();
        
        // Check if element exists and has text
        if (nameElement.length > 0) {
          const name = nameElement.text().replace(/\s+/g, ' ').trim();
          return name;
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
        current: null,
        original: null,
        discount: null
      };
      
      for (const selector of PRODUCT_SELECTORS.PRICE) {
        const element = $(selector).first();
        if (element.length > 0 && element.text().trim()) {
          const priceText = element.text().trim();
          // Only take numeric price, not multiple prices
          if (priceText.match(/^\d{1,3}(,\d{3})*(\.\d{2})?$/)) {
            pricing.current = priceText;
            break;
          }
        }
      }
      
      for (const selector of PRODUCT_SELECTORS.ORIGINAL) {
        const element = $(selector).first();
        if (element.length > 0 && element.text().trim()) {
          const originalText = element.text().trim();
          // Clean up and only take first price if multiple
          if (originalText.includes('₹')) {
            const cleanPrice = originalText.split('₹')[1]?.split('₹')[0]?.trim();
            if (cleanPrice && cleanPrice.match(/^\d{1,3}(,\d{3})*(\.\d{2})?$/)) {
              pricing.original = '₹' + cleanPrice;
              break;
            }
          } else {
            pricing.original = originalText;
            break;
          }
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
      return { current: null, original: null, discount: null };
    }
  }

  async _extractRating($) {
    try {
      const rating = {
        value: null,
        count: null
      };

      // Extract rating value
      for (const selector of PRODUCT_SELECTORS.RATING) {
        const element = $(selector).first();
        if (element.length > 0) {
          const ratingText = element.text() || element.attr('aria-label') || '';
          const ratingMatch = ratingText.match(/(\d+\.?\d*)\s*out of/i);
          if (ratingMatch) {
            rating.value = parseFloat(ratingMatch[1]);
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
            rating.count = parseInt(countMatch[0].replace(/,/g, ''));
            break;
          }
        }
      }
      return rating;
    } catch (error) {
      this.logger.error(`Error extracting rating: ${error.message}`);
      return { value: null, count: null };
    }
  }

  async _extractImages($) {
    try {
      let mainImage = null;
      for (const selector of PRODUCT_SELECTORS.MAIN_IMAGE) {
        const element = $(selector).first();
        if (element.length > 0) {
          mainImage = element.attr('src') || element.attr('data-src');
          if (mainImage && mainImage.includes('amazon') && mainImage.includes('images')) {
            break;
          }
        }
      }
      return {
        main: mainImage,
        all: [] // Can be expanded later if needed
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
          // Extracting specifications
    try {
      const specifications = {};

      // Method 1: Product Overview Table
      const overviewTable = $('#productOverview_feature_div table');
      if (overviewTable.length > 0) {
        overviewTable.find('tr').each((_, row) => {
          const cells = $(row).find('td');
          if (cells.length >= 2) {
            const key = $(cells[0]).text().trim();
            const value = $(cells[1]).text().trim();
            if (key && value && key !== value && !key.startsWith('Feature') && key !== 'Description') {
              specifications[key] = value;
            }
          }
        });
      }
              
      const productDetails = await this._extractSpecs($);
      const technicalDetails = await this._extractTechnicalDetails($);
      const cleanedSpecs = {};
      Object.keys(specifications).forEach(key => {
        const value = specifications[key];
        const cleanKey = key.replace(/[:\-\s]+$/, '').trim();
        const cleanValue = value.replace(/^[:\-\s]+/, '').trim();
        
        if (cleanKey && cleanValue && 
            cleanKey !== cleanValue && 
            cleanKey.length > 1 && 
            cleanValue.length > 1 &&
            !cleanValue.includes('...') &&
            cleanKey.length < 100 &&
            cleanValue.length < 300) {
          cleanedSpecs[cleanKey] = cleanValue;
        }
      });
      cleanedSpecs['Product Details'] = {productDetails};
      cleanedSpecs['Technical Details'] = {technicalDetails};
              // Extracted specifications
      return cleanedSpecs;

    } catch (error) {
      this.logger.error(`Error extracting specifications with Cheerio: ${error.message}`);
      return {};
    }
  }

  async _extractTechnicalDetails($) {
     try {
       console.log('=== EXTRACTING FROM TECHNICAL DETAILS TABLES ===');
       
       const specifications = {};
       
       // Method 1: Extract from the main technical details table
       const specificTable = $('#productDetails_techSpec_section_1');
       
       if (specificTable.length > 0) {
         console.log('✅ Found main technical details table, extracting data...');
         
         specificTable.find('tr').each((index, row) => {
           const $row = $(row);
           
           const fieldNameElement = $row.find('th.prodDetSectionEntry');
           const fieldValueElement = $row.find('td.prodDetAttrValue');
           
           if (fieldNameElement.length > 0 && fieldValueElement.length > 0) {
             const fieldName = fieldNameElement.text().trim();
             const fieldValue = fieldValueElement.text().trim();
             
             const cleanValue = fieldValue.replace(/\u200E/g, '').replace(/\s+/g, ' ').trim();
             
             if (fieldName && cleanValue) {
               specifications[fieldName] = cleanValue;
               console.log(`Specific info: ${fieldName}: ${cleanValue}`);
             }
           }
         });
       } else {
         console.log('❌ Main technical details table not found');
       }
       console.log(`✅ Extracted ${Object.keys(specifications).length} items from technical details tables`);
       return specifications;
       
      } catch (error) {
       console.error('Error extracting from technical details tables:', error);
       return {};
     }
  }
  
  async _extractSpecs($) {
    try {
      console.log('=== EXTRACTING ALL FIELDS FROM FIRST COLUMN ===');
      
      const specifications = {};
      const rows = $('tr:has(td[class*="tableAttributeName"])');
      
      console.log(`Found ${rows.length} specification rows`);
      
      for (let i = 0; i < rows.length; i++) {
        const row = rows.eq(i);
        
        // Get the field name from the header cell
        const headerCell = row.find('td[role="rowheader"] span').text().trim();
        
        if (headerCell) {
          // Get the value from the first product column (asin-0)
          const firstColumnValue = row.find('td[class*="asin-0"] span.a-size-base.a-color-base').text().trim();
          
          if (firstColumnValue) {
            specifications[headerCell] = firstColumnValue;
            console.log(`${headerCell}: "${firstColumnValue}"`);
          } else {
            console.log(`❌ No value found for field: "${headerCell}"`);
          }
        }
      }
      
      console.log(`✅ Extracted ${Object.keys(specifications).length} fields from first column`);
      return specifications;
      
    } catch (error) {
      console.error('Error extracting all fields from first column:', error);
      return {};
    }
  }

  async _extractCategories($) {
    try {
      const categories = [];
      
      // Extract using CSS selectors (since XPaths are placeholders)
      const breadcrumbSelectors = [
        '#wayfinding-breadcrumbs_container a',
        '.a-breadcrumb a',
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
        // Retrying failed product
        const productData = await this.processProductWithRetry(failedProduct.url, failedProduct.index);
        results.push(productData);
        
        if (results.length >= 5) {
          this.saveData(results);
          results.length = 0;
        }
      } catch (error) {
        const errorMessage = error && error.message ? error.message : 'Unknown error';
        this.logger.error(`Retry failed for ${failedProduct.url}: ${errorMessage}`);
        // Add back to failed products
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
  const crawler = new AmazonDetailCrawler({
    headless: true,
    proxyConfig: {
      useProxy: false
    },
    maxProducts: 500,
    maxConcurrent: 10,
    maxPages: 50,
    delayBetweenPages: 3000
  });
  
  crawler.start().catch(error => {
    console.error('Crawler failed:', error);
    process.exit(1);
  });
}

module.exports = AmazonDetailCrawler; 