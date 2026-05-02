const FlipkartCrawler = require('./flipkartMobileCrawler');
const Logger = require('../../../utils/logger');
const { setupSignalHandlers } = require('../../crawler-utils');

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

  const scraperInstances = [];

  for (const [category, config] of Object.entries(configs)) {
    logger.info(`Initializing ${category} scraper...`);
    const scraper = new FlipkartCrawler({
      ...config,
      headless: uiConfig.headless !== undefined ? uiConfig.headless : true
    });
    scraperInstances.push(scraper);
  }

  let shuttingDown = false;
  const runnerShutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Shutting down all scrapers (${signal})...`);
    await Promise.all(scraperInstances.map(s => s.shutdown().catch(() => {})));
    process.exit(0);
  };
  const cleanupSignals = setupSignalHandlers(runnerShutdown, logger);

  const results = await Promise.allSettled(
    scraperInstances.map(s => s.start().then(() => null).catch(err => err))
  );
  cleanupSignals();

  const failures = results.filter(r => r.value !== null);
  if (failures.length > 0) {
    failures.forEach(r => logger.error(`Scraper failed: ${r.value?.message || r.value}`));
    logger.error(`${failures.length} scraper(s) failed`);
    process.exit(1);
  }

  logger.success('All scrapers completed successfully!');
}

if (require.main === module) {
  runScrapers().catch(error => {
    console.error('Fatal error:', error?.message || error);
    process.exit(1);
  });
}

module.exports = { runScrapers, configs };
