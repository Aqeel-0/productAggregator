const CromaCrawler = require('./cromaCrawler');
const Logger = require('../../../utils/logger');

// Configuration for different categories
const configs = {
  mobile: {
    category: 'mobile',
    categoryUrl: 'https://www.croma.com/phones-wearables/c/1?q=%3Arelevance%3Alower_categories%3A95%3Alower_categories%3A97',
    maxProducts: 10,
    maxConcurrent: 6,
    delayBetweenPages: 3000
  }
};

async function runScrapers() {
  const logger = new Logger('CROMA');
  logger.info('Starting concurrent Croma scrapers...');
  
  const scrapers = [];
  
  // Create scrapers for each category
  for (const [category, config] of Object.entries(configs)) {
    logger.info(`Initializing ${category} scraper...`);
    const scraper = new CromaCrawler({
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