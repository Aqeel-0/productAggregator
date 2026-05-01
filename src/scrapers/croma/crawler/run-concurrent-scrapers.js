const CromaCrawler = require('./cromaCrawler');
const Logger = require('../../../utils/logger');
const { setupSignalHandlers } = require('../../crawler-utils');

// Parse configuration passed from DashboardServer
const uiConfig = process.env.CRAWLER_CONFIG ? JSON.parse(process.env.CRAWLER_CONFIG) : {};

// Configuration for different categories
const configs = {
  mobile: {
    category: 'mobile',
    categoryUrl: 'https://www.croma.com/phones-wearables/c/1?q=%3Arelevance%3Alower_categories%3A95%3Alower_categories%3A97',
    maxProducts: uiConfig.maxProducts !== undefined ? uiConfig.maxProducts : 20,
    maxPages: uiConfig.maxPages !== undefined ? uiConfig.maxPages : undefined,
    maxConcurrent: uiConfig.maxConcurrent !== undefined ? uiConfig.maxConcurrent : 6,
    delayBetweenPages: uiConfig.delayBetweenPages !== undefined ? uiConfig.delayBetweenPages : 3000
  }
};

async function runScrapers() {
  const logger = new Logger('CROMA');
  logger.info('Starting concurrent Croma scrapers...');

  const scraperInstances = [];

  for (const [category, config] of Object.entries(configs)) {
    logger.info(`Initializing ${category} scraper...`);
    const scraper = new CromaCrawler({
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

  const failures = results.filter(r => r.status === 'rejected');
  if (failures.length > 0) {
    failures.forEach(r => logger.error(`Scraper failed: ${r.reason?.message || r.reason}`));
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