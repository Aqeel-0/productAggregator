#!/usr/bin/env node

/**
 * Smoke Tests for All Scrapers
 * Quick validation that scrapers can be imported and initialized
 * Does NOT perform actual scraping (use scraper-functional.test.js for that)
 * 
 * Usage: npm run test:scrapers:smoke
 */

const path = require('path');
const fs = require('fs');

// Import scrapers
const AmazonCrawler = require('../../src/scrapers/amazon/crawler/amazonElectronicsCrawler');
const FlipkartCrawler = require('../../src/scrapers/flipkart/crawler/flipkartMobileCrawler');
const CromaCrawler = require('../../src/scrapers/croma/crawler/cromaCrawler');
const RelianceCrawler = require('../../src/scrapers/reliance/crawler/relianceCrawler');

class ScraperSmokeTests {
  constructor() {
    this.results = [];
  }

  async runAll() {
    console.log('\n🚀 Running Scraper Smoke Tests\n');
    console.log('These tests validate scraper structure without actual scraping.\n');

    try {
    await this.testScraper('Amazon', AmazonCrawler, {
      category: 'test',
      categoryUrl: 'https://www.amazon.in/s?k=test',
      maxProducts: 5,
      maxPages: 1,
      headless: true
    });

    await this.testScraper('Flipkart', FlipkartCrawler, {
      category: 'test',
      categoryUrl: 'https://www.flipkart.com/search?q=test',
      maxProducts: 5,
      maxPages: 1,
      headless: true
    });

    await this.testScraper('Croma', CromaCrawler, {
      category: 'test',
      categoryUrl: 'https://www.croma.com/test',
      maxProducts: 5,
      headless: true
    });

    await this.testScraper('Reliance', RelianceCrawler, {
      category: 'test',
      categoryUrl: 'https://www.reliancedigital.in/test',
      maxProducts: 5,
      maxPages: 1,
      headless: true
    });

    this.printResults();
    
    const failed = this.results.filter(r => r.tests.some(t => !t.passed)).length;
    return failed === 0;
    } catch (error) {
      console.error('\n❌ Fatal error during smoke tests:', error);
      return false;
    }
  }

  async testScraper(name, ScraperClass, config) {
    console.log(`📦 Testing ${name} Scraper...`);
    const tests = [];

    // Test 1: Import
    try {
      if (!ScraperClass) throw new Error('Scraper class not imported');
      tests.push({ name: 'Import', passed: true });
      console.log('   ✓ Import successful');
    } catch (error) {
      tests.push({ name: 'Import', passed: false, error: error.message });
      console.log(`   ✗ Import failed: ${error.message}`);
    }

    // Test 2: Instance Creation
    let scraper = null;
    try {
      scraper = new ScraperClass(config);
      if (!scraper) throw new Error('Scraper instance is null');
      tests.push({ name: 'Instance Creation', passed: true });
      console.log('   ✓ Instance created');
    } catch (error) {
      tests.push({ name: 'Instance Creation', passed: false, error: error.message });
      console.log(`   ✗ Instance creation failed: ${error.message}`);
      this.results.push({ scraper: name, tests });
      return;
    }

    // Test 3: Configuration
    try {
      if (!scraper.category) throw new Error('Missing category');
      if (!scraper.categoryUrl) throw new Error('Missing categoryUrl');
      if (!scraper.outputFile) throw new Error('Missing outputFile');
      if (!scraper.checkpointFile) throw new Error('Missing checkpointFile');
      tests.push({ name: 'Configuration', passed: true });
      console.log('   ✓ Configuration valid');
    } catch (error) {
      tests.push({ name: 'Configuration', passed: false, error: error.message });
      console.log(`   ✗ Configuration invalid: ${error.message}`);
    }

    // Test 4: Required Methods
    try {
      const requiredMethods = [
        'initialize',
        'start',
        'scrapeProductLinks',
        'scrapeProductDetails',
        'shutdown'
      ];

      const missingMethods = requiredMethods.filter(method => typeof scraper[method] !== 'function');
      
      if (missingMethods.length > 0) {
        throw new Error(`Missing methods: ${missingMethods.join(', ')}`);
      }

      tests.push({ name: 'Required Methods', passed: true });
      console.log('   ✓ All required methods present');
    } catch (error) {
      tests.push({ name: 'Required Methods', passed: false, error: error.message });
      console.log(`   ✗ Method check failed: ${error.message}`);
    }

    // Test 5: Browser Initialization
    try {
      await scraper.initialize();
      if (!scraper.browser) throw new Error('Browser not initialized');
      tests.push({ name: 'Browser Init', passed: true });
      console.log('   ✓ Browser initialized');

      // Clean up
      await scraper.shutdown();
      console.log('   ✓ Browser shutdown');
    } catch (error) {
      tests.push({ name: 'Browser Init', passed: false, error: error.message });
      console.log(`   ✗ Browser init failed: ${error.message}`);
      
      // Try to cleanup
      try {
        if (scraper && scraper.browser) {
          await scraper.shutdown();
        }
      } catch (e) {
        // Ignore cleanup errors
      }
    }

    // Test 6: Checkpoint Structure
    try {
      const checkpoint = scraper.createDefaultCheckpoint ? 
        scraper.createDefaultCheckpoint() : {
          productLinks: [],
          relatedLinks: [],
          lastProcessedIndex: -1,
          lastRelatedIndex: -1,
          failedProducts: [],
          lastRunTimestamp: null,
          pagesScraped: [],
          lastPageScraped: 0
        };

      if (!Array.isArray(checkpoint.productLinks)) throw new Error('Invalid checkpoint structure');
      if (typeof checkpoint.lastProcessedIndex !== 'number') throw new Error('Invalid lastProcessedIndex type');
      
      tests.push({ name: 'Checkpoint Structure', passed: true });
      console.log('   ✓ Checkpoint structure valid');
    } catch (error) {
      tests.push({ name: 'Checkpoint Structure', passed: false, error: error.message });
      console.log(`   ✗ Checkpoint structure invalid: ${error.message}`);
    }

    this.results.push({ scraper: name, tests });
    console.log('');
  }

  printResults() {
    console.log('\n' + '='.repeat(70));
    console.log('📊 SMOKE TEST RESULTS');
    console.log('='.repeat(70));

    let totalTests = 0;
    let totalPassed = 0;
    let totalFailed = 0;

    this.results.forEach(result => {
      const passed = result.tests.filter(t => t.passed).length;
      const failed = result.tests.filter(t => !t.passed).length;
      
      totalTests += result.tests.length;
      totalPassed += passed;
      totalFailed += failed;

      const status = failed === 0 ? '✅' : '❌';
      console.log(`${status} ${result.scraper}: ${passed}/${result.tests.length} tests passed`);

      if (failed > 0) {
        result.tests.filter(t => !t.passed).forEach(test => {
          console.log(`   ✗ ${test.name}: ${test.error}`);
        });
      }
    });

    console.log('\n' + '─'.repeat(70));
    console.log(`Total: ${totalTests} | Passed: ${totalPassed} | Failed: ${totalFailed}`);
    console.log('='.repeat(70) + '\n');

    if (totalFailed === 0) {
      console.log('✅ All smoke tests passed! Scrapers are ready for functional testing.');
    } else {
      console.log('❌ Some smoke tests failed. Fix issues before running functional tests.');
    }
  }
}

// Run tests if executed directly
if (require.main === module) {
  const tests = new ScraperSmokeTests();
  
  tests.runAll()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('\n❌ Fatal error running tests:', error);
      console.error(error.stack);
      process.exit(1);
    });
}

module.exports = ScraperSmokeTests;

