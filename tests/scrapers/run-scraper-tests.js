#!/usr/bin/env node

/**
 * Scraper Test Runner
 * Provides convenient command-line interface for running scraper tests
 * 
 * Usage:
 *   node tests/scrapers/run-scraper-tests.js              # Run all scrapers
 *   node tests/scrapers/run-scraper-tests.js amazon       # Run Amazon only
 *   node tests/scrapers/run-scraper-tests.js flipkart     # Run Flipkart only
 *   node tests/scrapers/run-scraper-tests.js --quick      # Quick test with 3 products
 *   node tests/scrapers/run-scraper-tests.js --full       # Full test with 10 products
 */

const ScraperFunctionalTests = require('./scraper-functional.test');

// Parse command line arguments
const args = process.argv.slice(2);
const scraperArg = args.find(arg => !arg.startsWith('--'));
const isQuick = args.includes('--quick');
const isFull = args.includes('--full');

// Configure test based on arguments
if (scraperArg) {
  const validScrapers = ['amazon', 'flipkart', 'croma', 'reliance'];
  if (!validScrapers.includes(scraperArg)) {
    console.error(`❌ Invalid scraper: ${scraperArg}`);
    console.error(`Valid options: ${validScrapers.join(', ')}`);
    process.exit(1);
  }
  process.env.TEST_SCRAPER = scraperArg;
}

if (isQuick) {
  process.env.TEST_MAX_PRODUCTS = '3';
} else if (isFull) {
  process.env.TEST_MAX_PRODUCTS = '10';
}

// Display banner
console.log('\n' + '='.repeat(70));
console.log('🧪 SCRAPER FUNCTIONAL TEST SUITE');
console.log('='.repeat(70));

if (scraperArg) {
  console.log(`Scraper: ${scraperArg.toUpperCase()}`);
}

if (isQuick) {
  console.log('Mode: Quick (3 products)');
} else if (isFull) {
  console.log('Mode: Full (10 products)');
} else {
  console.log('Mode: Standard (5 products)');
}

console.log('='.repeat(70));

// Run tests
const tests = new ScraperFunctionalTests();

tests.runAll()
  .then(results => {
    const summary = {
      total: results.length,
      passed: results.filter(r => r.status === 'PASS').length,
      failed: results.filter(r => r.status === 'FAIL').length,
      skipped: results.filter(r => r.status === 'SKIP').length
    };

    // Display final summary
    console.log('\n' + '='.repeat(70));
    console.log('📊 FINAL SUMMARY');
    console.log('='.repeat(70));
    console.log(`Total Tests: ${summary.total}`);
    console.log(`✓ Passed: ${summary.passed}`);
    console.log(`✗ Failed: ${summary.failed}`);
    console.log(`○ Skipped: ${summary.skipped}`);
    console.log('='.repeat(70));

    // Exit with appropriate code
    process.exit(summary.failed > 0 ? 1 : 0);
  })
  .catch(error => {
    console.error('\n❌ Fatal error running tests:', error);
    console.error(error.stack);
    process.exit(1);
  });

