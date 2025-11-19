#!/usr/bin/env node

/**
 * Debug test to see if scrapers can be initialized
 */

const path = require('path');

console.log('Testing scraper imports...\n');

try {
  console.log('1. Importing AmazonCrawler...');
  const AmazonCrawler = require('../../src/scrapers/amazon/crawler/amazonElectronicsCrawler');
  console.log('   ✓ AmazonCrawler imported');

  console.log('\n2. Creating AmazonCrawler instance...');
  const config = {
    category: 'test_mouse',
    categoryUrl: 'https://www.amazon.in/s?k=wireless+mouse',
    maxProducts: 3,
    maxPages: 1,
    headless: true,
    checkpointFile: path.join(__dirname, '../../src/scrapers/amazon/checkpoints/test_mouse_checkpoint.json'),
    outputFile: path.join(__dirname, '../../src/scrapers/amazon/raw_data/test_mouse_scraped_data.json')
  };

  const scraper = new AmazonCrawler(config);
  console.log('   ✓ AmazonCrawler instance created');
  console.log('   Config:', {
    category: scraper.category,
    maxProducts: scraper.maxProducts,
    checkpointFile: scraper.checkpointFile,
    outputFile: scraper.outputFile
  });

  console.log('\n3. Testing initialization...');
  scraper.initialize()
    .then(() => {
      console.log('   ✓ Browser initialized');
      return scraper.shutdown();
    })
    .then(() => {
      console.log('   ✓ Shutdown complete');
      console.log('\n✅ All basic tests passed!');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Error during initialization:', error.message);
      console.error(error.stack);
      process.exit(1);
    });

} catch (error) {
  console.error('\n❌ Error importing or creating scraper:', error.message);
  console.error(error.stack);
  process.exit(1);
}

