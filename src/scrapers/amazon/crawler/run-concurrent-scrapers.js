const AmazonDetailCrawler = require('./amazonElectronicsCrawler');
const Logger = require('../../../utils/logger');

// Configuration for different categories
const configs = {
  // mobile: {
  //   category: 'mobile',
  //   categoryUrl: 'https://www.amazon.in/s?i=electronics&rh=n%3A1389401031&s=popularity-rank&page=1',
  //   maxProducts: 50,
  //   maxPages: 5,
  //   maxConcurrent: 2,
  //   delayBetweenPages: 2000
  // },
  // tablet: {
  //   category: 'tablet',
  //   categoryUrl: 'https://www.amazon.in/s?i=computers&rh=n%3A1375458031&s=popularity-rank&page=1',
  //   maxProducts: 1000,
  //   maxPages: 40,
  //   maxConcurrent: 7,
  //   delayBetweenPages: 3000
  // },
  Mouse: {
    category: 'Mouse',
    categoryUrl: 'https://www.amazon.in/s?i=computers&rh=n%3A1375420031%2Cp_36%3A48000-1620000%2Cp_n_feature_ten_browse-bin%3A27264558031%257C27264560031%257C56613383031%2Cp_n_g-1003340631111%3A28503468031%257C28503469031%257C28503470031%2Cp_72%3A1318476031&s=popularity-rank&dc&fs=true&page=1',
    maxProducts: 1000,
    maxPages: 100,
    maxConcurrent: 5,
    delayBetweenPages: 2000
  },
  // Mouse_Logitech: {
  //   category: 'mouse_logitech',
  //   categoryUrl: 'https://www.amazon.in/s?i=computers&srs=83148060031&rh=n%3A976392031%2Cn%3A1375248031%2Cn%3A1375412031%2Cn%3A1375420031%2Cp_89%3ALogitech&dc&page=2',
  //   maxProducts: 150,
  //   maxPages: 50,
  //   maxConcurrent: 7,
  //   delayBetweenPages: 2000
  // }
};

async function runScrapers() {
  const logger = new Logger('AMAZON');
  logger.info('Starting concurrent Amazon scrapers...');
  
  const scrapers = [];
  
  // Create scrapers for each category
  for (const [category, config] of Object.entries(configs)) {
    logger.info(`Initializing ${category} scraper...`);
    const scraper = new AmazonDetailCrawler({
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
