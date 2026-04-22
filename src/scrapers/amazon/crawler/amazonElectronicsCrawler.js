const fs = require('fs');
const path = require('path');
const { Cluster } = require('puppeteer-cluster');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { CATEGORY_SELECTORS, PRODUCT_SELECTORS, ERROR_INDICATORS } = require('./amazon-selectors');
const RateLimiter = require('../../../rate-limiter/RateLimiter');
const AmazonRateLimitConfig = require('../../../rate-limiter/configs/amazon-config');
// STEP 2: Removed Cheerio - using direct page.evaluate() instead
const Logger = require('../../../utils/logger');

// Apply stealth plugin
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
      concurrency: Cluster.CONCURRENCY_CONTEXT, // Each task gets isolated browser context
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

    this.logger.info(`Cluster initialized with ${this.maxConcurrent} concurrent contexts`);
  }

  async configurePage(page) {
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

      // STEP 2: Removed setJavaScriptEnabled(true) - JavaScript is enabled by default in Puppeteer

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

      // Block unnecessary resources (keeping original behavior for now)
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

      // Anti-detection
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', {
          get: () => false,
        });
        window.chrome = {
          runtime: {},
        };
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) => (
          parameters.name === 'notifications' ?
            Promise.resolve({ state: Notification.permission }) :
            originalQuery(parameters)
        );
      });

      page.setDefaultTimeout(30000);
      page.setDefaultNavigationTimeout(30000);

      this.logger.debug('Page configured for Amazon with desktop settings');
    } catch (error) {
      this.logger.error(`Error configuring page for Amazon: ${error.message}`);
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

      const totalProducts = this.checkpoint.productLinks.length;
      const processedCount = this.checkpoint.lastProcessedIndex + 1;
      this.logger.startScraper(this.category, totalProducts, processedCount);
      
      await this.scrapeProductDetails();
      
      if (this.checkpoint.failedProducts.length > 0) {
        this.logger.info(`Retrying ${this.checkpoint.failedProducts.length} failed products`);
        await this.retryFailedProducts();
      }
      
      this.logger.completeScraper();
      await this.shutdown();
      
    } catch (error) {
      console.error(`❌ Amazon ${this.category} scraping failed:`, error.message);
      this.logger.error(`Error during crawling: ${error.message}`);
      this.saveCheckpoint();
      await this.shutdown();
      throw error;
    }
  }

  async shutdown() {
    this.logger.info('Starting graceful shutdown...');
    
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
        
        // Wait for page to be fully loaded
        await page.evaluate(() => {
          return new Promise((resolve) => {
            if (document.readyState === 'complete') {
              resolve();
            } else {
              window.addEventListener('load', resolve);
            }
          });
        });
        
        // Check if product grid exists, reload if not
        const hasProductGrid = await page.evaluate(() => {
          return document.querySelector('.s-main-slot.s-result-list') !== null;
        });
        
        if (!hasProductGrid) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        // Extract links
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
        
        // Deduplicate and add links
        pageLinks.forEach(link => {
          this.addUniqueUrl(link);
        });
        
        this.logger.info(`Page ${data.pageNum}: Found ${pageLinks.length} products (Total: ${this.productLinks.length})`);
      });
      
      // Update checkpoint
      this.checkpoint.lastPageScraped = currentPage;
      this.checkpoint.pagesScraped.push(currentPage);
      this.checkpoint.productLinks = this.productLinks;
      this.saveCheckpoint();
      
      // Check if target reached
      if (this.maxProducts && this.productLinks.length >= this.maxProducts) {
        break;
      }
      
      // Delay between pages
      if (currentPage < targetPages) {
        await new Promise(resolve => setTimeout(resolve, this.delayBetweenPages));
      }
    }
  }

  async scrapeProductDetails() {
    const startIndex = this.checkpoint.lastProcessedIndex + 1;
    const endIndex = Math.min(this.productLinks.length, startIndex + (this.maxProducts || this.productLinks.length));
    
    this.logger.info(`🔍 Processing products ${startIndex + 1}-${endIndex} (${this.maxConcurrent} concurrent)`);
    
    const results = [];
    let successCount = 0;
    let failCount = 0;

    // Process products in batches
    const batchSize = this.maxConcurrent;
    
    for (let i = startIndex; i < endIndex; i += batchSize) {
      const batchEnd = Math.min(i + batchSize, endIndex);
      const batchPromises = [];

      for (let j = i; j < batchEnd; j++) {
        const url = this.productLinks[j];
        const index = j;

        const promise = this.cluster.execute({ url, index }, async ({ page, data }) => {
          await this.configurePage(page);

          // Check rate limits
          const rateLimitResult = await this.rateLimiter.checkLimit('scraper', 'amazon');
          if (!rateLimitResult.allowed) {
            const delayMs = this.rateLimiter.calculateDelay(rateLimitResult);
            this.logger.rateLimit(delayMs);
            await new Promise(resolve => setTimeout(resolve, delayMs));
          }

          // Navigate and extract
          await page.goto(data.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 500));

          // Check for errors
          await this.checkForErrors(page);

          // Extract product data (using Cheerio for now - Step 1)
          const productData = await this.extractProductData(page);

          // Adaptive delay
          const delayMs = this.rateLimiter.calculateDelay(rateLimitResult, AmazonRateLimitConfig.baseDelay);
          await new Promise(resolve => setTimeout(resolve, delayMs));

          return { url: data.url, index: data.index, ...productData };
        })
        .then(result => {
          if (result && result.url) {
            // Remove index before saving - it's only for checkpoint tracking
            const { index: resultIndex, ...productData } = result;
            results.push(productData);
            successCount++;
            this.checkpoint.lastProcessedIndex = resultIndex;
            this.logger.updateProgress();
          }
        })
        .catch(error => {
          failCount++;
          this.logger.error(`Failed product ${index}: ${error.message}`);
          this.checkpoint.failedProducts.push({
            index,
            url,
            error: error.message,
            timestamp: new Date().toISOString()
          });
        });

        batchPromises.push(promise);
      }

      // Wait for batch to complete
      await Promise.all(batchPromises);

      // Save batch results
      if (results.length > 0) {
        this.saveData([...results]);
        results.length = 0;
      }

      // Save progress
      this.saveCheckpoint();

      // Add batch delay
      if (batchEnd < endIndex) {
        const delayMs = Math.random() * 2000 + 1000;
        this.logger.debug(`Batch delay: ${delayMs}ms`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    
    this.logger.info(`✅ Completed batch: ${successCount} products processed | Failed: ${failCount}`);
  }

  async extractProductData(page) {
    try {
      // STEP 2: Using direct page.evaluate() instead of Cheerio
      // This eliminates the need to transfer ~1MB HTML from browser to Node
      const productData = await page.evaluate((SELECTORS) => {
        // Helper functions
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
        
        // Extract title
        const titleSelectors = ['#productTitle', 'h1#title', 'span#productTitle'];
        let title = null;
        for (const sel of titleSelectors) {
          const text = getText(sel);
          if (text && text.length > 10 && text.length < 250) {
            title = text.replace(/\s+/g, ' ').trim();
            break;
          }
        }
        
        // Extract deal - check multiple selectors
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
        
        // Extract product name/subtitle
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
        
        // Extract pricing
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
        
        // Extract rating
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
        
        // Extract main image
        const mainImage = getAttr('#landingImage', 'src') || 
                         getAttr('#imgBlkFront', 'src') ||
                         getAttr('.a-dynamic-image', 'src');
        
        // Extract availability
        const availability = getText('#availability span') || 
                           getText('#availability') ||
                           getText('.a-color-success') ||
                           getText('.a-color-state');
        
        // Extract categories
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
        
        // Extract specifications - structured product details
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
        availability: null,
        specifications: {},
        categories: [],
        extractedAt: new Date().toISOString(),
        error: error.message
      };
    }
  }

  // STEP 2: Removed all Cheerio-based extraction methods (_extractTitle, _extractDeal, etc.)
  // Now using direct page.evaluate() in extractProductData()

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
    const failedProducts = [...this.checkpoint.failedProducts];
    this.checkpoint.failedProducts = [];
    
    const results = [];
    for (const failedProduct of failedProducts) {
      try {
        const productData = await this.cluster.execute({ url: failedProduct.url, type: 'retry' }, async ({ page, data }) => {
          await this.configurePage(page);
          await page.goto(data.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          return await this.extractProductData(page);
        });
        
        results.push({ url: failedProduct.url, ...productData });
        
        if (results.length >= 5) {
          this.saveData(results);
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
    
    if (results.length > 0) {
      this.saveData(results);
    }
    
    this.saveCheckpoint();
  }
}

module.exports = AmazonClusterCrawler;
