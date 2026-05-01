const FlipkartCrawler = require('./flipkartMobileCrawler');
const Logger = require('../../../utils/logger');

// Parse configuration passed from DashboardServer
const uiConfig = process.env.CRAWLER_CONFIG ? JSON.parse(process.env.CRAWLER_CONFIG) : {};

// Configuration for different categories
const configs = {
  mobile: {
    category: 'mobile',
    categoryUrl: 'https://www.flipkart.com/mobiles/pr?sid=tyy%2C4io&otracker=categorytree&p%5B%5D=facets.availability%255B%255D%3DExclude%2BOut%2Bof%2BStock&p%5B%5D=facets.type%255B%255D%3DSmartphones&page=1',
    maxProducts: uiConfig.maxProducts !== undefined ? uiConfig.maxProducts : 45,
    maxPages: uiConfig.maxPages !== undefined ? uiConfig.maxPages : 50,
    maxConcurrent: uiConfig.maxConcurrent !== undefined ? uiConfig.maxConcurrent : 10,
    delayBetweenPages: uiConfig.delayBetweenPages !== undefined ? uiConfig.delayBetweenPages : 2000,
    // Related products configuration
    relatedProducts: {
      enabled: uiConfig.relatedProducts?.enabled !== undefined ? uiConfig.relatedProducts.enabled : true,
      maxPerProduct: uiConfig.relatedProducts?.maxPerProduct !== undefined ? uiConfig.relatedProducts.maxPerProduct : 2
    }
  },
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
      headless: uiConfig.headless !== undefined ? uiConfig.headless : true
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
    logger.error(`Fatal error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { runScrapers, configs };
