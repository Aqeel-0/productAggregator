const AmazonClusterCrawler = require('./amazonElectronicsCrawler');
const Logger = require('../../../utils/logger');
const { setupSignalHandlers } = require('../../crawler-utils');

// Parse configuration passed from DashboardServer
const uiConfig = process.env.CRAWLER_CONFIG ? JSON.parse(process.env.CRAWLER_CONFIG) : {};

// Configuration for different categories
const configs = {
  mobile: {
    category: 'mobile',
    categoryUrl: 'https://www.amazon.in/s?i=electronics&rh=n%3A976419031%2Cn%3A1389401031%2Cn%3A1389432031%2Cn%3A1805560031&s=popularity-rank',
    maxProducts: uiConfig.maxProducts !== undefined ? uiConfig.maxProducts : 200,
    maxPages: uiConfig.maxPages !== undefined ? uiConfig.maxPages : 100,
    maxConcurrent: uiConfig.maxConcurrent !== undefined ? uiConfig.maxConcurrent : 15,
    delayBetweenPages: uiConfig.delayBetweenPages !== undefined ? uiConfig.delayBetweenPages : 2000,
  },
  // tablet: {
  //   category: 'tablet',
  //   categoryUrl: 'https://www.amazon.in/s?i=computers&rh=n%3A1375458031&s=popularity-rank&page=1',
  //   maxProducts: 200,
  //   maxPages: 100,
  //   maxConcurrent: 15,
  //   delayBetweenPages: 2000
  // },
  // Mouse: {
  //   category: 'Mouse',
  //   categoryUrl: 'https://www.amazon.in/s?i=computers&rh=n%3A1375420031%2Cp_36%3A48000-1620000%2Cp_n_feature_ten_browse-bin%3A27264558031%257C27264560031%257C56613383031%2Cp_n_g-1003340631111%3A28503468031%257C28503469031%257C28503470031%2Cp_72%3A1318476031&s=popularity-rank&dc&fs=true&page=1',
  //   maxProducts: 200,
  //   maxPages: 100,
  //   maxConcurrent: 15,
  //   delayBetweenPages: 2000
  //},
  // Mouse_Logitech: {
  //   category: 'mouse_logitech',
  //   categoryUrl: 'https://www.amazon.in/s?i=computers&srs=83148060031&rh=n%3A976392031%2Cn%3A1375248031%2Cn%3A1375412031%2Cn%3A1375420031%2Cp_89%3ALogitech&dc&page=2',
  //   maxProducts: 200,
  //   maxPages: 100,
  //   maxConcurrent: 15,
  //   delayBetweenPages: 2000
  // }
};

async function runScrapers() {
  const logger = new Logger('AMAZON');
  logger.info('Starting concurrent Amazon scrapers...');

  const scraperInstances = [];

  for (const [category, config] of Object.entries(configs)) {
    logger.info(`Initializing ${category} scraper...`);
    const scraper = new AmazonClusterCrawler({
      ...config,
      headless: uiConfig.headless !== undefined ? uiConfig.headless : true,
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
