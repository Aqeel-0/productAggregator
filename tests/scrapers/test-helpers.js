/**
 * Test Helpers for Scraper Functional Tests
 * Provides utilities for validating scraper behavior, checkpoints, and data
 */

const fs = require('fs');
const path = require('path');

class TestHelpers {
  /**
   * Clean up test artifacts
   */
  static cleanupTestFiles(testDir) {
    const patterns = ['test_*_checkpoint.json', 'test_*_scraped_data.json'];
    
    patterns.forEach(pattern => {
      const regex = new RegExp(pattern.replace('*', '.*'));
      const files = fs.readdirSync(testDir);
      
      files.forEach(file => {
        if (regex.test(file)) {
          const filePath = path.join(testDir, file);
          try {
            fs.unlinkSync(filePath);
            console.log(`   ✓ Cleaned up: ${file}`);
          } catch (error) {
            console.warn(`   ⚠ Could not delete ${file}: ${error.message}`);
          }
        }
      });
    });
  }

  /**
   * Validate checkpoint file structure
   */
  static validateCheckpoint(checkpointPath, scraperType) {
    if (!fs.existsSync(checkpointPath)) {
      throw new Error(`Checkpoint file not found: ${checkpointPath}`);
    }

    const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
    
    // Required fields
    const requiredFields = [
      'productLinks',
      'lastProcessedIndex',
      'failedProducts',
      'pagesScraped',
      'lastPageScraped'
    ];

    requiredFields.forEach(field => {
      if (!(field in checkpoint)) {
        throw new Error(`Missing required field in checkpoint: ${field}`);
      }
    });

    // Validate types
    if (!Array.isArray(checkpoint.productLinks)) {
      throw new Error('productLinks must be an array');
    }
    if (typeof checkpoint.lastProcessedIndex !== 'number') {
      throw new Error('lastProcessedIndex must be a number');
    }
    if (!Array.isArray(checkpoint.failedProducts)) {
      throw new Error('failedProducts must be an array');
    }
    if (!Array.isArray(checkpoint.pagesScraped)) {
      throw new Error('pagesScraped must be an array');
    }

    return checkpoint;
  }

  /**
   * Validate scraped data file
   */
  static validateScrapedData(dataPath, minProducts = 1) {
    if (!fs.existsSync(dataPath)) {
      throw new Error(`Data file not found: ${dataPath}`);
    }

    const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    
    if (!Array.isArray(data)) {
      throw new Error('Scraped data must be an array');
    }

    if (data.length < minProducts) {
      throw new Error(`Expected at least ${minProducts} products, got ${data.length}`);
    }

    // Validate product structure
    const requiredProductFields = ['url', 'title'];
    data.forEach((product, index) => {
      requiredProductFields.forEach(field => {
        if (!(field in product)) {
          throw new Error(`Product ${index} missing required field: ${field}`);
        }
      });
    });

    return data;
  }

  /**
   * Check for duplicate URLs in data
   */
  static checkDuplicates(data) {
    const urls = data.map(item => item.url);
    const uniqueUrls = new Set(urls);
    
    if (urls.length !== uniqueUrls.size) {
      const duplicates = urls.filter((url, index) => urls.indexOf(url) !== index);
      return {
        hasDuplicates: true,
        count: urls.length - uniqueUrls.size,
        duplicateUrls: [...new Set(duplicates)]
      };
    }
    
    return { hasDuplicates: false, count: 0 };
  }

  /**
   * Create a partial checkpoint for testing resume functionality
   */
  static createPartialCheckpoint(fullCheckpoint, processedCount) {
    return {
      ...fullCheckpoint,
      lastProcessedIndex: processedCount - 1,
      pagesScraped: fullCheckpoint.pagesScraped,
      lastPageScraped: fullCheckpoint.lastPageScraped
    };
  }

  /**
   * Compare two checkpoints to verify resume worked
   */
  static compareCheckpoints(beforeCheckpoint, afterCheckpoint) {
    const issues = [];

    // Should have same or more product links
    if (afterCheckpoint.productLinks.length < beforeCheckpoint.productLinks.length) {
      issues.push('Product links decreased after resume');
    }

    // Last processed index should have increased
    if (afterCheckpoint.lastProcessedIndex <= beforeCheckpoint.lastProcessedIndex) {
      issues.push('Last processed index did not increase');
    }

    // Check for data consistency
    const beforeLinks = beforeCheckpoint.productLinks.slice(0, beforeCheckpoint.lastProcessedIndex + 1);
    const afterLinks = afterCheckpoint.productLinks.slice(0, beforeLinks.length);
    
    if (JSON.stringify(beforeLinks) !== JSON.stringify(afterLinks)) {
      issues.push('Previously processed links changed after resume');
    }

    return {
      valid: issues.length === 0,
      issues
    };
  }

  /**
   * Count products in data file
   */
  static countProducts(dataPath) {
    if (!fs.existsSync(dataPath)) {
      return 0;
    }
    const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    return Array.isArray(data) ? data.length : 0;
  }

  /**
   * Validate that failed products are tracked correctly
   */
  static validateFailedProducts(checkpoint) {
    if (!Array.isArray(checkpoint.failedProducts)) {
      throw new Error('failedProducts must be an array');
    }

    checkpoint.failedProducts.forEach((failure, index) => {
      if (!failure.url) {
        throw new Error(`Failed product ${index} missing URL`);
      }
      if (!failure.error) {
        throw new Error(`Failed product ${index} missing error message`);
      }
      if (typeof failure.index !== 'number') {
        throw new Error(`Failed product ${index} missing or invalid index`);
      }
    });

    return true;
  }

  /**
   * Calculate scraper statistics
   */
  static calculateStats(checkpoint, dataPath) {
    const data = fs.existsSync(dataPath) ? 
      JSON.parse(fs.readFileSync(dataPath, 'utf8')) : [];
    
    return {
      totalLinks: checkpoint.productLinks.length,
      pagesScraped: checkpoint.pagesScraped.length,
      lastPage: checkpoint.lastPageScraped,
      productsProcessed: checkpoint.lastProcessedIndex + 1,
      productsSaved: data.length,
      failedCount: checkpoint.failedProducts.length,
      successRate: checkpoint.lastProcessedIndex >= 0 ? 
        ((data.length / (checkpoint.lastProcessedIndex + 1)) * 100).toFixed(2) + '%' : '0%'
    };
  }

  /**
   * Wait for file to be created or updated
   */
  static async waitForFile(filePath, timeoutMs = 10000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      if (fs.existsSync(filePath)) {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    throw new Error(`File not created within ${timeoutMs}ms: ${filePath}`);
  }

  /**
   * Validate progress tracking accuracy
   */
  static validateProgress(checkpoint, dataPath) {
    const processed = checkpoint.lastProcessedIndex + 1;
    const productCount = this.countProducts(dataPath);
    const failed = checkpoint.failedProducts.length;
    
    // Products saved + failed should equal processed (approximately)
    const accounted = productCount + failed;
    
    return {
      processed,
      saved: productCount,
      failed,
      accounted,
      accurate: Math.abs(accounted - processed) <= 1 // Allow 1 item difference
    };
  }

  /**
   * Generate test configuration for a scraper
   */
  static generateTestConfig(scraperName, maxProducts = 5) {
    const configs = {
      amazon: {
        category: 'test_mouse',
        categoryUrl: 'https://www.amazon.in/s?k=wireless+mouse',
        maxProducts,
        maxPages: 1,
        checkpointFile: path.join(__dirname, `../../src/scrapers/amazon/checkpoints/test_mouse_checkpoint.json`),
        outputFile: path.join(__dirname, `../../src/scrapers/amazon/raw_data/test_mouse_scraped_data.json`)
      },
      flipkart: {
        category: 'test_mobile',
        categoryUrl: 'https://www.flipkart.com/search?q=mobile',
        maxProducts,
        maxPages: 1,
        checkpointFile: path.join(__dirname, `../../src/scrapers/flipkart/checkpoints/test_mobile_checkpoint.json`),
        outputFile: path.join(__dirname, `../../src/scrapers/flipkart/raw_data/test_mobile_scraped_data.json`)
      },
      croma: {
        category: 'test_mobile',
        categoryUrl: 'https://www.croma.com/mobile-phones-wearables/mobile-phones/c/24',
        maxProducts,
        checkpointFile: path.join(__dirname, `../../src/scrapers/croma/checkpoints/test_mobile_checkpoint.json`),
        outputFile: path.join(__dirname, `../../src/scrapers/croma/raw_data/test_mobile_scraped_data.json`)
      },
      reliance: {
        category: 'test_mobile',
        categoryUrl: 'https://www.reliancedigital.in/mobiles-tablets/mobile-phones/c/MB0101',
        maxProducts,
        maxPages: 1,
        checkpointFile: path.join(__dirname, `../../src/scrapers/reliance/checkpoints/test_mobile_checkpoint.json`),
        outputFile: path.join(__dirname, `../../src/scrapers/reliance/raw_data/test_mobile_scraped_data.json`)
      }
    };

    return configs[scraperName];
  }

  /**
   * Format test results for display
   */
  static formatResults(results) {
    console.log('\n' + '='.repeat(70));
    console.log('📊 TEST RESULTS SUMMARY');
    console.log('='.repeat(70));
    
    const total = results.length;
    const passed = results.filter(r => r.status === 'PASS').length;
    const failed = results.filter(r => r.status === 'FAIL').length;
    const skipped = results.filter(r => r.status === 'SKIP').length;
    
    results.forEach(result => {
      const icon = result.status === 'PASS' ? '✓' : result.status === 'FAIL' ? '✗' : '○';
      const color = result.status === 'PASS' ? '\x1b[32m' : result.status === 'FAIL' ? '\x1b[31m' : '\x1b[33m';
      console.log(`${color}${icon}\x1b[0m ${result.name}`);
      
      if (result.error) {
        console.log(`   Error: ${result.error}`);
      }
      
      if (result.details) {
        Object.entries(result.details).forEach(([key, value]) => {
          console.log(`   ${key}: ${value}`);
        });
      }
    });
    
    console.log('\n' + '─'.repeat(70));
    console.log(`Total: ${total} | Passed: ${passed} | Failed: ${failed} | Skipped: ${skipped}`);
    console.log('='.repeat(70) + '\n');
    
    return { total, passed, failed, skipped };
  }
}

module.exports = TestHelpers;

