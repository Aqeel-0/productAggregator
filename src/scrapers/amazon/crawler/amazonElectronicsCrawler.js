const fs = require('fs');
const path = require('path');
const { Cluster } = require('puppeteer-cluster');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { CATEGORY_SELECTORS, PRODUCT_SELECTORS, ERROR_INDICATORS } = require('./amazon-selectors');
const RateLimiter = require('../../../rate-limiter/RateLimiter');
const AmazonRateLimitConfig = require('../../../rate-limiter/configs/amazon-config');
const Logger = require('../../../utils/logger');
const { createMemoryTracker, setupSignalHandlers } = require('../../crawler-utils');
const ScrapingHealthMonitor = require('../../scraping-health-monitor');
puppeteer.use(StealthPlugin());


class AmazonClusterCrawler {
  constructor(config = {}) {
    // Configuration
    this.category = config.category || 'mobile';
    this.categoryUrl = config.categoryUrl || 'https://www.amazon.in/s?i=electronics&rh=n%3A976419031%2Cn%3A1389401031%2Cn%3A1389432031%2Cn%3A1805560031&s=popularity-rank';
    
    // Initialize logger FIRST
    this.logger = new Logger(this.category);
    
    // Create separate directories for checkpoints and raw data
    const checkpointDir = path.join(__dirname, '..', 'checkpoints');
    const rawDataDir = path.join(__dirname, '..', 'raw_data');
    
    // Ensure directories exist
    this.ensureDirectory(checkpointDir);
    this.ensureDirectory(rawDataDir);
    
    // Dynamic file paths
    this.outputFile = config.outputFile || path.join(rawDataDir, `amazon_${this.category}_scraped_data.json`);
    this.checkpointFile = config.checkpointFile || path.join(checkpointDir, `amazon_${this.category}_checkpoint.json`);
    
    // Multi-page scraping configuration
    this.maxProducts = config.maxProducts || null;
    this.maxPages = config.maxPages || 3;
    this.maxConcurrent = config.maxConcurrent || 10;
    this.maxRetries = config.maxRetries || 3;
    this.headless = config.headless !== undefined ? config.headless : true;
    
    // Page-level configuration
    this.productsPerPage = config.productsPerPage || 16;
    this.delayBetweenPages = config.delayBetweenPages || 3000;

    // Initialize rate limiter
    this.rateLimiter = new RateLimiter({
      redis: { enabled: false },
      defaultAlgorithm: AmazonRateLimitConfig.algorithm,
      cleanupInterval: 60000
    });
    this.rateLimiter.registerRules('amazon', AmazonRateLimitConfig);

    // Load checkpoint
    this.checkpoint = this.loadCheckpoint();
    this.productLinks = this.checkpoint.productLinks || [];
    this.seenUrls = new Set(this.productLinks);
    
    // Cluster will be initialized in start()
    this.cluster = null;
    this.memoryTracker = createMemoryTracker('amazon');
    this.healthMonitor = new ScrapingHealthMonitor({ platform: 'amazon', logger: this.logger });
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
        return JSON.parse(data);
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

  normalizeAmazonUrl(url) {
    if (!url) return url;
    try {
      const match = url.match(/^(.*?\/dp\/[A-Z0-9]{10})/);
      return match ? match[1] : url;
    } catch (error) {
      return url;
    }
  }

  addUniqueUrl(url) {
    const normalized = this.normalizeAmazonUrl(url);
    if (!this.seenUrls.has(normalized)) {
      this.seenUrls.add(normalized);
      this.productLinks.push(normalized);
      return true;
    }
    return false;
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
      retryLimit: 0, // We handle retries manually
      timeout: 45000,
      monitor: false,
      puppeteer: puppeteer,
    });

    this.logger.info(`Cluster initialized with ${this.maxConcurrent} concurrent tabs (single browser)`);
  }

  async configurePage(page) {
    try {
      await page.setViewport({
        width: 1920,
        height: 1080,
        deviceScaleFactor: 1,
        isMobile: false,
        hasTouch: false,
        isLandscape: true
      });

      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

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

      page.removeAllListeners('request');
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        const resourceType = request.resourceType();
        const url = request.url();
        
        if (['font', 'media', 'image'].includes(resourceType)) {
          request.abort();
        } else if (url.includes('google-analytics') || url.includes('facebook') || url.includes('doubleclick')) {
          request.abort();
        } else {
          request.continue();
        }
      });

      page.setDefaultTimeout(30000);
      page.setDefaultNavigationTimeout(30000);

      this.logger.debug('Page configured for Amazon with desktop settings');
    } catch (error) {
      this.logger.error(`Error configuring page for Amazon: ${error.message}`);
    }
  }

  async start() {
    this.memoryTracker.start();
    try {
      await this.initializeCluster();

      if (this.checkpoint.productLinks.length === 0) {
        await this.scrapeProductLinks();
        this.saveCheckpoint();
      } else {
        this.productLinks = this.checkpoint.productLinks;
        this.logger.info(`Resuming: ${this.productLinks.length} products from checkpoint`);
      }

      const totalProducts = this.checkpoint.productLinks.length;
      const processedCount = this.checkpoint.lastProcessedIndex + 1;
      const logTarget = this.maxProducts ? Math.min(this.maxProducts, totalProducts) : totalProducts;
      this.logger.startScraper(this.category, logTarget, processedCount);

      await this.scrapeProductDetails();

      if (this.checkpoint.failedProducts.length > 0) {
        this.logger.info(`Retrying ${this.checkpoint.failedProducts.length} failed products`);
        await this.retryFailedProducts();
      }

      this.logger.completeScraper();

    } catch (error) {
      this.logger.error(`Error during crawling: ${error.message}`);
      this.saveCheckpoint();
      throw error;
    } finally {
      await this.shutdown();
    }
  }

  async shutdown() {
    this.logger.info('Starting graceful shutdown...');
    this.memoryTracker.stop();

    if (this.rateLimiter) {
      await this.rateLimiter.close();
      this.logger.debug('Rate limiter closed');
    }

    if (this.cluster) {
      await this.cluster.close();
      this.logger.info('Cluster closed');
    }

    this.logger.info('Graceful shutdown completed');
  }

  buildPageUrl(pageNumber) {
    if (pageNumber === 1) {
      return this.categoryUrl;
    }
    
    if (this.categoryUrl.includes('page=')) {
      return this.categoryUrl.replace(/page=\d+/, `page=${pageNumber}`);
    } else {
      const separator = this.categoryUrl.includes('?') ? '&' : '?';
      return `${this.categoryUrl}${separator}page=${pageNumber}`;
    }
  }

  calculatePagesToScrape() {
    if (this.maxProducts) {
      const pagesNeeded = Math.ceil(this.maxProducts / this.productsPerPage);
      return Math.min(pagesNeeded, this.maxPages || 10);
    } else {
      return this.maxPages;
    }
  }

  async scrapeProductLinks() {
    const targetPages = this.calculatePagesToScrape();
    const startPage = this.checkpoint.lastPageScraped + 1;
    
    for (let currentPage = startPage; currentPage <= targetPages; currentPage++) {
      await this.cluster.execute({ 
        url: this.buildPageUrl(currentPage), 
        type: 'listing', 
        pageNum: currentPage 
      }, async ({ page, data }) => {
        await this.configurePage(page);
        
        await page.goto(data.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        
        await page.evaluate(() => {
          return new Promise((resolve) => {
            if (document.readyState === 'complete') {
              resolve();
            } else {
              window.addEventListener('load', resolve);
            }
          });
        });

        const hasProductGrid = await page.evaluate(() => {
          return document.querySelector('.s-main-slot.s-result-list') !== null;
        });

        if (!hasProductGrid) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        let pageLinks = [];
        try {
          await page.waitForSelector('.s-main-slot.s-result-list', { timeout: 15000 });
          pageLinks = await page.evaluate(() => {
            const links = [];
            const linkElements = document.querySelectorAll('a[href*="/dp/"]');
            linkElements.forEach(element => {
              if (element.href && element.href.includes('/dp/')) {
                links.push(element.href);
              }
            });
            return links;
          });
        } catch (error) {
          this.logger.warn(`Error extracting links on page ${data.pageNum}: ${error.message}`);
        }

        let addedCount = 0;
        for (const link of pageLinks) {
          if (this.maxProducts && this.productLinks.length >= this.maxProducts) break;
          if (this.addUniqueUrl(link)) addedCount++;
        }

        this.logger.info(`Page ${data.pageNum}: Found ${pageLinks.length} products, added ${addedCount} (Total: ${this.productLinks.length}${this.maxProducts ? `/${this.maxProducts}` : ''})`);
      });

      this.checkpoint.lastPageScraped = currentPage;
      this.checkpoint.pagesScraped.push(currentPage);
      this.checkpoint.productLinks = this.productLinks;
      this.saveCheckpoint();

      if (this.maxProducts && this.productLinks.length >= this.maxProducts) {
        break;
      }

      if (currentPage < targetPages) {
        await new Promise(resolve => setTimeout(resolve, this.delayBetweenPages));
      }
    }
  }

  async _scrapeProductDetail(url) {
    return await this.cluster.execute({ url }, async ({ page, data }) => {
      await this.configurePage(page);
      await page.goto(data.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 500));
      await this.checkForErrors(page);
      const productData = await this.extractProductData(page);
      return { url: data.url, ...productData };
    });
  }

  async processProductWithRetry(url, index) {
    let rl;
    while (true) {
      rl = await this.rateLimiter.checkLimit('scraper', 'amazon');
      if (rl.allowed) break;
      const delayMs = this.rateLimiter.calculateDelay(rl);
      this.logger.rateLimit(delayMs);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    let lastError;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const data = await this._scrapeProductDetail(url);
        this.logger.updateProgress();
        const delayMs = this.rateLimiter.calculateDelay(rl, AmazonRateLimitConfig.baseDelay);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        return data;
      } catch (error) {
        lastError = error;
        this.logger.productError(index, error.message);
        if (attempt < this.maxRetries) {
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      }
    }
    throw lastError;
  }

  async scrapeProductDetails() {
    const startIndex = this.checkpoint.lastProcessedIndex + 1;
    const endIndex = this.maxProducts
      ? Math.min(this.maxProducts, this.productLinks.length)
      : this.productLinks.length;

    this.logger.info(`🔍 Processing products ${startIndex + 1}-${endIndex} (${this.maxConcurrent} concurrent)`);

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
          if (this.healthMonitor.evaluate(res.value) === 'hard') {
            this.saveCheckpoint();
            const err = new Error(`Scraper stopped abruptly — ${this.healthMonitor.consecutiveNulls} consecutive null products`);
            err.name = 'BotDetectedError';
            throw err;
          }
        } else {
          const errMsg = res.reason?.message || String(res.reason) || 'Unknown error';
          this.logger.error(`Failed product ${index}: ${errMsg}`);
          this.checkpoint.failedProducts.push({
            index,
            url: this.productLinks[index],
            error: errMsg,
            timestamp: new Date().toISOString()
          });
          if (this.healthMonitor.evaluate(null) === 'hard') {
            this.saveCheckpoint();
            const err = new Error(`Scraper stopped abruptly — ${this.healthMonitor.consecutiveNulls} consecutive errors`);
            err.name = 'BotDetectedError';
            throw err;
          }
        }
      }

      this.saveCheckpoint();

      if (results.length > 0) {
        this.saveData([...results]);
        results.length = 0;
      }

      if (batchEnd < endIndex) {
        const delayMs = Math.random() * 2000 + 1000;
        this.logger.debug(`Batch delay: ${delayMs}ms`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    this.logger.info(`Batch complete. Failed: ${this.checkpoint.failedProducts.length}`);
  }

  async extractProductData(page) {
    try {
      const productData = await page.evaluate((SELECTORS) => {
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
        
        const titleSelectors = ['#productTitle', 'h1#title', 'span#productTitle'];
        let title = null;
        for (const sel of titleSelectors) {
          const text = getText(sel);
          if (text && text.length > 10 && text.length < 250) {
            title = text.replace(/\s+/g, ' ').trim();
            break;
          }
        }
        
        let deal = null;
        const dealSelectors = [
          '#dealBadge',
          '.dealBadge',
          '[data-csa-c-type="widget"][data-csa-c-slot-id*="deal"]',
          '.a-badge-label[data-a-badge-color="sx-lightning-deal-red"]'
        ];
        for (const sel of dealSelectors) {
          const text = getText(sel);
          if (text && text.length > 0) {
            deal = text;
            break;
          }
        }
        
        let productName = null;
        const productNameSelectors = [
          '#productSubtitle',
          '.product-subtitle',
          '#bylineInfo',
          '.a-size-base.po-break-word'
        ];
        for (const sel of productNameSelectors) {
          const text = getText(sel);
          if (text && text.length > 0 && text.length < 200) {
            productName = text.replace(/\s+/g, ' ').trim();
            break;
          }
        }
        
        const pricing = {
          current: null,
          original: null,
          discount: null
        };
        
        const priceSelectors = [
          '.a-price.aok-align-center.reinventPricePriceToPayMargin.priceToPay .a-offscreen',
          '.a-price .a-offscreen',
          '#priceblock_ourprice',
          '#priceblock_dealprice',
          '.a-price-whole'
        ];
        for (const sel of priceSelectors) {
          const price = getText(sel);
          if (price && price.match(/[\d,]+/)) {
            pricing.current = price.replace(/\s+/g, ' ').trim();
            break;
          }
        }
        
        const originalSelectors = [
          '.a-price[data-a-strike="true"] .a-offscreen',
          '#priceblock_ourprice',
          '.a-text-price .a-offscreen'
        ];
        for (const sel of originalSelectors) {
          const price = getText(sel);
          if (price) {
            pricing.original = price.replace(/\s+/g, ' ').trim();
            break;
          }
        }
        
        pricing.discount = getText('.savingsPercentage') || getText('#dealprice_savings .a-color-price');
        
        const rating = {
          value: null,
          count: null
        };
        
        const ratingText = getText('#acrPopover') || getAttr('#acrPopover', 'title') || '';
        const ratingMatch = ratingText.match(/(\d+\.?\d*)\s*out of/i);
        if (ratingMatch) {
          rating.value = parseFloat(ratingMatch[1]);
        }
        
        const countText = getText('#acrCustomerReviewText') || '';
        const countMatch = countText.match(/[\d,]+/);
        if (countMatch) {
          rating.count = parseInt(countMatch[0].replace(/,/g, ''));
        }
        
        const mainImage = getAttr('#landingImage', 'src') ||
                         getAttr('#imgBlkFront', 'src') ||
                         getAttr('.a-dynamic-image', 'src');

        // Extract all images
        const allImages = [];
        const otherImageElements = document.querySelectorAll('li.imageThumbnail .a-button-text img');
        otherImageElements.forEach(img => {
          const src = img.getAttribute('src') || img.getAttribute('data-src');
          if (src && !allImages.includes(src)) {
            allImages.push(src);
          }
        });
        if (mainImage && !allImages.includes(mainImage)) {
          allImages.unshift(mainImage);
        }

        const availability = getText('#availability span') ||
                           getText('#availability') ||
                           getText('.a-color-success') ||
                           getText('.a-color-state');
        
        const categories = [];
        const breadcrumbSelectors = [
          '#wayfinding-breadcrumbs_container a',
          '.a-breadcrumb a',
          'nav[aria-label="Breadcrumb"] a'
        ];
        
        for (const sel of breadcrumbSelectors) {
          const links = document.querySelectorAll(sel);
          if (links.length > 0) {
            links.forEach(link => {
              const cat = link.textContent.trim();
              if (cat && cat.length > 1 && !cat.includes('›') && !cat.includes('...')) {
                categories.push(cat);
              }
            });
            if (categories.length > 0) break;
          }
        }
        
        const specifications = {};
        
        // 1. Product Overview table
        const overviewTable = document.querySelector('#productOverview_feature_div table');
        if (overviewTable) {
          const overviewData = {};
          const rows = overviewTable.querySelectorAll('tr');
          rows.forEach(row => {
            const cells = row.querySelectorAll('td');
            if (cells.length >= 2) {
              const key = cells[0].textContent.trim();
              const value = cells[1].textContent.trim();
              if (key && value && key !== value) {
                const cleanKey = key.replace(/[:\-\s]+$/, '').trim();
                const cleanValue = value.replace(/^[:\-\s]+/, '').trim();
                if (cleanKey && cleanValue && cleanKey.length < 100 && cleanValue.length < 300) {
                  overviewData[cleanKey] = cleanValue;
                }
              }
            }
          });
          if (Object.keys(overviewData).length > 0) {
            specifications['Product Overview'] = overviewData;
          }
        }
        
        // 2. Structured expandable sections (Camera, Battery, Display, etc.)
        const sectionContainers = [
          '#productDetails_expanderTables_depthLeftSections',
          '#productDetails_expanderTables_depthRightSections'
        ];
        
        sectionContainers.forEach(containerSel => {
          const container = document.querySelector(containerSel);
          if (!container) return;
          
          const sections = container.querySelectorAll('.a-expander-container.a-section-expander-container');
          sections.forEach(section => {
            const titleEl = section.querySelector('.a-expander-prompt');
            const sectionName = titleEl ? titleEl.textContent.trim() : null;
            if (!sectionName) return;
            
            const table = section.querySelector('.a-expander-content table.a-keyvalue.prodDetTable');
            if (table) {
              const sectionData = {};
              const rows = table.querySelectorAll('tr');
              rows.forEach(row => {
                const keyEl = row.querySelector('th.prodDetSectionEntry');
                const valueEl = row.querySelector('td.prodDetAttrValue');
                if (keyEl && valueEl) {
                  const key = keyEl.textContent.trim();
                  let value = valueEl.textContent.trim();
                  value = value.replace(/\u200E/g, '').replace(/\s+/g, ' ').trim();
                  if (key && value && key !== value) {
                    sectionData[key] = value;
                  }
                }
              });
              
              if (Object.keys(sectionData).length > 0) {
                if (specifications[sectionName]) {
                  Object.assign(specifications[sectionName], sectionData);
                } else {
                  specifications[sectionName] = sectionData;
                }
              }
            }
          });
        });
        
        // 3. Technical Details table
        const techTable = document.querySelector('#productDetails_techSpec_section_1');
        if (techTable) {
          const techData = {};
          const rows = techTable.querySelectorAll('tr');
          rows.forEach(row => {
            const keyEl = row.querySelector('th.prodDetSectionEntry');
            const valueEl = row.querySelector('td.prodDetAttrValue');
            if (keyEl && valueEl) {
              const key = keyEl.textContent.trim();
              let value = valueEl.textContent.trim();
              value = value.replace(/\u200E/g, '').replace(/\s+/g, ' ').trim();
              if (key && value) {
                techData[key] = value;
              }
            }
          });
          if (Object.keys(techData).length > 0) {
            specifications['Technical Details'] = techData;
          }
        }
        
        // 4. Additional Information table
        const addInfoTable = document.querySelector('#productDetails_detailBullets_sections1');
        if (addInfoTable) {
          const addInfoData = {};
          const rows = addInfoTable.querySelectorAll('tr');
          rows.forEach(row => {
            const keyEl = row.querySelector('th.prodDetSectionEntry');
            const valueEl = row.querySelector('td');
            if (keyEl && valueEl) {
              const key = keyEl.textContent.replace(/\s+/g, ' ').trim();
              const value = valueEl.textContent.replace(/\s+/g, ' ').trim();
              if (key && value) {
                addInfoData[key] = value;
              }
            }
          });
          if (Object.keys(addInfoData).length > 0) {
            specifications['Additional Information'] = addInfoData;
          }
        }
        
        // Return all extracted data
        return {
          title,
          deal,
          productName,
          price: pricing,
          rating,
          image: mainImage,
          allImages,
          availability,
          categories: categories.length > 0 ? categories : null,
          specifications
        };
        
      }, PRODUCT_SELECTORS);
      
      // Add default categories if none found
      const finalCategories = productData.categories || this._getDefaultCategories(productData.title);
      
      return {
        title: productData.title,
        deal: productData.deal,
        productName: productData.productName,
        price: productData.price,
        rating: productData.rating,
        image: productData.image,
        allImages: productData.allImages || [],
        availability: productData.availability,
        specifications: productData.specifications,
        categories: finalCategories,
        extractedAt: new Date().toISOString()
      };
      
    } catch (error) {
      this.logger.error(`Error extracting product data: ${error.message}`);
      return {
        title: null,
        deal: null,
        productName: null,
        price: { current: null, original: null, discount: null },
        rating: { value: null, count: null },
        image: null,
        allImages: [],
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
      if (titleLower.includes('phone') || titleLower.includes('mobile') || titleLower.includes('smartphone')) {
        categories.push('Electronics');
        categories.push('Mobile Phones');
      } else if (titleLower.includes('laptop') || titleLower.includes('computer') || titleLower.includes('tablet')) {
        categories.push('Electronics');
        categories.push('Computers');
      } else {
        categories.push('Electronics');
      }
    }
    return categories;
  }

  async checkForErrors(page) {
    try {
      const hasError = await page.evaluate(() => {
        if (document.body.textContent.includes('Enter the characters you see below')) return 'CAPTCHA';
        if (document.body.textContent.includes('Sorry! Something went wrong')) return 'ERROR';
        return null;
      });
      
      if (hasError) {
        throw new Error(`Page error detected: ${hasError}`);
      }
    } catch (error) {
      if (error.message.includes('Page error detected')) {
        throw error;
      }
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

      const validData = Array.isArray(data) ? data.filter(p => p && p.url) : [];
      if (validData.length === 0) return;

      const existingUrls = new Set(existingData.filter(p => p && p.url).map(p => this.normalizeAmazonUrl(p.url)));
      const uniqueNewData = validData.filter(p => !existingUrls.has(this.normalizeAmazonUrl(p.url)));
      const combinedData = [...existingData, ...uniqueNewData];

      fs.writeFileSync(this.outputFile, JSON.stringify(combinedData, null, 2));
    } catch (error) {
      this.logger.error(`Error saving data: ${error.message}`);
    }
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
          if (this.healthMonitor.evaluate(res.value) === 'hard') {
            this.saveCheckpoint();
            const err = new Error(`Scraper stopped abruptly during retries — ${this.healthMonitor.consecutiveNulls} consecutive null products`);
            err.name = 'BotDetectedError';
            throw err;
          }
        } else {
          this.checkpoint.failedProducts.push({
            ...batch[k],
            retryAttempts: (batch[k].retryAttempts || 0) + 1
          });
          if (this.healthMonitor.evaluate(null) === 'hard') {
            this.saveCheckpoint();
            const err = new Error(`Scraper stopped abruptly during retries — ${this.healthMonitor.consecutiveNulls} consecutive errors`);
            err.name = 'BotDetectedError';
            throw err;
          }
        }
      });
      if (results.length > 0) {
        this.saveData([...results]);
        results.length = 0;
      }
      this.saveCheckpoint();
    }
  }
}

module.exports = AmazonClusterCrawler;
