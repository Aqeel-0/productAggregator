const AmazonDetailCrawler = require('./amazonElectronicsCrawler');

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
  tablet: {
    category: 'tablet',
    categoryUrl: 'https://www.amazon.in/s?i=computers&rh=n%3A1375458031&s=popularity-rank&page=1',
    maxProducts: 1000,
    maxPages: 40,
    maxConcurrent: 7,
    delayBetweenPages: 3000
  }
};

async function runScrapers() {
  console.log('🚀 Starting concurrent Amazon scrapers...\n');
  
  const scrapers = [];
  
  // Create scrapers for each category
  for (const [category, config] of Object.entries(configs)) {
    console.log(`📱 Initializing ${category} scraper...`);
    const scraper = new AmazonDetailCrawler({
      ...config,
      headless: true
    });
    scrapers.push({ category, scraper });
  }
  
  // Run all scrapers concurrently
  const promises = scrapers.map(async ({ category, scraper }) => {
    try {
      console.log(`▶️  Starting ${category} scraper...`);
      await scraper.start();
      console.log(`✅ ${category} scraper completed successfully`);
    } catch (error) {
      console.error(`❌ ${category} scraper failed:`, error.message);
      throw error;
    }
  });
  
  // Wait for all scrapers to complete
  try {
    await Promise.all(promises);
    console.log('\n🎉 All scrapers completed successfully!');
  } catch (error) {
    console.error('\n💥 One or more scrapers failed:', error.message);
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
