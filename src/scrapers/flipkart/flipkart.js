const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');

class FlipkartScraper {
  constructor(options = {}) {
    this.baseUrl = 'https://www.flipkart.com';
    this.categoryUrl = '/mobile-phones-store';
    this.outputDir = options.outputDir || path.join(__dirname, '../../../scraped_data/flipkart');
    this.results = [];
    this.browser = null;
    this.page = null;
    this.startPage = options.startPage || 1;
    this.endPage = options.endPage || undefined;
    this.maxPages = options.maxPages || 5;
    this.delay = options.delay || 2000;
    
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  async initialize() {
    this.browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    this.page = await this.browser.newPage();
    
    // Set user agent to avoid bot detection
    await this.page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'
    );
    
    // Set viewport
    await this.page.setViewport({
      width: 1366,
      height: 768
    });
  }

  async scrapePages(startPage = 1, endPage = undefined) {
    if (!this.browser) {
      await this.initialize();
    }
    
    try {
      let currentPage = startPage;
      const maxPagesToScrape = endPage ? (endPage - startPage + 1) : this.maxPages;
      
      while (currentPage <= (endPage || Number.MAX_SAFE_INTEGER) && (currentPage - startPage + 1) <= maxPagesToScrape) {
        console.log(`Scraping page ${currentPage}...`);
        
        // Navigate to the category page with the current page number
        const pageUrl = `${this.baseUrl}${this.categoryUrl}?page=${currentPage}`;
        await this.page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        
        // Wait for the product grid to load
        await this.page.waitForSelector('._1YokD2._3Mn1Gg');
        
        // Extract product links
        const productLinks = await this.extractProductLinks();
        console.log(`Found ${productLinks.length} products on page ${currentPage}`);
        
        // Scrape each product
        for (const link of productLinks) {
          try {
            const product = await this.scrapeProduct(link);
            if (product) {
              this.results.push(product);
              console.log(`Scraped product: ${product.title}`);
            }
          } catch (error) {
            console.error(`Error scraping product ${link}:`, error);
          }
          
          // Add delay between product scrapes
          await this.sleep(this.delay);
        }
        
        // Save results after each page
        this.saveResults(`flipkart_products_page_${currentPage}.json`);
        
        // Check if there's a next page
        const hasNextPage = await this.hasNextPage();
        if (!hasNextPage) {
          console.log('No more pages to scrape.');
          break;
        }
        
        currentPage++;
        
        // Add delay between page scrapes
        await this.sleep(this.delay * 2);
      }
      
      // Save final results
      this.saveResults('flipkart_products_all.json');
      
      return this.results;
    } catch (error) {
      console.error('Error during scraping:', error);
      throw error;
    } finally {
      await this.browser.close();
    }
  }

  async extractProductLinks() {
    return await this.page.evaluate(() => {
      const links = [];
      const productCards = document.querySelectorAll('._1AtVbE');
      
      productCards.forEach(card => {
        const linkElement = card.querySelector('a');
        if (linkElement && linkElement.href && linkElement.href.includes('/p/')) {
          links.push(linkElement.href);
        }
      });
      
      return links;
    });
  }

  async scrapeProduct(url) {
    try {
      await this.page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      
      // Wait for the product title to load
      await this.page.waitForSelector('.B_NuCI', { timeout: 5000 }).catch(() => {});
      
      // Get page HTML
      const html = await this.page.content();
      const $ = cheerio.load(html);
      
      // Extract product details
      const title = $('.B_NuCI').text().trim();
      
      if (!title) {
        console.log('No title found, skipping product');
        return null;
      }
      
      const price = this.extractPrice($);
      const rating = this.extractRating($);
      const reviewCount = this.extractReviewCount($);
      const images = this.extractImages($);
      const specifications = this.extractSpecifications($);
      const description = this.extractDescription($);
      
      return {
        url,
        title,
        price,
        rating,
        reviewCount,
        images,
        specifications,
        description,
        source: 'flipkart',
        scraped_at: new Date().toISOString()
      };
    } catch (error) {
      console.error(`Error scraping product at ${url}:`, error);
      return null;
    }
  }

  extractPrice($) {
    const priceElement = $('._30jeq3._16Jk6d').first();
    if (priceElement.length) {
      let price = priceElement.text().trim();
      // Clean up price string
      price = price.replace(/[^\d,.]/g, '');
      return price;
    }
    return null;
  }

  extractRating($) {
    const ratingElement = $('._3LWZlK').first();
    if (ratingElement.length) {
      return parseFloat(ratingElement.text().trim());
    }
    return null;
  }

  extractReviewCount($) {
    const reviewElement = $('._2_R_DZ').first();
    if (reviewElement.length) {
      const text = reviewElement.text().trim();
      const match = text.match(/(\d+(?:,\d+)*)\s+reviews/i);
      if (match) {
        return parseInt(match[1].replace(/,/g, ''));
      }
    }
    return 0;
  }

  extractImages($) {
    const images = [];
    
    // Try to get images from the image gallery
    $('._2E1FGS img').each((i, el) => {
      const src = $(el).attr('src');
      if (src) {
        images.push(src);
      }
    });
    
    // If no images found in the gallery, try the main image
    if (images.length === 0) {
      const mainImage = $('._396cs4').attr('src');
      if (mainImage) {
        images.push(mainImage);
      }
    }
    
    return images;
  }

  extractSpecifications($) {
    const specifications = {};
    
    // Extract specifications from the details section
    $('._14cfVK').each((i, row) => {
      const key = $(row).find('._1hKmbr').text().trim();
      const value = $(row).find('._21lJbe').text().trim();
      if (key && value) {
        specifications[key] = value;
      }
    });
    
    // Extract specifications from the table
    $('._1UhVsV ._3k-BhJ').each((i, row) => {
      const key = $(row).find('._1w62sE').text().trim();
      const value = $(row).find('._3hSQBE').text().trim();
      if (key && value) {
        specifications[key] = value;
      }
    });
    
    return specifications;
  }

  extractDescription($) {
    return $('._1mXcCf').text().trim() || '';
  }

  async hasNextPage() {
    return await this.page.evaluate(() => {
      const nextButton = document.querySelector('._1LKTO3');
      return nextButton && !nextButton.classList.contains('_3fVaIS');
    });
  }

  saveResults(filename) {
    const filePath = path.join(this.outputDir, filename);
    fs.writeFileSync(filePath, JSON.stringify(this.results, null, 2));
    console.log(`Saved ${this.results.length} products to ${filePath}`);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Allow running directly
if (require.main === module) {
  const startPage = parseInt(process.argv[2], 10) || 1;
  const endPage = process.argv[3] ? parseInt(process.argv[3], 10) : undefined;
  const maxPages = process.argv[4] ? parseInt(process.argv[4], 10) : undefined;
  const delay = process.argv[5] ? parseInt(process.argv[5], 10) : undefined;
  const scraper = new FlipkartScraper({ startPage, endPage, maxPages, delay, outputDir: '' });
  scraper.scrapePages(scraper.startPage, scraper.endPage).then(result => {
    console.log('Scraping result:', scraper.results.slice(0, 10));
    if (scraper.results.length > 0) {
      console.log(`Fetched ${scraper.results.length} products`);
    }
  }).catch(console.error);
}

module.exports = FlipkartScraper; 