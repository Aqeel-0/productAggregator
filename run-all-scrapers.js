/**
 * Main Scraper Automation Runner
 * Runs all scrapers and normalizers in sequence with configurable settings
 */

const AmazonDetailCrawler = require('./src/scrapers/amazon/amazon-detail-crawler');
const FlipkartCrawler = require('./src/scrapers/flipkart/flipkart-crawler');
const fs = require('fs');
const path = require('path');
const { getConfig, getAvailableConfigs } = require('./scraper-configs');

class ScraperRunner {
  constructor(configName = 'daily') {
    this.configName = configName;
    this.config = getConfig(configName);
    this.startTime = Date.now();
    this.results = {
      amazon: { success: false, products: 0, duration: 0, error: null },
      flipkart: { success: false, products: 0, duration: 0, error: null },
      normalizers: { amazon: false, flipkart: false, combined: false },
      totalDuration: 0,
      totalProducts: 0
    };
    
    this.ensureDirectories();
  }

  ensureDirectories() {
    // Ensure parsed_data directory exists
    const parsedDataDir = path.dirname(this.config.normalizers.outputFiles.amazon.normalized);
    if (!fs.existsSync(parsedDataDir)) {
      fs.mkdirSync(parsedDataDir, { recursive: true });
    }

    // Ensure logs directory exists if error logging is enabled
    if (this.config.execution.errorHandling.enableErrorLogging) {
      const logDir = path.dirname(this.config.execution.errorHandling.errorLogFile);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
    }
  }

  logProgress(message) {
    const timestamp = new Date().toISOString();
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    console.log(`[${timestamp}] [+${elapsed}s] ${message}`);
  }

  logError(error, context) {
    const errorMessage = `[ERROR] ${context}: ${error.message}`;
    console.error(errorMessage);
    
    if (this.config.execution.errorHandling.enableErrorLogging) {
      const logEntry = `${new Date().toISOString()} - ${context}: ${error.message}\n${error.stack}\n\n`;
      fs.appendFileSync(this.config.execution.errorHandling.errorLogFile, logEntry);
    }
  }

  async waitDelay(ms) {
    this.logProgress(`⏳ Waiting ${ms/1000} seconds...`);
    await new Promise(resolve => setTimeout(resolve, ms));
  }

  async runAmazonScraper() {
    const startTime = Date.now();
    this.logProgress('🛒 Starting Amazon scraper...');
    
    try {
      const crawler = new AmazonDetailCrawler(this.config.scrapers.amazon);
      await crawler.start();
      
      // Check results
      const outputPath = this.config.normalizers.outputFiles.amazon.raw;
      let products = [];
      if (fs.existsSync(outputPath)) {
        products = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
      }
      
      const duration = (Date.now() - startTime) / 1000;
      this.results.amazon = {
        success: true,
        products: products.length,
        duration: duration,
        error: null
      };
      
      this.logProgress(`✅ Amazon scraper completed: ${products.length} products in ${duration.toFixed(1)}s`);
      return true;
      
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      this.results.amazon = {
        success: false,
        products: 0,
        duration: duration,
        error: error.message
      };
      
      this.logError(error, 'Amazon Scraper');
      
      if (this.config.execution.errorHandling.continueOnScraperFailure) {
        this.logProgress('⚠️  Continuing despite Amazon scraper failure...');
        return false;
      } else {
        throw error;
      }
    }
  }

  async runFlipkartScraper() {
    const startTime = Date.now();
    this.logProgress('📱 Starting Flipkart scraper...');
    
    try {
      const crawler = new FlipkartCrawler(this.config.scrapers.flipkart);
      await crawler.start();
      
      // Check results
      const outputPath = this.config.normalizers.outputFiles.flipkart.raw;
      let products = [];
      if (fs.existsSync(outputPath)) {
        products = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
      }
      
      const duration = (Date.now() - startTime) / 1000;
      this.results.flipkart = {
        success: true,
        products: products.length,
        duration: duration,
        error: null
      };
      
      this.logProgress(`✅ Flipkart scraper completed: ${products.length} products in ${duration.toFixed(1)}s`);
      return true;
      
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      this.results.flipkart = {
        success: false,
        products: 0,
        duration: duration,
        error: error.message
      };
      
      this.logError(error, 'Flipkart Scraper');
      
      if (this.config.execution.errorHandling.continueOnScraperFailure) {
        this.logProgress('⚠️  Continuing despite Flipkart scraper failure...');
        return false;
      } else {
        throw error;
      }
    }
  }

  async runAmazonNormalizer() {
    this.logProgress('🔄 Running Amazon normalizer...');
    
    try {
      // Clear existing normalized file
      const outputPath = this.config.normalizers.outputFiles.amazon.normalized;
      if (fs.existsSync(outputPath)) {
        fs.unlinkSync(outputPath);
      }
      
      // Run normalizer by requiring it (it has self-execution logic)
      delete require.cache[require.resolve('./src/services/amazon_normalizer.js')];
      require('./src/services/amazon_normalizer.js');
      
      // Verify output
      if (fs.existsSync(outputPath)) {
        const normalized = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
        this.results.normalizers.amazon = true;
        this.logProgress(`✅ Amazon normalizer completed: ${normalized.length} products normalized`);
        return true;
      } else {
        throw new Error('Normalized output file not created');
      }
      
    } catch (error) {
      this.results.normalizers.amazon = false;
      this.logError(error, 'Amazon Normalizer');
      
      if (this.config.execution.errorHandling.continueOnNormalizerFailure) {
        this.logProgress('⚠️  Continuing despite Amazon normalizer failure...');
        return false;
      } else {
        throw error;
      }
    }
  }

  async runFlipkartNormalizer() {
    this.logProgress('🔄 Running Flipkart normalizer...');
    
    try {
      // Clear existing normalized file
      const outputPath = this.config.normalizers.outputFiles.flipkart.normalized;
      if (fs.existsSync(outputPath)) {
        fs.unlinkSync(outputPath);
      }
      
      // Run normalizer by requiring it (it has self-execution logic)
      delete require.cache[require.resolve('./src/services/flipkart_normalizer.js')];
      require('./src/services/flipkart_normalizer.js');
      
      // Verify output
      if (fs.existsSync(outputPath)) {
        const normalized = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
        this.results.normalizers.flipkart = true;
        this.logProgress(`✅ Flipkart normalizer completed: ${normalized.length} products normalized`);
        return true;
      } else {
        throw new Error('Normalized output file not created');
      }
      
    } catch (error) {
      this.results.normalizers.flipkart = false;
      this.logError(error, 'Flipkart Normalizer');
      
      if (this.config.execution.errorHandling.continueOnNormalizerFailure) {
        this.logProgress('⚠️  Continuing despite Flipkart normalizer failure...');
        return false;
      } else {
        throw error;
      }
    }
  }

  async runCombinedNormalizer() {
    this.logProgress('🔄 Creating combined normalized dataset...');
    
    try {
      const amazonPath = this.config.normalizers.outputFiles.amazon.normalized;
      const flipkartPath = this.config.normalizers.outputFiles.flipkart.normalized;
      const combinedPath = this.config.normalizers.outputFiles.combined.output;
      
      let combinedData = [];
      let amazonCount = 0;
      let flipkartCount = 0;
      
      // Load Amazon data if available
      if (fs.existsSync(amazonPath)) {
        const amazonData = JSON.parse(fs.readFileSync(amazonPath, 'utf8'));
        amazonData.forEach(product => {
          product.source = 'amazon';
          combinedData.push(product);
        });
        amazonCount = amazonData.length;
      }
      
      // Load Flipkart data if available
      if (fs.existsSync(flipkartPath)) {
        const flipkartData = JSON.parse(fs.readFileSync(flipkartPath, 'utf8'));
        flipkartData.forEach(product => {
          product.source = 'flipkart';
          combinedData.push(product);
        });
        flipkartCount = flipkartData.length;
      }
      
      // Save combined data
      fs.writeFileSync(combinedPath, JSON.stringify(combinedData, null, 2));
      
      this.results.normalizers.combined = true;
      this.logProgress(`✅ Combined normalizer completed: ${combinedData.length} total products (Amazon: ${amazonCount}, Flipkart: ${flipkartCount})`);
      return true;
      
    } catch (error) {
      this.results.normalizers.combined = false;
      this.logError(error, 'Combined Normalizer');
      return false;
    }
  }

  async runAllScrapers() {
    this.logProgress(`🚀 Starting automation with '${this.configName}' configuration`);
    this.logProgress(`📋 Config: Amazon(${this.config.scrapers.amazon.maxPages}p, ${this.config.scrapers.amazon.maxProducts || 'ALL'}), Flipkart(${this.config.scrapers.flipkart.maxPages}p, ${this.config.scrapers.flipkart.maxProducts || 'ALL'})`);

    try {
      // Run scrapers
      if (this.config.execution.enabledScrapers.amazon) {
        await this.runAmazonScraper();
        
        if (this.config.execution.enabledScrapers.flipkart && this.config.execution.execution.runScrapersSequentially) {
          await this.waitDelay(this.config.execution.execution.delayBetweenScrapers);
        }
      }
      
      if (this.config.execution.enabledScrapers.flipkart) {
        await this.runFlipkartScraper();
      }
      
      // Run normalizers if enabled
      if (this.config.execution.execution.runNormalizersAfterScrapers) {
        this.logProgress('📊 Starting normalization phase...');
        
        if (this.config.execution.enabledNormalizers.amazon && this.results.amazon.success) {
          await this.runAmazonNormalizer();
        }
        
        if (this.config.execution.enabledNormalizers.flipkart && this.results.flipkart.success) {
          await this.runFlipkartNormalizer();
        }
        
        if (this.config.execution.enabledNormalizers.combined) {
          await this.runCombinedNormalizer();
        }
      }
      
      // Calculate totals
      this.results.totalProducts = this.results.amazon.products + this.results.flipkart.products;
      this.results.totalDuration = (Date.now() - this.startTime) / 1000;
      
      this.generateFinalReport();
      
    } catch (error) {
      this.logError(error, 'Automation Runner');
      throw error;
    }
  }

  generateFinalReport() {
    this.logProgress('📈 AUTOMATION COMPLETED - FINAL REPORT');
    console.log('='.repeat(80));
    
    console.log('\n📊 SCRAPING RESULTS:');
    console.log(`🛒 Amazon: ${this.results.amazon.success ? '✅' : '❌'} ${this.results.amazon.products} products (${this.results.amazon.duration.toFixed(1)}s)`);
    console.log(`📱 Flipkart: ${this.results.flipkart.success ? '✅' : '❌'} ${this.results.flipkart.products} products (${this.results.flipkart.duration.toFixed(1)}s)`);
    
    console.log('\n🔄 NORMALIZATION RESULTS:');
    console.log(`🛒 Amazon: ${this.results.normalizers.amazon ? '✅' : '❌'} Normalized`);
    console.log(`📱 Flipkart: ${this.results.normalizers.flipkart ? '✅' : '❌'} Normalized`);
    console.log(`🔗 Combined: ${this.results.normalizers.combined ? '✅' : '❌'} Combined`);
    
    console.log('\n⚡ PERFORMANCE SUMMARY:');
    console.log(`📊 Total Products: ${this.results.totalProducts}`);
    console.log(`⏱️  Total Duration: ${this.results.totalDuration.toFixed(1)} seconds`);
    console.log(`📈 Products/Second: ${(this.results.totalProducts / this.results.totalDuration).toFixed(2)}`);
    
    console.log('\n📁 OUTPUT FILES:');
    console.log(`🛒 Amazon Raw: ${this.config.normalizers.outputFiles.amazon.raw}`);
    console.log(`🛒 Amazon Normalized: ${this.config.normalizers.outputFiles.amazon.normalized}`);
    console.log(`📱 Flipkart Raw: ${this.config.normalizers.outputFiles.flipkart.raw}`);
    console.log(`📱 Flipkart Normalized: ${this.config.normalizers.outputFiles.flipkart.normalized}`);
    console.log(`🔗 Combined: ${this.config.normalizers.outputFiles.combined.output}`);
    
    if (this.results.amazon.error || this.results.flipkart.error) {
      console.log('\n❌ ERRORS:');
      if (this.results.amazon.error) console.log(`🛒 Amazon: ${this.results.amazon.error}`);
      if (this.results.flipkart.error) console.log(`📱 Flipkart: ${this.results.flipkart.error}`);
    }
    
    console.log('\n🎉 Automation completed successfully!');
  }
}

// Command line interface
async function main() {
  const args = process.argv.slice(2);
  const configName = args[0] || 'daily';
  
  console.log('🚀 Product Aggregator - Automated Scraper Runner');
  console.log('='.repeat(80));
  
  // Show available configurations
  if (args.includes('--help') || args.includes('-h')) {
    console.log('\nUsage: node run-all-scrapers.js [configName]');
    console.log('\nAvailable configurations:');
    getAvailableConfigs().forEach(config => {
      console.log(`  - ${config}`);
    });
    console.log('\nExample: node run-all-scrapers.js quickTest');
    process.exit(0);
  }
  
  if (args.includes('--list')) {
    console.log('\nAvailable configurations:');
    getAvailableConfigs().forEach(config => {
      console.log(`  - ${config}`);
    });
    process.exit(0);
  }
  
  try {
    const runner = new ScraperRunner(configName);
    await runner.runAllScrapers();
    process.exit(0);
  } catch (error) {
    console.error('\n💥 Automation failed:', error.message);
    process.exit(1);
  }
}

// Run if this file is executed directly
if (require.main === module) {
  main();
}

module.exports = ScraperRunner; 