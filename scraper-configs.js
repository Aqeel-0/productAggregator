/**
 * Scraper Configuration File
 * Contains all configuration options for different scraping scenarios
 */

// Base configurations that can be extended
const baseConfigs = {
  // Conservative settings for testing
  conservative: {
    headless: true,
    maxPages: 2,
    maxProducts: 20,
    maxConcurrent: 1,
    maxRetries: 2,
    delayBetweenPages: 3000,
  },

  // Moderate settings for regular use
  moderate: {
    headless: true,
    maxPages: 5,
    maxProducts: 100,
    maxConcurrent: 2,
    maxRetries: 3,
    delayBetweenPages: 2500,
  },

  // Aggressive settings for large datasets
  aggressive: {
    headless: true,
    maxPages: 10,
    maxProducts: 500,
    maxConcurrent: 4,
    maxRetries: 3,
    delayBetweenPages: 2000,
  },

  // Maximum settings (use carefully)
  maximum: {
    headless: true,
    maxPages: 20,
    maxProducts: null, // No limit
    maxConcurrent: 6,
    maxRetries: 3,
    delayBetweenPages: 1500,
  }
};

// Specific scraper configurations
const scraperConfigs = {
  // Quick test run
  quickTest: {
    amazon: {
      ...baseConfigs.conservative,
      maxPages: 1,
      maxProducts: 10,
      delayBetweenPages: 2000,
    },
    flipkart: {
      ...baseConfigs.conservative,
      maxPages: 1,
      maxProducts: 10,
      delayBetweenPages: 1500,
    }
  },

  // Daily collection
  daily: {
    amazon: {
      ...baseConfigs.moderate,
      maxPages: 3,
      maxProducts: 50,
      maxConcurrent: 1, // Conservative for Amazon
      delayBetweenPages: 3000,
    },
    flipkart: {
      ...baseConfigs.moderate,
      maxPages: 3,
      maxProducts: 75,
      maxConcurrent: 2,
      delayBetweenPages: 2000,
    }
  },

  // Weekly collection
  weekly: {
    amazon: {
      ...baseConfigs.aggressive,
      maxPages: 8,
      maxProducts: 200,
      maxConcurrent: 2,
      delayBetweenPages: 2500,
    },
    flipkart: {
      ...baseConfigs.aggressive,
      maxPages: 8,
      maxProducts: 300,
      maxConcurrent: 3,
      delayBetweenPages: 2000,
    }
  },

  // Market research (comprehensive)
  marketResearch: {
    amazon: {
      ...baseConfigs.maximum,
      maxPages: 15,
      maxProducts: 1000,
      maxConcurrent: 3,
      delayBetweenPages: 2000,
    },
    flipkart: {
      ...baseConfigs.maximum,
      maxPages: 15,
      maxProducts: 1000,
      maxConcurrent: 4,
      delayBetweenPages: 1800,
    }
  },

  // All products from specific pages
  allProducts: {
    amazon: {
      ...baseConfigs.maximum,
      maxPages: 20,
      maxProducts: null, // Get ALL products
      maxConcurrent: 2,
      delayBetweenPages: 3000,
    },
    flipkart: {
      ...baseConfigs.maximum,
      maxPages: 20,
      maxProducts: null, // Get ALL products
      maxConcurrent: 3,
      delayBetweenPages: 2500,
    }
  },

  // Custom scenario
  custom: {
    amazon: {
      headless: true,
      maxPages: 5,
      maxProducts: 100,
      maxConcurrent: 2,
      maxRetries: 3,
      delayBetweenPages: 2500,
    },
    flipkart: {
      headless: true,
      maxPages: 5,
      maxProducts: 100,
      maxConcurrent: 3,
      maxRetries: 3,
      delayBetweenPages: 2000,
    }
  }
};

// Normalizer configurations
const normalizerConfigs = {
  // Output file configurations
  outputFiles: {
    amazon: {
      raw: './src/scrapers/amazon/amazon_scraped_data.json',
      normalized: './parsed_data/amazon_normalized_data.json'
    },
    flipkart: {
      raw: './src/scrapers/flipkart/flipkart_scraped_data_rate_limited.json',
      normalized: './parsed_data/flipkart_normalized_data.json'
    },
    combined: {
      output: './parsed_data/combined_normalized_data.json'
    }
  },

  // Processing options
  processing: {
    enableDataValidation: true,
    enableDuplicateRemoval: true,
    enablePriceNormalization: true,
    enableCategoryMapping: true,
    minRequiredFields: ['title', 'price'],
    maxProductsPerFile: 10000
  }
};

// Execution configurations
const executionConfigs = {
  // Which scrapers to run
  enabledScrapers: {
    amazon: true,
    flipkart: true
  },

  // Which normalizers to run
  enabledNormalizers: {
    amazon: true,
    flipkart: true,
    combined: true
  },

  // Execution order and timing
  execution: {
    runScrapersSequentially: true, // false = run in parallel
    runNormalizersAfterScrapers: true,
    delayBetweenScrapers: 30000, // 30 seconds
    enableProgressReporting: true,
    enableEmailNotifications: false,
    enableSlackNotifications: false
  },

  // Error handling
  errorHandling: {
    continueOnScraperFailure: true,
    continueOnNormalizerFailure: true,
    maxRetries: 2,
    retryDelay: 60000, // 1 minute
    enableErrorLogging: true,
    errorLogFile: './logs/scraper-errors.log'
  }
};

// Export specific configurations
function getConfig(configName = 'daily') {
  if (!scraperConfigs[configName]) {
    throw new Error(`Configuration '${configName}' not found. Available: ${Object.keys(scraperConfigs).join(', ')}`);
  }
  
  return {
    scrapers: scraperConfigs[configName],
    normalizers: normalizerConfigs,
    execution: executionConfigs
  };
}

// Export available configuration names
function getAvailableConfigs() {
  return Object.keys(scraperConfigs);
}

// Export individual configurations for direct access
module.exports = {
  // Main function to get complete config
  getConfig,
  getAvailableConfigs,
  
  // Direct access to config sections
  scraperConfigs,
  normalizerConfigs,
  executionConfigs,
  baseConfigs,
  
  // Convenience exports for specific scenarios
  quickTest: scraperConfigs.quickTest,
  daily: scraperConfigs.daily,
  weekly: scraperConfigs.weekly,
  marketResearch: scraperConfigs.marketResearch,
  allProducts: scraperConfigs.allProducts,
  custom: scraperConfigs.custom
}; 