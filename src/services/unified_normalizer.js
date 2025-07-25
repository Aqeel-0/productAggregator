const fs = require('fs');
const path = require('path');
const { createLogger } = require('../utils/logger');
const { normalizeAmazonProduct } = require('./amazon_normalizer');
const { normalizeFlipkartProduct } = require('./flipkart_normalizer');

const logger = createLogger('UnifiedNormalizer');

/**
 * Normalize product data from multiple sources into a unified format
 * @param {Object} options Configuration options
 * @param {boolean} options.amazon Include Amazon data
 * @param {boolean} options.flipkart Include Flipkart data
 * @returns {Promise<Array>} Array of normalized products
 */
async function normalizeData(options = { amazon: true, flipkart: true }) {
  try {
    const normalizedProducts = [];
    
    // Process Amazon data if requested
    if (options.amazon) {
      try {
        const amazonPath = path.join(__dirname, '../scrapers/amazon/amazon_scraped_data.json');
        if (fs.existsSync(amazonPath)) {
          logger.info(`Reading Amazon data from ${amazonPath}`);
          const amazonData = JSON.parse(fs.readFileSync(amazonPath, 'utf8'));
          logger.info(`Found ${amazonData.length} Amazon products to normalize`);
          
          const normalizedAmazon = amazonData
            .map(product => normalizeAmazonProduct(product))
            .filter(product => product !== null);
          
          logger.info(`Successfully normalized ${normalizedAmazon.length} Amazon products`);
          normalizedProducts.push(...normalizedAmazon);
        } else {
          logger.warn(`Amazon data file not found at ${amazonPath}`);
        }
      } catch (error) {
        logger.error(`Error processing Amazon data: ${error.message}`);
      }
    }
    
    // Process Flipkart data if requested
    if (options.flipkart) {
      try {
        const flipkartPath = path.join(__dirname, '../scrapers/flipkart/flipkart_scraped_data.json');
        if (fs.existsSync(flipkartPath)) {
          logger.info(`Reading Flipkart data from ${flipkartPath}`);
          const flipkartData = JSON.parse(fs.readFileSync(flipkartPath, 'utf8'));
          logger.info(`Found ${flipkartData.length} Flipkart products to normalize`);
          
          const normalizedFlipkart = flipkartData
            .map(product => normalizeFlipkartProduct(product))
            .filter(product => product !== null);
          
          logger.info(`Successfully normalized ${normalizedFlipkart.length} Flipkart products`);
          normalizedProducts.push(...normalizedFlipkart);
        } else {
          logger.warn(`Flipkart data file not found at ${flipkartPath}`);
        }
      } catch (error) {
        logger.error(`Error processing Flipkart data: ${error.message}`);
      }
    }
    
    // Group products by brand and model
    const groupedProducts = groupSimilarProducts(normalizedProducts);
    
    // Save the unified normalized data
    const outputPath = path.join(__dirname, '../scrapers/unified_normalized_data.json');
    fs.writeFileSync(outputPath, JSON.stringify(groupedProducts, null, 2));
    logger.info(`Unified normalized data saved to ${outputPath}`);
    
    return groupedProducts;
  } catch (error) {
    logger.error(`Error in unified normalization: ${error.message}`);
    throw error;
  }
}

/**
 * Group similar products by brand and model
 * @param {Array} products Array of normalized products
 * @returns {Array} Array of grouped products
 */
function groupSimilarProducts(products) {
  // Create a map to group products by brand and model
  const productGroups = new Map();
  
  for (const product of products) {
    // Skip products without brand or model
    if (!product.brand || !product.model) {
      continue;
    }
    
    // Create a key for grouping (brand_model)
    const key = `${product.brand.toLowerCase()}_${product.model.toLowerCase()}`;
    
    if (!productGroups.has(key)) {
      productGroups.set(key, {
        brand: product.brand,
        model: product.model,
        variants: [],
        sources: []
      });
    }
    
    const group = productGroups.get(key);
    
    // Add product as a source
    group.sources.push({
      source: product.source,
      url: product.url,
      price: product.price,
      original_price: product.original_price,
      discount: product.discount,
      rating: product.rating,
      rating_count: product.rating_count,
      images: product.images
    });
    
    // Add product variant if it doesn't exist
    const variantKey = `${product.ram_gb || 'unknown'}_${product.storage_gb || 'unknown'}_${product.color || 'unknown'}`;
    const existingVariant = group.variants.find(v => 
      v.ram_gb === product.ram_gb && 
      v.storage_gb === product.storage_gb && 
      v.color === product.color
    );
    
    if (!existingVariant) {
      group.variants.push({
        ram_gb: product.ram_gb,
        storage_gb: product.storage_gb,
        color: product.color,
        os: product.os,
        display_inches: product.display_inches,
        camera_mp: product.camera_mp,
        battery_mah: product.battery_mah,
        specifications: product.specifications
      });
    }
  }
  
  // Convert map to array
  return Array.from(productGroups.values());
}

// Run if executed directly
if (require.main === module) {
  normalizeData()
    .then(() => logger.info('Unified normalization completed'))
    .catch(err => {
      logger.error(`Unified normalization failed: ${err.message}`);
      process.exit(1);
    });
}

module.exports = {
  normalizeData,
  groupSimilarProducts
}; 