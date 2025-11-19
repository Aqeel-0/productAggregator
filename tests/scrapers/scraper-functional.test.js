/**
 * Comprehensive Functional Tests for All Scrapers
 * Tests: Link collection, checkpoint recovery, data extraction, deduplication, error handling
 * 
 * Usage: npm run test:scrapers
 * Or: node tests/scrapers/scraper-functional.test.js
 */

const fs = require('fs');
const path = require('path');
const TestHelpers = require('./test-helpers');

// Import scrapers
const AmazonCrawler = require('../../src/scrapers/amazon/crawler/amazonElectronicsCrawler');
const FlipkartCrawler = require('../../src/scrapers/flipkart/crawler/flipkartMobileCrawler');
const CromaCrawler = require('../../src/scrapers/croma/crawler/cromaCrawler');
const RelianceCrawler = require('../../src/scrapers/reliance/crawler/relianceCrawler');

// Test configuration
const TEST_CONFIG = {
  maxProducts: 5, // Small number for fast tests
  timeout: 120000, // 2 minutes per test
  scrapers: process.env.TEST_SCRAPER ? [process.env.TEST_SCRAPER] : ['amazon', 'flipkart', 'croma', 'reliance']
};

class ScraperFunctionalTests {
  constructor() {
    this.results = [];
    this.currentScraper = null;
  }

  /**
   * Run all tests
   */
  async runAll() {
    console.log('\n🚀 Starting Comprehensive Scraper Functional Tests\n');
    console.log(`Testing scrapers: ${TEST_CONFIG.scrapers.join(', ')}`);
    console.log(`Max products per test: ${TEST_CONFIG.maxProducts}`);
    console.log(`Timeout per test: ${TEST_CONFIG.timeout}ms\n`);

    for (const scraperName of TEST_CONFIG.scrapers) {
      await this.testScraper(scraperName);
    }

    TestHelpers.formatResults(this.results);
    
    return this.results;
  }

  /**
   * Test a specific scraper
   */
  async testScraper(scraperName) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`📦 Testing ${scraperName.toUpperCase()} Scraper`);
    console.log('='.repeat(70));

    const config = TestHelpers.generateTestConfig(scraperName, TEST_CONFIG.maxProducts);
    
    if (!config) {
      this.addResult(scraperName, 'Configuration', 'SKIP', 'Scraper not configured');
      return;
    }

    // Clean up before tests
    this.cleanup(config);

    // Run tests in sequence
    await this.testLinkCollection(scraperName, config);
    await this.testDataExtraction(scraperName, config);
    await this.testCheckpointRecovery(scraperName, config);
    await this.testDeduplication(scraperName, config);
    await this.testProgressTracking(scraperName, config);
    
    // Clean up after tests
    this.cleanup(config);
  }

  /**
   * Test 1: Link Collection
   * Verify that the scraper can collect product links from category pages
   */
  async testLinkCollection(scraperName, config) {
    const testName = `${scraperName} - Link Collection`;
    console.log(`\n📝 Test: ${testName}`);

    try {
      // Clean start
      this.cleanup(config);

      const scraper = this.createScraper(scraperName, {
        ...config,
        maxProducts: TEST_CONFIG.maxProducts,
        maxPages: 1,
        headless: true
      });

      // Only scrape links, not product details
      await scraper.initialize();
      await scraper.scrapeProductLinks();
      
      // Ensure proper cleanup
      try {
        await scraper.shutdown();
      } catch (error) {
        console.warn(`   Warning: Shutdown error: ${error.message}`);
      }

      // Validate checkpoint was created
      const checkpoint = TestHelpers.validateCheckpoint(config.checkpointFile, scraperName);

      // Verify links were collected
      if (checkpoint.productLinks.length === 0) {
        throw new Error('No product links collected');
      }

      // Verify checkpoint structure
      if (!Array.isArray(checkpoint.pagesScraped) || checkpoint.pagesScraped.length === 0) {
        throw new Error('No pages recorded in checkpoint');
      }

      this.addResult(scraperName, testName, 'PASS', null, {
        'Links collected': checkpoint.productLinks.length,
        'Pages scraped': checkpoint.pagesScraped.length
      });

    } catch (error) {
      this.addResult(scraperName, testName, 'FAIL', error.message);
      console.error(`   ❌ Error: ${error.message}`);
    }
  }

  /**
   * Test 2: Data Extraction
   * Verify that the scraper can extract product details
   */
  async testDataExtraction(scraperName, config) {
    const testName = `${scraperName} - Data Extraction`;
    console.log(`\n📝 Test: ${testName}`);

    try {
      // Clean start
      this.cleanup(config);

      const scraper = this.createScraper(scraperName, {
        ...config,
        maxProducts: 3, // Extract details for fewer products
        maxPages: 1,
        headless: true
      });

      // Run full scraping
      await scraper.start();
      
      // Ensure cleanup
      try {
        await scraper.shutdown();
      } catch (error) {
        console.warn(`   Warning: Shutdown error: ${error.message}`);
      }

      // Validate output data
      const data = TestHelpers.validateScrapedData(config.outputFile, 1);
      const checkpoint = TestHelpers.validateCheckpoint(config.checkpointFile, scraperName);

      // Verify product structure
      const sampleProduct = data[0];
      const requiredFields = ['url', 'title'];
      const missingFields = requiredFields.filter(field => !sampleProduct[field]);

      if (missingFields.length > 0) {
        throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
      }

      // Check progress tracking
      const progress = TestHelpers.validateProgress(checkpoint, config.outputFile);

      this.addResult(scraperName, testName, 'PASS', null, {
        'Products extracted': data.length,
        'Failed products': checkpoint.failedProducts.length,
        'Progress accurate': progress.accurate ? 'Yes' : 'No'
      });

    } catch (error) {
      this.addResult(scraperName, testName, 'FAIL', error.message);
      console.error(`   ❌ Error: ${error.message}`);
    }
  }

  /**
   * Test 3: Checkpoint Recovery
   * Verify that the scraper can resume from a checkpoint
   */
  async testCheckpointRecovery(scraperName, config) {
    const testName = `${scraperName} - Checkpoint Recovery`;
    console.log(`\n📝 Test: ${testName}`);

    try {
      // Clean start
      this.cleanup(config);

      // Step 1: Run partial scrape
      const scraper1 = this.createScraper(scraperName, {
        ...config,
        maxProducts: 2, // Process only 2 products
        maxPages: 1,
        headless: true
      });

      await scraper1.start();
      
      // Cleanup first scraper
      try {
        await scraper1.shutdown();
      } catch (error) {
        console.warn(`   Warning: First scraper shutdown error: ${error.message}`);
      }
      
      const checkpoint1 = TestHelpers.validateCheckpoint(config.checkpointFile, scraperName);
      const dataCount1 = TestHelpers.countProducts(config.outputFile);

      console.log(`   First run: ${dataCount1} products saved, checkpoint at index ${checkpoint1.lastProcessedIndex}`);

      // Step 2: Resume and process more
      const scraper2 = this.createScraper(scraperName, {
        ...config,
        maxProducts: 5, // Process up to 5 total
        maxPages: 1,
        headless: true
      });

      await scraper2.start();
      
      // Cleanup second scraper
      try {
        await scraper2.shutdown();
      } catch (error) {
        console.warn(`   Warning: Second scraper shutdown error: ${error.message}`);
      }

      const checkpoint2 = TestHelpers.validateCheckpoint(config.checkpointFile, scraperName);
      const dataCount2 = TestHelpers.countProducts(config.outputFile);

      console.log(`   Second run: ${dataCount2} products saved, checkpoint at index ${checkpoint2.lastProcessedIndex}`);

      // Verify resume worked
      if (checkpoint2.lastProcessedIndex <= checkpoint1.lastProcessedIndex) {
        throw new Error('Scraper did not resume - processed index did not increase');
      }

      if (dataCount2 <= dataCount1) {
        throw new Error('Scraper did not resume - data count did not increase');
      }

      // Compare checkpoints for consistency
      const comparison = TestHelpers.compareCheckpoints(checkpoint1, checkpoint2);
      if (!comparison.valid) {
        throw new Error(`Checkpoint inconsistencies: ${comparison.issues.join(', ')}`);
      }

      this.addResult(scraperName, testName, 'PASS', null, {
        'First run products': dataCount1,
        'Second run products': dataCount2,
        'Additional products': dataCount2 - dataCount1,
        'Resume successful': 'Yes'
      });

    } catch (error) {
      this.addResult(scraperName, testName, 'FAIL', error.message);
      console.error(`   ❌ Error: ${error.message}`);
    }
  }

  /**
   * Test 4: Deduplication
   * Verify that the scraper doesn't create duplicate products
   */
  async testDeduplication(scraperName, config) {
    const testName = `${scraperName} - Deduplication`;
    console.log(`\n📝 Test: ${testName}`);

    try {
      // Use existing data from previous tests or run new scrape
      if (!fs.existsSync(config.outputFile)) {
        const scraper = this.createScraper(scraperName, {
          ...config,
          maxProducts: TEST_CONFIG.maxProducts,
          maxPages: 1,
          headless: true
        });
        await scraper.start();
        
        // Cleanup
        try {
          await scraper.shutdown();
        } catch (error) {
          console.warn(`   Warning: Shutdown error: ${error.message}`);
        }
      }

      const data = TestHelpers.validateScrapedData(config.outputFile, 1);
      const checkpoint = TestHelpers.validateCheckpoint(config.checkpointFile, scraperName);

      // Check for duplicate URLs in product links
      const linkSet = new Set(checkpoint.productLinks);
      const linkDuplicates = checkpoint.productLinks.length - linkSet.size;

      // Check for duplicate URLs in scraped data
      const duplicateCheck = TestHelpers.checkDuplicates(data);

      if (linkDuplicates > 0) {
        throw new Error(`Found ${linkDuplicates} duplicate links in checkpoint`);
      }

      if (duplicateCheck.hasDuplicates) {
        throw new Error(`Found ${duplicateCheck.count} duplicate products: ${duplicateCheck.duplicateUrls.slice(0, 3).join(', ')}`);
      }

      this.addResult(scraperName, testName, 'PASS', null, {
        'Total links': checkpoint.productLinks.length,
        'Unique links': linkSet.size,
        'Total products': data.length,
        'Duplicates found': 0
      });

    } catch (error) {
      this.addResult(scraperName, testName, 'FAIL', error.message);
      console.error(`   ❌ Error: ${error.message}`);
    }
  }

  /**
   * Test 5: Progress Tracking
   * Verify that progress tracking is accurate
   */
  async testProgressTracking(scraperName, config) {
    const testName = `${scraperName} - Progress Tracking`;
    console.log(`\n📝 Test: ${testName}`);

    try {
      // Use existing data or run new scrape
      if (!fs.existsSync(config.outputFile)) {
        const scraper = this.createScraper(scraperName, {
          ...config,
          maxProducts: TEST_CONFIG.maxProducts,
          maxPages: 1,
          headless: true
        });
        await scraper.start();
        
        // Cleanup
        try {
          await scraper.shutdown();
        } catch (error) {
          console.warn(`   Warning: Shutdown error: ${error.message}`);
        }
      }

      const checkpoint = TestHelpers.validateCheckpoint(config.checkpointFile, scraperName);
      const progress = TestHelpers.validateProgress(checkpoint, config.outputFile);
      const stats = TestHelpers.calculateStats(checkpoint, config.outputFile);

      // Verify accuracy
      if (!progress.accurate) {
        throw new Error(`Progress tracking inaccurate: processed=${progress.processed}, saved=${progress.saved}, failed=${progress.failed}, accounted=${progress.accounted}`);
      }

      // Verify checkpoint fields are consistent
      if (checkpoint.lastPageScraped !== Math.max(...checkpoint.pagesScraped)) {
        throw new Error('lastPageScraped does not match pagesScraped array');
      }

      this.addResult(scraperName, testName, 'PASS', null, {
        'Total links': stats.totalLinks,
        'Products processed': stats.productsProcessed,
        'Products saved': stats.productsSaved,
        'Failed': stats.failedCount,
        'Success rate': stats.successRate
      });

    } catch (error) {
      this.addResult(scraperName, testName, 'FAIL', error.message);
      console.error(`   ❌ Error: ${error.message}`);
    }
  }

  /**
   * Create scraper instance based on type
   */
  createScraper(scraperName, config) {
    const scrapers = {
      amazon: AmazonCrawler,
      flipkart: FlipkartCrawler,
      croma: CromaCrawler,
      reliance: RelianceCrawler
    };

    const ScraperClass = scrapers[scraperName];
    if (!ScraperClass) {
      throw new Error(`Unknown scraper: ${scraperName}`);
    }

    return new ScraperClass(config);
  }

  /**
   * Clean up test files
   */
  cleanup(config) {
    [config.checkpointFile, config.outputFile].forEach(file => {
      if (fs.existsSync(file)) {
        try {
          fs.unlinkSync(file);
        } catch (error) {
          console.warn(`Could not delete ${file}: ${error.message}`);
        }
      }
    });
  }

  /**
   * Add test result
   */
  addResult(scraper, name, status, error = null, details = null) {
    this.results.push({
      scraper,
      name,
      status,
      error,
      details,
      timestamp: new Date().toISOString()
    });
  }
}

// Run tests if executed directly
if (require.main === module) {
  const tests = new ScraperFunctionalTests();
  
  tests.runAll()
    .then(results => {
      const failed = results.filter(r => r.status === 'FAIL').length;
      process.exit(failed > 0 ? 1 : 0);
    })
    .catch(error => {
      console.error('\n❌ Fatal error running tests:', error);
      process.exit(1);
    });
}

module.exports = ScraperFunctionalTests;

