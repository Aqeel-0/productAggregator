const fs = require('fs');
const path = require('path');
const BaseCrawler = require('../base-crawler');

class AmazonDetailCrawler extends BaseCrawler {
  constructor(config) {
    super(config);
    this.debugHtmlCounter = 0;
    this.categoryUrl = 'https://www.amazon.in/s?i=electronics&rh=n%3A1389432031&s=popularity-rank&fs=true&page=1';
    this.checkpointFile = path.join(__dirname, 'checkpoint.json');
    this.outputFile = path.join(__dirname, 'amazon_scraped_data.json');
    this.productLinks = [];
    this.checkpoint = this.loadCheckpoint();
    this.maxProducts = config?.maxProducts || Infinity;
    
    // Ensure checkpoint has the required structure
    if (!this.checkpoint.productLinks) {
      this.checkpoint.productLinks = [];
    }
    if (this.checkpoint.lastProcessedIndex === undefined) {
      this.checkpoint.lastProcessedIndex = -1;
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
      this.logger.info('Starting Amazon detail crawler');
      
      if (this.checkpoint.productLinks.length === 0) {
        await this.scrapeProductLinks();
        this.saveCheckpoint();
      } else {
        this.productLinks = this.checkpoint.productLinks;
        this.logger.info(`Loaded ${this.productLinks.length} product links from checkpoint`);
      }

      await this.scrapeProductDetails();
      this.logger.info('Crawling completed successfully');
      
      // Close the browser to ensure the process exits
      await this.close();
    } catch (error) {
      this.logger.error(`Error during crawling: ${error.message}`);
      this.saveCheckpoint();
      await this.close();
      throw error;
    }
  }

  async scrapeProductLinks() {
    const page = await this.newPage();
    try {
      this.logger.info(`Navigating to category page: ${this.categoryUrl}`);
      await this.navigate(page, this.categoryUrl);
      
      // Wait for product grid to load
      await page.waitForSelector('.s-main-slot.s-result-list', { timeout: 10000 });
      
      // Extract product links
      this.productLinks = await page.evaluate(() => {
        const links = [];
        const products = document.querySelectorAll('.s-result-item[data-asin]:not([data-asin=""])');
        
        products.forEach(product => {
          const linkElement = product.querySelector('a.a-link-normal.s-no-outline');
          if (linkElement && linkElement.href) {
            links.push(linkElement.href);
          }
        });
        
        return links;
      });
      
      this.logger.info(`Found ${this.productLinks.length} product links`);
      this.checkpoint.productLinks = this.productLinks;
      await page.close();
    } catch (error) {
      this.logger.error(`Error scraping product links: ${error.message}`);
      await page.close();
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
        
        // Add a delay between requests
        await this.delay(2000, 5000);
      } catch (error) {
        this.logger.error(`Error processing product at index ${i}: ${error.message}`);
      }
    }
    
    this.logger.info(`Completed scraping ${endIndex - startIndex} products`);
  }

  async _scrapeProductDetail(url) {
    const page = await this.newPage();
    try {
      this.logger.info(`Scraping product details from: ${url}`);
      await this.navigate(page, url);
      
      await this.delay(500, 1500);
      
      // New multi-source scraping approach
      const productData = await this._extractProductData(page);
      
      await page.close();
      return { url, ...productData };
      
    } catch (error) {
      await page.close();
      this.logger.error(`Error scraping product detail: ${error.message}`);
      return { url, title: null, specifications: {} };
    }
  }

  async _extractProductData(page) {
    try {
      // Extract title
      const title = await this._extractTitle(page);
      
      // Extract specifications
      const specifications = await this._extractSpecifications(page);
      
      return { title, specifications };
    } catch (error) {
      this.logger.error(`Error extracting product data: ${error.message}`);
      return { title: null, specifications: {} };
    }
  }

  async _extractTitle(page) {
    try {
      return await page.evaluate(() => {
        const titleElement = document.querySelector('#productTitle');
        return titleElement ? titleElement.textContent.trim() : null;
      });
    } catch (error) {
      this.logger.error(`Error extracting title: ${error.message}`);
      return null;
    }
  }

  async _extractSpecifications(page) {
    try {
      const specifications = {};

      // Method 1: Product Overview Table
      try {
        const overviewData = await page.evaluate(() => {
          const specs = {};
          const overviewTable = document.querySelector('#productOverview_feature_div table');
          if (overviewTable) {
            const rows = overviewTable.querySelectorAll('tr');
            rows.forEach(row => {
              const key = row.querySelector('td:first-child span')?.innerText.trim();
              const value = row.querySelector('td:last-child span')?.innerText.trim();
              if (key && value) specs[key] = value;
            });
          }
          return specs;
        });
        Object.assign(specifications, overviewData);
      } catch (error) {
        this.logger.debug(`Error extracting product overview: ${error.message}`);
      }

      // Method 2: Technical Details Table (multiple selectors)
      try {
        const techSpecs = await page.evaluate(() => {
          const specs = {};
          const tables = [
            '#productDetails_techSpec_section_1',
            '#productDetails_detailBullets_sections1',
            '#detailBulletsWrapper_feature_div',
            '.detail-bullets-wrapper',
            '#prodDetails .prodDetTable',
            '#technicalSpecifications_section_1'
          ];
          for (const tableSelector of tables) {
            const table = document.querySelector(tableSelector);
            if (table) {
              const rows = table.querySelectorAll('tr, .a-spacing-micro');
              rows.forEach(row => {
                let key = row.querySelector('th, .a-text-bold')?.innerText.trim();
                let value = row.querySelector('td, .a-size-base')?.innerText.trim();
                if (!key && !value) { // Handle detail bullets format
                  const text = row.innerText;
                  if (text.includes(':')) {
                    [key, value] = text.split(':', 2).map(s => s.trim());
                  }
                }
                if (key && value) specs[key.replace(/\u200E|\u200F|\n/g, '')] = value.replace(/\u200E|\u200F|\n/g, '');
              });
            }
          }
          return specs;
        });
        Object.assign(specifications, techSpecs);
      } catch (error) {
        this.logger.debug(`Error extracting technical details: ${error.message}`);
      }

      // Method 3: Detail Bullets
      try {
        const bulletSpecs = await page.evaluate(() => {
          const specs = {};
          const detailBullets = document.querySelector('#detailBullets_feature_div');
          if (detailBullets) {
            const items = detailBullets.querySelectorAll('li');
            items.forEach(item => {
              const text = item.innerText;
              if (text.includes(':')) {
                let [key, value] = text.split(':', 2).map(s => s.trim());
                key = key.replace(/\u200E|\u200F|\n/g, '');
                value = value.replace(/\u200E|\u200F|\n/g, '');
                if (key && value) specs[key] = value;
              }
            });
          }
          return specs;
        });
        Object.assign(specifications, bulletSpecs);
      } catch (error) {
        this.logger.debug(`Error extracting detail bullets: ${error.message}`);
      }

      // Method 4: Feature Bullets
      try {
        const featureSpecs = await page.evaluate(() => {
          const specs = {};
          const featureBullets = document.querySelector('#feature-bullets');
          if (featureBullets) {
            const items = featureBullets.querySelectorAll('li');
            items.forEach((item, index) => {
              const text = item.innerText.trim();
              if (text) {
                if (text.includes(':')) {
                  const [key, value] = text.split(':', 2).map(s => s.trim());
                  specs[key] = value;
                } else {
                  specs[`Feature ${index + 1}`] = text;
                }
              }
            });
          }
          return specs;
        });
        Object.assign(specifications, featureSpecs);
      } catch (error) {
        this.logger.debug(`Error extracting feature bullets: ${error.message}`);
      }

      // Method 5: Product Description
      try {
        const descriptionSpecs = await page.evaluate(() => {
          const specs = {};
          const description = document.querySelector('#productDescription');
          if (description) {
            const text = description.innerText.trim();
            if (text) {
              specs['Description'] = text;
            }
          }
          return specs;
        });
        Object.assign(specifications, descriptionSpecs);
      } catch (error) {
        this.logger.debug(`Error extracting product description: ${error.message}`);
      }

      return specifications;
    } catch (error) {
      this.logger.error(`Error extracting specifications: ${error.message}`);
      return {};
    }
  }
}

// Run the crawler if this script is executed directly
if (require.main === module) {
  const crawler = new AmazonDetailCrawler({
    headless: true,
    proxyConfig: {
      useProxy: false
    },
    maxProducts: 2
  });
  
  crawler.start().catch(error => {
    console.error('Crawler failed:', error);
    process.exit(1);
  });
}

module.exports = AmazonDetailCrawler; 