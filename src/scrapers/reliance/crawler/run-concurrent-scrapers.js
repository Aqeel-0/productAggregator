const RelianceCrawler = require('./relianceCrawler');
const Logger = require('../../../utils/logger');

// Parse configuration passed from DashboardServer
const uiConfig = process.env.CRAWLER_CONFIG ? JSON.parse(process.env.CRAWLER_CONFIG) : {};

// Configuration for different categories
const configs = {
  mobile: {
    category: 'mobile',
    categoryUrl: 'https://www.reliancedigital.in/collection/mobiles/?page_no=1&is_available=true',
    maxProducts: uiConfig.maxProducts !== undefined ? uiConfig.maxProducts : 30,
    maxPages: uiConfig.maxPages !== undefined ? uiConfig.maxPages : 60,
    maxConcurrent: uiConfig.maxConcurrent !== undefined ? uiConfig.maxConcurrent : 5,
    delayBetweenPages: uiConfig.delayBetweenPages !== undefined ? uiConfig.delayBetweenPages : 2000
  }
};

async function runScrapers() {
  const logger = new Logger('RELIANCE');
  logger.info('Starting concurrent Reliance scrapers...');

  const scrapers = [];

  // Create scrapers for each category
  for (const [category, config] of Object.entries(configs)) {
    logger.info(`Initializing ${category} scraper...`);
    const scraper = new RelianceCrawler({
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
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { runScrapers, configs };