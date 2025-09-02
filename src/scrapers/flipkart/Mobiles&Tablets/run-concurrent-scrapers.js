const FlipkartCrawler = require('./flipkartMobileCrawler');

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
  tablet: {
    category: 'tablet',
    categoryUrl: 'https://www.flipkart.com/tablets/pr?sid=tyy%2Chry&otracker=categorytree&p%5B%5D=facets.availability%255B%255D%3DExclude%2BOut%2Bof%2BStock&page=1',
    maxProducts: 600,
    totalMaxProducts: 3000,
    maxPages: 40,
    maxConcurrent: 5,
    delayBetweenPages: 3000,
    // Related products configuration
    totalMaxProducts: 1000, // Total products including related
    relatedProducts: {
      enabled: true,
      maxPerProduct: 5 // Max related products per main product
    }
  }
};

async function runScrapers() {
  console.log('🚀 Starting concurrent Flipkart scrapers...\n');
  
  const scrapers = [];
  
  // Create scrapers for each category
  for (const [category, config] of Object.entries(configs)) {
    console.log(`📱 Initializing ${category} scraper...`);
    const scraper = new FlipkartCrawler({
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
