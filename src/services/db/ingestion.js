const { Brand, Category, Product, ProductVariant, Offer } = require('../database/models');
const ProductParser = require('./enhanced-parser');
const { createLogger } = require('../utils/logger');

const logger = createLogger('DataIngestion');

class DataIngestionService {
  constructor() {
    this.parser = new ProductParser();
    this.categoryMappings = new Map();
    this.brandCache = new Map();
  }

  /**
   * Initialize category mappings to convert names to IDs
   */
  async initializeCategoryMappings() {
    try {
      const categories = await Category.findAll({
        where: { is_active: true }
      });

      // Create a mapping of category names to IDs for quick lookup
      categories.forEach(category => {
        this.categoryMappings.set(category.name.toLowerCase(), category.id);
        this.categoryMappings.set(category.slug, category.id);
      });

      logger.info(`Initialized ${categories.length} category mappings`);
    } catch (error) {
      logger.error('Error initializing category mappings:', error);
    }
  }

  /**
   * Get category ID from category name
   */
  getCategoryId(categoryName) {
    if (!categoryName) return null;
    
    // Try exact match first, then lowercase
    return this.categoryMappings.get(categoryName) || 
           this.categoryMappings.get(categoryName.toLowerCase());
  }

  /**
   * Get or create brand
   */
  async getOrCreateBrand(brandName) {
    if (!brandName) return null;

    // Check cache first
    if (this.brandCache.has(brandName)) {
      return this.brandCache.get(brandName);
    }

    try {
      const { brand } = await Brand.findOrCreateByName(brandName);
      this.brandCache.set(brandName, brand);
      return brand;
    } catch (error) {
      logger.error(`Error creating brand ${brandName}:`, error);
      return null;
    }
  }

  /**
   * Get or create product
   */
  async getOrCreateProduct(parsedData, brand, categoryId) {
    if (!brand || !categoryId) return null;

    try {
      // Create a normalized product name
      const productName = `${parsedData.model || 'Unknown Model'}`;
      
      const { product } = await Product.findOrCreateByDetails(
        productName,
        brand.id,
        categoryId
      );

      return product;
    } catch (error) {
      logger.error('Error creating product:', error);
      return null;
    }
  }

  /**
   * Get or create product variant
   */
  async getOrCreateVariant(product, parsedData) {
    if (!product) return null;

    try {
      const attributes = {
        brand: parsedData.brand,
        model: parsedData.model,
        color: parsedData.color,
        storage_gb: parsedData.storage_gb,
        ram_gb: parsedData.ram_gb
      };

      const { variant } = await ProductVariant.findOrCreateByAttributes(
        product.id,
        attributes
      );

      return variant;
    } catch (error) {
      logger.error('Error creating variant:', error);
      return null;
    }
  }

  /**
   * Create offer
   */
  async createOffer(variant, rawData) {
    if (!variant) return null;

    try {
      // Clean price data - remove currency symbols and commas
      const cleanPrice = (price) => {
        if (!price) return null;
        return parseFloat(price.toString().replace(/[₹$,]/g, '').trim());
      };

      const offerData = {
        store_name: rawData.store_name || 'unknown',
        store_product_id: rawData.store_product_id || rawData.asin || rawData.product_id || null,
        price: rawData.price ?cleanPrice(rawData.price) : cleanPrice(rawData.current_price),
        currency: rawData.currency || 'INR',
        url: rawData.url || `https://placeholder.com/product/${rawData.title?.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase() || 'unknown'}`,
        stock_status: 'unknown',
        rating: rawData.rating ? rawData.rating : null,
        review_count: rawData.review_count || 0,
        scraped_at: new Date(rawData.scraped_at || Date.now())
      };

      const { offer } = await Offer.createOrUpdate(variant.id, offerData);
      return offer;
    } catch (error) {
      logger.error('Error creating offer:', error);
      return null;
    }
  }

  /**
   * Process a single parsed product
   */
  async processProduct(rawData, parsedData) {
    try {
      // Get or create brand
      const brand = await this.getOrCreateBrand(parsedData.brand);
      if (!brand) {
        logger.warn(`Could not create brand for: ${parsedData.brand}`);
        return null;
      }

      // Get category name from data and convert to ID
      const categoryName = parsedData.category || rawData.category;
      if (!categoryName) {
        logger.warn(`No category found in data for: ${rawData.title}`);
        return null;
      }
      
      const categoryId = this.getCategoryId(categoryName);
      if (!categoryId) {
        logger.warn(`Could not find category ID for category: ${categoryName}`);
        return null;
      }

      // Get or create product
      const product = await this.getOrCreateProduct(parsedData, brand, categoryId);
      if (!product) {
        logger.warn(`Could not create product for: ${rawData.title}`);
        return null;
      }

      // Get or create variant
      const variant = await this.getOrCreateVariant(product, parsedData);
      if (!variant) {
        logger.warn(`Could not create variant for: ${rawData.title}`);
        return null;
      }

      // Create offer
      const offer = await this.createOffer(variant, rawData);
      if (!offer) {
        logger.warn(`Could not create offer for: ${rawData.title}`);
        return null;
      }

      return {
        brand,
        product,
        variant,
        offer
      };
    } catch (error) {
      logger.error(`Error processing product ${rawData.title}:`, error);
      return null;
    }
  }

  /**
   * Update price statistics after ingestion
   */
  async updatePriceStatistics(productIds) {
    logger.info('Updating price statistics...');
    
    try {
      // Get price statistics for variants
      const variants = await ProductVariant.findAll({
        where: {
          product_id: productIds
        }
      });

      logger.info(`Found ${variants.length} variants to process`);

      // Update product price stats
      const products = await Product.findAll({
        where: {
          id: productIds
        }
      });

      for (const product of products) {
        await product.updatePriceStats();
      }

      logger.info(`Updated price statistics for ${products.length} products`);
    } catch (error) {
      logger.error('Error updating price statistics:', error);
    }
  }

  /**
   * Ingest parsed data into database
   */
  async ingestParsedData(parsedData) {
    await this.initializeCategoryMappings();
    
    const results = {
      total: parsedData.length,
      success: 0,
      failed: 0,
      brands: new Set(),
      products: new Set(),
      variants: new Set(),
      offers: new Set()
    };

    logger.info(`Starting ingestion of ${parsedData.length} products`);

    for (let i = 0; i < parsedData.length; i++) {
      const item = parsedData[i];
      
      if (i % 100 === 0) {
        logger.info(`Processing item ${i + 1}/${parsedData.length}`);
      }

      const result = await this.processProduct(item, item);
      
      if (result) {
        results.success++;
        results.brands.add(result.brand.id);
        results.products.add(result.product.id);
        results.variants.add(result.variant.id);
        results.offers.add(result.offer.id);
      } else {
        results.failed++;
      }
    }

    // Update price statistics
    await this.updatePriceStatistics(Array.from(results.products));

    const summary = {
      total: results.total,
      success: results.success,
      failed: results.failed,
      brands_created: results.brands.size,
      products_created: results.products.size,
      variants_created: results.variants.size,
      offers_created: results.offers.size
    };

    logger.info('Ingestion completed:', summary);
    return summary;
  }

  /**
   * Full pipeline: scrape -> parse -> ingest
   */
  async runFullPipeline(parsedDataFile) {
    try {
      logger.info('Starting full ingestion pipeline');
      const fs = require('fs');
      const fileContent = fs.readFileSync(parsedDataFile, 'utf8');
      const parsedData = JSON.parse(fileContent);
      logger.info(`Loaded ${parsedData.length} products from parsed data file`);
      const ingestResult = await this.ingestParsedData(parsedData);
      return {
        success: true,
        ingestion: ingestResult
      };
    } catch (error) {
      logger.error('Full pipeline failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = DataIngestionService;

// Allow running directly
if (require.main === module) {
  const ingestionService = new DataIngestionService();
  const path = require('path');
  const fs = require('fs');
  const inputArg = process.argv[2];
  const parsedDataDir = path.join(__dirname, '../../parsed_data');

  async function processAllFiles() {
    const files = fs.readdirSync(parsedDataDir).filter(f => f.endsWith('.json'));
    let combined = {
      total: 0,
      success: 0,
      failed: 0,
      brands_created: 0,
      products_created: 0,
      variants_created: 0,
      offers_created: 0
    };
    for (const file of files) {
      const filePath = path.join(parsedDataDir, file);
      console.log(`\nProcessing file: ${file}`);
      try {
        const result = await ingestionService.runFullPipeline(filePath);
        console.log('Pipeline result:', result);
        if (result && result.success && result.ingestion) {
          combined.total += result.ingestion.total || 0;
          combined.success += result.ingestion.success || 0;
          combined.failed += result.ingestion.failed || 0;
          combined.brands_created += result.ingestion.brands_created || 0;
          combined.products_created += result.ingestion.products_created || 0;
          combined.variants_created += result.ingestion.variants_created || 0;
          combined.offers_created += result.ingestion.offers_created || 0;
        }
      } catch (err) {
        console.error(`Error processing ${file}:`, err);
      }
    }
    console.log('\nCombined pipeline summary for all files:');
    console.log(combined);
  }

  if (inputArg) {
    const inputFile = path.resolve(inputArg);
    ingestionService.runFullPipeline(inputFile).then(result => {
      console.log('Pipeline result:', result);
    }).catch(console.error);
  } else {
    processAllFiles();
  }
} 