const FlipkartCrawler = require('./flipkartMobileCrawler');
const Logger = require('../../../utils/logger');

// Configuration for different categories
const configs = {
  // mobile: {
  //   category: 'mobile',
  //   categoryUrl: 'https://www.flipkart.com/mobiles/pr?sid=tyy%2C4io&otracker=categorytree&p%5B%5D=facets.availability%255B%255D%3DExclude%2BOut%2Bof%2BStock&p%5B%5D=facets.type%255B%255D%3DSmartphones&page=1',
  //   maxProducts: 50,
  //   maxPages: 5,
  //   maxConcurrent: 2,
  //   delayBetweenPages: 2000,
  //   // Related products configuration - DISABLED for mobile
  //   relatedProducts: {
  //     enabled: false // Disable related products for mobile
  //   }
  // },
  // tablet: {
  //   category: 'tablet',
  //   categoryUrl: 'https://www.flipkart.com/tablets/pr?sid=tyy%2Chry&otracker=categorytree&p%5B%5D=facets.availability%255B%255D%3DExclude%2BOut%2Bof%2BStock&page=1',
  //   maxProducts: 600,
  //   totalMaxProducts: 3000,
  //   maxPages: 40,
  //   maxConcurrent: 5,
  //   delayBetweenPages: 3000,
  //   // Related products configuration
  //   totalMaxProducts: 1000, // Total products including related
  //   relatedProducts: {
  //     enabled: true,
  //     maxPerProduct: 5 // Max related products per main product
  //   }
  // },
  Mouse: {
    category: 'mouse',
    categoryUrl: 'https://www.flipkart.com/computers/computer-peripherals/keyboards-mouse-accessories/mouse/pr?sid=6bo%2Ctia%2C8pp%2Cp0w&otracker=categorytree&page=1',
    maxProducts: 1000,
    totalMaxProducts: 3000,
    maxPages: 40,
    maxConcurrent: 5,
    delayBetweenPages: 3000,
    relatedProducts: {
      enabled: true,
      maxPerProduct: 5 // Max related products per main product
    }
  }
};

async function runScrapers() {
  const logger = new Logger('FLIPKART');
  logger.info('Starting concurrent Flipkart scrapers...');
  
  const scrapers = [];
  
  // Create scrapers for each category
  for (const [category, config] of Object.entries(configs)) {
    logger.info(`Initializing ${category} scraper...`);
    const scraper = new FlipkartCrawler({
      ...config,
      headless: true
    });
    scrapers.push({ category, scraper });
  }
  
  // Run all scrapers concurrently
  const promises = scrapers.map(async ({ category, scraper }) => {
    try {
      logger.info(`Starting ${category} scraper...`);
      await scraper.start();
      logger.success(`${category} scraper completed successfully`);
    } catch (error) {
      logger.error(`${category} scraper failed: ${error.message}`);
      throw error;
    }
  });
  
  // Wait for all scrapers to complete
  try {
    await Promise.all(promises);
    logger.success('All scrapers completed successfully!');
  } catch (error) {
    logger.error(`One or more scrapers failed: ${error.message}`);
    process.exit(1);
  }
}

// Run if this file is executed directly
if (require.main === module) {
  runScrapers().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { runScrapers, configs };
