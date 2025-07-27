const fs = require('fs');
const path = require('path');
const BaseCrawler = require('../base-crawler');
const cheerio = require('cheerio');
const { CATEGORY_SELECTORS, PRODUCT_SELECTORS } = require('./flipkart-selectors');
const RateLimiter = require('../../rate-limiter/RateLimiter');
const FlipkartRateLimitConfig = require('../../rate-limiter/configs/flipkart-config');

class FlipkartCrawler extends BaseCrawler {
  constructor(config = {}) {
    const defaultConfig = {
      headless: config.headless !== undefined ? config.headless : true,
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
      // Enhanced memory management configuration for Flipkart
      memoryManagement: {
        enabled: true,
        maxMemoryMB: 1024, // 1GB for Flipkart
        maxPages: 4, // Slightly more generous than Amazon
        pagePoolSize: 3, // Larger pool for Flipkart
        cleanupInterval: 60000, // 1 minute
        forceGCInterval: 240000, // 4 minutes
        memoryCheckInterval: 25000, // 25 seconds
      }
    };
    
    super({ ...defaultConfig, ...config });
    this.categoryUrl = 'https://www.flipkart.com/mobiles/pr?sid=tyy,4io&otracker=categorytree';
    this.checkpointFile = path.join(__dirname, 'checkpoint-rate-limited.json');
    this.outputFile = path.join(__dirname, 'flipkart_scraped_data_rate_limited.json');
    this.productLinks = [];
    this.checkpoint = this.loadCheckpoint();
    this.maxProducts = config?.maxProducts || Infinity;
    
    // Initialize rate limiter
    this.rateLimiter = new RateLimiter({
      redis: { enabled: false }, // Use memory-based for simplicity
      defaultAlgorithm: FlipkartRateLimitConfig.algorithm,
      cleanupInterval: 60000 // 1 minute cleanup
    });
    
    // Register Flipkart-specific rules
    this.rateLimiter.registerRules('flipkart', FlipkartRateLimitConfig);
    
    // Ensure checkpoint has the required structure
    if (!this.checkpoint.productLinks) {
      this.checkpoint.productLinks = [];
    }
    if (this.checkpoint.lastProcessedIndex === undefined) {
      this.checkpoint.lastProcessedIndex = -1;
    }
    
    this.logger.info('Rate limiter and memory management initialized with Flipkart configuration');
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
    return { productLinks: [], lastProcessedIndex: -1 };
  }

  saveCheckpoint() {
    try {
      fs.writeFileSync(this.checkpointFile, JSON.stringify(this.checkpoint, null, 2));
      this.logger.info('Checkpoint saved');
    } catch (error) {
      this.logger.error(`Error saving checkpoint: ${error.message}`);
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
      const combinedData = [...existingData, ...newData];
      
      fs.writeFileSync(this.outputFile, JSON.stringify(combinedData, null, 2));
      this.logger.info(`Saved ${newData.length} products to ${this.outputFile}`);
    } catch (error) {
      this.logger.error(`Error saving data: ${error.message}`);
    }
  }

  async start() {
    try {
      this.logger.info('Starting Flipkart detail crawler with rate limiting');
      
      if (this.checkpoint.productLinks.length === 0) {
        await this.scrapeProductLinks();
        this.saveCheckpoint();
      } else {
        this.productLinks = this.checkpoint.productLinks;
        this.logger.info(`Loaded ${this.productLinks.length} product links from checkpoint`);
      }

      await this.scrapeProductDetails();
      this.logger.info('Crawling completed successfully');
      
      // Enhanced cleanup to ensure proper shutdown
      await this.shutdown();
      
    } catch (error) {
      this.logger.error(`Error during crawling: ${error.message}`);
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
      this.logger.info('Starting enhanced shutdown process...');
      
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
      
      this.logger.info('Enhanced shutdown completed');
      
      // Force process exit after a short delay to ensure everything is cleaned up
      setTimeout(() => {
        this.logger.info('Forcing process exit');
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

  async scrapeProductLinks() {
    const page = await this.newPage();
    try {
      // Enable JavaScript for category page
      await page.setJavaScriptEnabled(true);
      
      this.logger.info(`Navigating to category page: ${this.categoryUrl}`);
      await this.navigate(page, this.categoryUrl);
      
      // Wait for page to load
      await page.waitForSelector('body', { timeout: 10000 });
      
      // Extract product links using XPath
      this.productLinks = await page.evaluate((xpath) => {
        const links = [];
        const result = document.evaluate(
          xpath,
          document,
          null,
          XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
          null
        );
        
        for (let i = 0; i < result.snapshotLength; i++) {
          const element = result.snapshotItem(i);
          if (element.href && element.href.includes('/p/')) {
            links.push(element.href);
          }
        }
        
        return links;
      }, CATEGORY_SELECTORS.PRODUCT_LINK);
      
      this.logger.info(`Found ${this.productLinks.length} product links`);
      this.checkpoint.productLinks = this.productLinks;
      
      // Return page to pool instead of closing
      await this.returnPageToPool(page);
    } catch (error) {
      this.logger.error(`Error scraping product links: ${error.message}`);
      await this.safeClosePage(page);
      throw error;
    }
  }

  async scrapeProductDetails() {
    const startIndex = this.checkpoint.lastProcessedIndex + 1;
    const endIndex = Math.min(this.productLinks.length, startIndex + this.maxProducts);
    
    this.logger.info(`Scraping product details from index ${startIndex} to ${endIndex - 1}`);
    
    const results = [];
    for (let i = startIndex; i < endIndex; i++) {
      const url = this.productLinks[i];
      this.logger.info(`Processing product ${i + 1}/${endIndex} (${url})`);
      
      try {
        const productData = await this._scrapeProductDetail(url);
        results.push(productData);
        
        // Update checkpoint after each product
        this.checkpoint.lastProcessedIndex = i;
        this.saveCheckpoint();
        
        // Save data in batches of 5 or at the end
        if (results.length >= 5 || i === endIndex - 1) {
          this.saveData(results);
          results.length = 0;
        }
        
        // Rate-limited delay calculation
        const rateLimitResult = await this.rateLimiter.checkLimit(`product-${i}`, 'flipkart');
        const adaptiveDelay = this.rateLimiter.calculateDelay(rateLimitResult, FlipkartRateLimitConfig.baseDelay);
        
        this.logger.info(`Rate limit status: ${rateLimitResult.remaining} requests remaining. Adaptive delay: ${adaptiveDelay}ms`);
        await this.delay(adaptiveDelay);
        
      } catch (error) {
        this.logger.error(`Error processing product at index ${i}: ${error.message}`);
      }
    }
    
    this.logger.info(`Completed scraping ${endIndex - startIndex} products`);
  }

  async _scrapeProductDetail(url) {
    const page = await this.newPage();
    try {
      // Enable JavaScript for Flipkart
      await page.setJavaScriptEnabled(true);
      
      this.logger.info(`Scraping product details from: ${url}`);
      
      await this.navigate(page, url);
      await this.delay(500, 1000);

      const productData = await this._extractProductData(page);
      
      // Return page to pool instead of closing
      await this.returnPageToPool(page);
      return { url, ...productData };
      
    } catch (error) {
      await this.safeClosePage(page);
      this.logger.error(`Error scraping product detail: ${error.message}`);
      return { url, title: null, specifications: {} };
    }
  }

  async _extractProductData(page) {
    try {
      const title = await this._extractTitle(page);
      const pricing = await this._extractPricing(page);
      const rating = await this._extractRating(page);
      const specifications = await this.get_specification(page);
      const categories = await this._extractCategories(page);
      const tags = await this._extractTags(page);
      const images = await this._extractImages(page);
      
      return { 
        title, 
        price: pricing,
        rating,
        specifications, 
        category: categories,
        tags: tags,
        image: images.main,
        //images: images.all
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
          const titleElement = getElementByXPath(xpath);
          if (titleElement && titleElement.textContent.trim()) {
            const title = titleElement.textContent.trim();
            if (title) {
              return title;
            }
          }
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
      await page.waitForTimeout(500);

      const result = await page.evaluate((selectors) => {
        const getElementByXPath = (xpath) => {
          const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
          return result.singleNodeValue;
        };
        
        const pricing = {
          current: null,
          original: null,
          discount: null
        };

        if (selectors.PRICE) {
          for (const xpath of selectors.PRICE) {
            const priceElement = getElementByXPath(xpath);
            if (priceElement && priceElement.textContent.includes('₹')) {
              const priceMatch = priceElement.textContent.trim().match(/₹([0-9,]+)/);
              if (priceMatch) {
                pricing.current = parseInt(priceMatch[1].replace(/,/g, ''));
                break;
              }
            }
          }
        }
        
        if (selectors.ORIGINAL_PRICE) {
          for (const xpath of selectors.ORIGINAL_PRICE) {
            const originalElement = getElementByXPath(xpath);
            if (originalElement && originalElement.textContent.includes('₹')) {
              const originalMatch = originalElement.textContent.trim().match(/₹([0-9,]+)/);
              if (originalMatch) {
                pricing.original = parseInt(originalMatch[1].replace(/,/g, ''));
                break;
              }
            }
          }
        }
        
        if (selectors.DISCOUNT) {
          for (const xpath of selectors.DISCOUNT) {
            const discountElement = getElementByXPath(xpath);
            if (discountElement && discountElement.textContent.includes('%')) {
              const discountMatch = discountElement.textContent.trim().match(/([0-9]+)%/);
              if (discountMatch) {
                pricing.discount = `${discountMatch[1]}% off`;
                break;
              }
            }
          }
        }

        return pricing;
      }, PRODUCT_SELECTORS);

      return result;
    } catch (error) {
      this.logger.error(`Error extracting pricing: ${error.message}`);
      return { current: null, original: null, discount: null };
    }
  }

  async _extractRating(page) {
    try {
      const result = await page.evaluate((selectors) => {
        const getElementByXPath = (xpath) => {
          const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
          return result.singleNodeValue;
        };
        
        const rating = {
          score: null,
          count: null
        };

        if (selectors.RATING) {
          for (const xpath of selectors.RATING) {
            const ratingElement = getElementByXPath(xpath);
            if (ratingElement && ratingElement.textContent.trim()) {
              const ratingText = ratingElement.textContent.trim();
              const ratingMatch = ratingText.match(/([0-9.]+)/);
              if (ratingMatch) {
                rating.score = parseFloat(ratingMatch[1]);
                break;
              }
            }
          }
        }

        if (selectors.RATING_COUNT) {
          for (const xpath of selectors.RATING_COUNT) {
            const countElement = getElementByXPath(xpath);
            if (countElement && countElement.textContent.trim()) {
              const countText = countElement.textContent.trim();
              const countMatch = countText.match(/([0-9,]+)/);
              if (countMatch) {
                rating.count = parseInt(countMatch[1].replace(/,/g, ''));
                break;
              }
            }
          }
        }

        return rating;
      }, PRODUCT_SELECTORS);

      return result;
    } catch (error) {
      this.logger.error(`Error extracting rating: ${error.message}`);
      return { score: null, count: null };
    }
  }

  async _extractCategories(page) {
    try {
      const html = await page.content();
      const $ = cheerio.load(html);
      
      const categories = [];
      
      const breadcrumbContainer = $('div._7dPnhA');
      
      if (breadcrumbContainer.length > 0) {
        breadcrumbContainer.find('a.R0cyWM').each((_, element) => {
          const categoryText = $(element).text().trim();
          categories.push(categoryText);
        });
        
        const finalCategory = breadcrumbContainer.find('div.KalC6f p').text().trim();
        categories.push(finalCategory);
      }
      
      return categories;
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
          for (let i = 0; i < result.snapshotLength; i++) {
            elements.push(result.snapshotItem(i));
          }
          return elements;
        };

        let mainImage = null;
        let allImages = [];

        if (selectors.MAIN_IMAGE) {
          for (const xpath of selectors.MAIN_IMAGE) {
            const imgElement = getElementByXPath(xpath);
            if (imgElement && imgElement.src) {
              mainImage = imgElement.src;
              break;
            }
          }
        }

        const imageElements = getAllElementsByXPath('//img[contains(@src, "rukminim")]');
        allImages = imageElements.map(img => img.src).filter(src => src);

        return {
          main: mainImage,
          all: allImages
        };
      }, PRODUCT_SELECTORS);
    } catch (error) {
      this.logger.error(`Error extracting images: ${error.message}`);
      return { main: null, all: [] };
    }
  }

  async get_specification(page) {
    this.logger.info('Extracting specifications with Cheerio...');
    try {
      const html = await page.content();
      const $ = cheerio.load(html);

      const specifications = {};
      const mainContainer = $('div._1OjC5I');

      if (mainContainer.length === 0) {
        this.logger.warn('Main specification container (div._1OjC5I) not found.');
        return {};
      }

      mainContainer.find('div.GNDEQ-').each((_, categoryEl) => {
        const categorySection = $(categoryEl);
        const categoryName = categorySection.find('div[class="_4BJ2V+"]').text().trim();
        
        if (!categoryName) {
          return;
        }

        specifications[categoryName] = {};
        this.logger.info(`Found specification category: ${categoryName}`);

        categorySection.find('tr.WJdYP6.row').each((_, rowEl) => {
          const row = $(rowEl);
          const fieldName = row.find('td.col-3-12').text().trim();
          let fieldValue = '';

          const valueCell = row.find('td.col-9-12');
          const listItem = valueCell.find('li.HPETK2');
          if (listItem.length > 0) {
            fieldValue = listItem.text().trim();
          } else {
            fieldValue = valueCell.text().trim();
          }

          if (fieldName && fieldValue) {
            specifications[categoryName][fieldName] = fieldValue;
          }
        });

        if (Object.keys(specifications[categoryName]).length === 0) {
          delete specifications[categoryName];
        }
      });

      this.logger.info(`Successfully extracted ${Object.keys(specifications).length} specification categories.`);
      return specifications;

    } catch (error) {
      this.logger.error(`Error extracting specifications with Cheerio: ${error.message}`);
      return {};
    }
  }

  async close() {
    await super.close();
    if (this.rateLimiter) {
      await this.rateLimiter.close();
    }
  }
}

// Run the crawler if this script is executed directly
if (require.main === module) {
  const crawler = new FlipkartDetailCrawlerRateLimited({
    headless: true,
    proxyConfig: {
      useProxy: false
    },
    maxProducts: 1
  });
  
  crawler.start()
    .then(() => {
      console.log('✅ Crawler completed successfully');
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Crawler failed:', error.message);
      process.exit(1);
    });
}

module.exports = FlipkartDetailCrawlerRateLimited; 