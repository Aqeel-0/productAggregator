const RelianceCrawler = require('./relianceCrawler');
const Logger = require('../../../utils/logger');
const { setupSignalHandlers } = require('../../crawler-utils');

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

  const scraperInstances = [];

  for (const [category, config] of Object.entries(configs)) {
    logger.info(`Initializing ${category} scraper...`);
    const scraper = new RelianceCrawler({
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