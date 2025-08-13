const fs = require('fs');
const path = require('path');

const { sequelize, Brand, Category, Product, ProductVariant, Listing } = require('../database/models');

class DatabaseInserter {
  constructor() {
    this.brandCache = new Map();
    this.categoryCache = new Map();
    this.productCache = new Map();
    this.variantCache = new Map();
    this.currentPlatform = null;
    this.platformStats = new Map(); // Track stats per platform
    this.crossPlatformProducts = new Map(); // Track products found on multiple platforms with details
    this.productPlatformMap = new Map(); // Track which platforms each product appears on
    this.stats = {
      brands: { created: 0, existing: 0 },
      categories: { created: 0, existing: 0 },
      products: { created: 0, existing: 0 },
      variants: { created: 0, existing: 0 },
      listings: { created: 0, existing: 0 },
      deduplication: {
        model_number_matches: 0,
        cross_field_matches: 0,
        new_products: 0,
        apple_variants: 0,
        cross_platform_merges: 0
      },
      crossPlatform: {
        commonProducts: 0,
        platformSpecificProducts: 0,
        totalUniqueProducts: 0,
        variantMerges: 0,
        newVariantsOnExistingProducts: 0
      },
      errors: []
    };
  }

  /**
   * Get category ID based on product type (smartphone vs basic phone)
   */
  /**
   * Get category for product using model method
   */
  async getCategoryForProduct(productData) {
    return await Category.getCategoryForProduct(productData, this.categoryCache, this.stats);
  }

  /**
   * Get or create brand using model method
   */
  async getOrCreateBrand(brandName) {
    return await Brand.insertWithCache(brandName, this.brandCache, this.stats);
  }

  /**
   * Get or create product using model method with dual model names
   */
  async getOrCreateProduct(productData, brandId, categoryId) {
    // Initialize dual cache system if not already done
    if (!this.modelNumberCache) {
      const cacheSystem = Product.createDualCache();
      this.modelNumberCache = cacheSystem.modelNumberCache;
      this.modelNameCache = cacheSystem.modelNameCache;
      this.dualCacheStats = cacheSystem.stats;
      // Initialize deduplication stats if they don't exist
      if (!this.stats.deduplication.exact_name_matches) {
        this.stats.deduplication.exact_name_matches = 0;
      }
      if (!this.stats.deduplication.variant_5g_matches) {
        this.stats.deduplication.variant_5g_matches = 0;
      }
    }

    const result = await Product.insertWithCache(
      productData,
      brandId,
      categoryId,
      this.modelNumberCache,
      this.modelNameCache,
      this.dualCacheStats
    );

    // Merge updated statistics from dual cache system
    this.stats.deduplication.model_number_matches = this.dualCacheStats.deduplication.model_number_matches;
    this.stats.deduplication.exact_name_matches = this.dualCacheStats.deduplication.exact_name_matches;
    this.stats.deduplication.variant_5g_matches = this.dualCacheStats.deduplication.variant_5g_matches;
    this.stats.deduplication.new_products = this.dualCacheStats.deduplication.new_products;
    
    // Merge product creation statistics
    this.stats.products.created = this.dualCacheStats.products.created;
    this.stats.products.existing = this.dualCacheStats.products.existing;

    return result;
  }

  /**
   * Get or create product variant using model method
   */
  async getOrCreateVariant(productData, productId, brandName = null) {
    return await ProductVariant.insertWithCache(productData, productId, brandName, this.variantCache, this.stats);
  }

  /**
   * Create listing using model method
   */
  async createListing(productData, variantId) {
    return await Listing.insertWithStats(productData, variantId, this.stats);
  }

  /**
   * Track cross-platform product information
   */
  trackCrossPlatformProduct(productData, productId, wasNewProduct, wasNewVariant) {
    const productKey = `${productData.product_identifiers?.brand}_${productData.product_identifiers?.model_name}`;

    if (!this.productPlatformMap.has(productKey)) {
      this.productPlatformMap.set(productKey, {
        platforms: new Set(),
        productId: productId,
        modelName: productData.product_identifiers?.model_name,
        brand: productData.product_identifiers?.brand,
        wasNewProduct: wasNewProduct,
        variants: new Set()
      });
    }

    const productInfo = this.productPlatformMap.get(productKey);
    productInfo.platforms.add(this.currentPlatform);

    // Track variant information
    const variantKey = `${productData.variant_attributes?.ram || 0}_${productData.variant_attributes?.storage || 0}_${productData.variant_attributes?.color || 'default'}`;
    productInfo.variants.add(`${this.currentPlatform}:${variantKey}`);

    // Update cross-platform stats
    if (productInfo.platforms.size > 1) {
      this.stats.crossPlatform.commonProducts++;
      if (!wasNewProduct && wasNewVariant) {
        this.stats.crossPlatform.newVariantsOnExistingProducts++;
      }
    }
  }

  /**
   * Process single product data with minimal logging
   */
  async processProduct(productData, index) {
    try {
      const productName = productData.product_identifiers?.model_name || 'Unknown Product';

      // Extract data
      const brand_name = productData.product_identifiers?.brand;

      if (!brand_name) {
        this.stats.errors.push(`Product ${index + 1}: No brand name`);
        return null;
      }

      // Step 1: Create/Get Brand
      const brandId = await this.getOrCreateBrand(brand_name);
      if (!brandId) {
        this.stats.errors.push(`Product ${index + 1}: Could not create brand`);
        return null;
      }

      // Step 2: Get Category based on product type
      const categoryId = await this.getCategoryForProduct(productData);

      // Step 3: Create/Get Product
      const productCacheKey = `${brand_name}_${productName}`;
      const wasNewProduct = !this.productCache.has(productCacheKey);
      const productId = await this.getOrCreateProduct(productData, brandId, categoryId);
      if (!productId) {
        this.stats.errors.push(`Product ${index + 1}: Could not create product`);
        return null;
      }

      // Step 4: Create/Get Variant
      const variantKey = `${productId}_${productData.variant_attributes?.ram || 0}_${productData.variant_attributes?.storage || 0}_${productData.variant_attributes?.color || 'default'}`;
      const wasNewVariant = !this.variantCache.has(variantKey);
      const variantId = await this.getOrCreateVariant(productData, productId, brand_name);
      if (!variantId) {
        this.stats.errors.push(`Product ${index + 1}: Could not create variant`);
        return null;
      }

      // Step 5: Create Listing
      const listingId = await this.createListing(productData, variantId);

      // Track cross-platform information
      this.trackCrossPlatformProduct(productData, productId, wasNewProduct, wasNewVariant);

      return {
        brandId,
        categoryId,
        productId,
        variantId,
        listingId
      };

    } catch (error) {
      this.stats.errors.push(`Product ${index + 1}: ${error.message}`);
      return null;
    }
  }

  /**
   * Update product variant counts (removed price stats as they belong to listings)
   */
  async updateProductStats() {
    try {
      const products = await Product.findAll();
      let updated = 0;

      for (const product of products) {
        const variantCount = await ProductVariant.count({
          where: {
            product_id: product.id,
            is_active: true
          }
        });

        await product.update({ variant_count: variantCount });
        updated++;
      }

    } catch (error) {
      console.error('❌ Error updating product statistics:', error.message);
    }
  }

  /**
   * Analyze cross-platform data and update stats
   */
  analyzeCrossPlatformData() {
    let commonProducts = 0;
    let platformSpecificProducts = 0;
    const platformBreakdown = new Map();
    const commonProductsList = [];
    const variantOverlapStats = {
      totalVariantOverlaps: 0,
      uniqueVariantsPerPlatform: new Map()
    };

    for (const [productKey, productInfo] of this.productPlatformMap) {
      if (productInfo.platforms.size > 1) {
        commonProducts++;
        commonProductsList.push({
          brand: productInfo.brand,
          model: productInfo.modelName,
          platforms: Array.from(productInfo.platforms),
          variantCount: productInfo.variants.size
        });

        // Analyze variant overlaps for common products
        const platformVariants = new Map();
        for (const variantKey of productInfo.variants) {
          const [platform, variant] = variantKey.split(':');
          if (!platformVariants.has(platform)) {
            platformVariants.set(platform, new Set());
          }
          platformVariants.get(platform).add(variant);
        }

        // Count unique variants per platform for this product
        for (const [platform, variants] of platformVariants) {
          const currentCount = variantOverlapStats.uniqueVariantsPerPlatform.get(platform) || 0;
          variantOverlapStats.uniqueVariantsPerPlatform.set(platform, currentCount + variants.size);
        }

      } else {
        platformSpecificProducts++;
        const platform = Array.from(productInfo.platforms)[0];
        platformBreakdown.set(platform, (platformBreakdown.get(platform) || 0) + 1);
      }
    }

    this.stats.crossPlatform.commonProducts = commonProducts;
    this.stats.crossPlatform.platformSpecificProducts = platformSpecificProducts;
    this.stats.crossPlatform.totalUniqueProducts = this.productPlatformMap.size;

    return {
      platformBreakdown,
      commonProductsList: commonProductsList.slice(0, 10), // Show top 10 common products
      variantOverlapStats
    };
  }

  /**
   * Print comprehensive statistics with cross-platform insights
   */
  printStats() {
    console.log('\n' + '='.repeat(60));
    console.log('📊 DATABASE INGESTION SUMMARY');
    console.log('='.repeat(60));

    // Analyze cross-platform data
    const { platformBreakdown, commonProductsList, variantOverlapStats } = this.analyzeCrossPlatformData();

    console.log(`\n🔄 CROSS-PLATFORM ANALYSIS:`);
    console.log(`   Total Unique Products: ${this.stats.crossPlatform.totalUniqueProducts}`);
    console.log(`   Common Products (Multi-Platform): ${this.stats.crossPlatform.commonProducts}`);
    console.log(`   Platform-Specific Products: ${this.stats.crossPlatform.platformSpecificProducts}`);

    if (this.stats.crossPlatform.totalUniqueProducts > 0) {
      const commonRate = ((this.stats.crossPlatform.commonProducts / this.stats.crossPlatform.totalUniqueProducts) * 100).toFixed(1);
      console.log(`   Cross-Platform Coverage: ${commonRate}%`);
    }

    if (platformBreakdown.size > 0) {
      console.log(`\n   Platform-Specific Breakdown:`);
      for (const [platform, count] of platformBreakdown) {
        console.log(`     ${platform}: ${count} exclusive products`);
      }
    }

    if (commonProductsList.length > 0) {
      console.log(`\n   Sample Common Products:`);
      commonProductsList.slice(0, 5).forEach(product => {
        console.log(`     ${product.brand} ${product.model} (${product.platforms.join(', ')}) - ${product.variantCount} variants`);
      });
      if (commonProductsList.length > 5) {
        console.log(`     ... and ${commonProductsList.length - 5} more common products`);
      }
    }

    console.log(`\n📱 PRODUCTS:`);
    console.log(`   New Products Created: ${this.stats.products.created}`);
    console.log(`   Existing Products Found: ${this.stats.products.existing}`);
    console.log(`   Total Products Processed: ${this.stats.products.created + this.stats.products.existing}`);

    console.log(`\n🔧 VARIANTS:`);
    console.log(`   New Variants Created: ${this.stats.variants.created}`);
    console.log(`   Existing Variants Found: ${this.stats.variants.existing}`);
    console.log(`   New Variants on Existing Products: ${this.stats.crossPlatform.newVariantsOnExistingProducts}`);
    console.log(`   Total Variants Processed: ${this.stats.variants.created + this.stats.variants.existing}`);

    if (variantOverlapStats.uniqueVariantsPerPlatform.size > 0) {
      console.log(`\n   Variant Distribution for Common Products:`);
      for (const [platform, count] of variantOverlapStats.uniqueVariantsPerPlatform) {
        console.log(`     ${platform}: ${count} variants across common products`);
      }
    }

    console.log(`\n🛒 LISTINGS:`);
    console.log(`   New Listings Created: ${this.stats.listings.created}`);
    console.log(`   Existing Listings Updated: ${this.stats.listings.existing}`);
    console.log(`   Total Listings Processed: ${this.stats.listings.created + this.stats.listings.existing}`);

    console.log(`\n🏷️  BRANDS & CATEGORIES:`);
    console.log(`   New Brands: ${this.stats.brands.created} | Existing: ${this.stats.brands.existing}`);
    console.log(`   New Categories: ${this.stats.categories.created} | Existing: ${this.stats.categories.existing}`);

    console.log(`\n🔍 DEDUPLICATION PERFORMANCE:`);
    console.log(`   Model Number Matches: ${this.stats.deduplication.model_number_matches}`);
    console.log(`   Exact Model Name Matches: ${this.stats.deduplication.exact_name_matches || 0}`);
    console.log(`   5G Variant Matches: ${this.stats.deduplication.variant_5g_matches || 0}`);
    console.log(`   Fuzzy Name Matches: ${this.stats.deduplication.fuzzy_name_matches || 0}`);
    console.log(`   Apple Variants (Storage+Color): ${this.stats.deduplication.apple_variants || 0}`);

    const totalMatches = this.stats.deduplication.model_number_matches +
      (this.stats.deduplication.exact_name_matches || 0) +
      (this.stats.deduplication.variant_5g_matches || 0) +
      (this.stats.deduplication.fuzzy_name_matches || 0);
    const totalProcessed = totalMatches + (this.stats.deduplication.new_products || 0);
    if (totalProcessed > 0) {
      const deduplicationRate = ((totalMatches / totalProcessed) * 100).toFixed(1);
      console.log(`   Overall Deduplication Rate: ${deduplicationRate}%`);
    }

    if (this.stats.errors.length > 0) {
      console.log(`\n❌ PROCESSING ERRORS (${this.stats.errors.length}):`);
      this.stats.errors.slice(0, 5).forEach(error => {
        console.log(`   - ${error}`);
      });
      if (this.stats.errors.length > 5) {
        console.log(`   ... and ${this.stats.errors.length - 5} more errors`);
      }
    }

    console.log('\n' + '='.repeat(60));
  }


  /**
   * Process single normalized data file
   */
  async insertDataFromFile(dataFile, sourceName = 'unknown') {
    try {
      this.currentPlatform = sourceName;
      console.log(`🚀 Processing ${sourceName} data...`);

      // Test database connection
      await sequelize.authenticate();

      // Sync models (create tables if they don't exist)
      await sequelize.sync();

      // Load data file
      if (!fs.existsSync(dataFile)) {
        throw new Error(`Data file not found: ${dataFile}`);
      }

      const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
      console.log(`📊 Loaded ${data.length} ${sourceName} products`);

      // Store initial counts for platform-specific stats
      const initialStats = {
        products: this.stats.products.created + this.stats.products.existing,
        variants: this.stats.variants.created + this.stats.variants.existing,
        listings: this.stats.listings.created + this.stats.listings.existing
      };

      // Process data with minimal logging
      let processed = 0;
      let skipped = 0;

      for (let i = 0; i < data.length; i++) {
        const result = await this.processProduct(data[i], i);
        if (result) {
          processed++;
        } else {
          skipped++;
        }

        // Progress indicator every 50 products
        if ((i + 1) % 50 === 0) {
          console.log(`📈 Progress: ${i + 1}/${data.length} processed (${processed} successful, ${skipped} skipped)`);
        }
      }

      // Calculate platform-specific stats
      const platformStats = {
        products: (this.stats.products.created + this.stats.products.existing) - initialStats.products,
        variants: (this.stats.variants.created + this.stats.variants.existing) - initialStats.variants,
        listings: (this.stats.listings.created + this.stats.listings.existing) - initialStats.listings,
        processed: processed,
        skipped: skipped
      };

      console.log(`\n✅ ${sourceName} completed: ${platformStats.processed} products processed, ${platformStats.skipped} skipped`);
      console.log(`   Products: ${platformStats.products} | Variants: ${platformStats.variants} | Listings: ${platformStats.listings}`);

    } catch (error) {
      console.error(`\n❌ ${sourceName} insertion failed:`, error.message);
      throw error;
    }
  }

  /**
   * Process multiple normalized data files with comprehensive cross-platform analysis
   */
  async insertAllNormalizedData() {
    const normalizedFiles = [
      { file: path.join(__dirname, '..', '..', 'parsed_data', 'flipkart_normalized_data.json'), source: 'Flipkart' },
      { file: path.join(__dirname, '..', '..', 'parsed_data', 'amazon_normalized_data.json'), source: 'Amazon' },
      { file: path.join(__dirname, '..', '..', 'parsed_data', 'croma_normalized_data.json'), source: 'Croma' }
    ];

    console.log('🚀 Starting cross-platform database ingestion...\n');

    // Test database connection once
    await sequelize.authenticate();
    console.log('✅ Database connection established');
    await sequelize.sync();
    console.log('✅ Database models synchronized\n');

    const availableFiles = normalizedFiles.filter(({ file }) => fs.existsSync(file));

    if (availableFiles.length === 0) {
      console.log('❌ No normalized data files found');
      return;
    }

    console.log(`📂 Found ${availableFiles.length} data files to process:`);
    availableFiles.forEach(({ source, file }) => {
      console.log(`   - ${source}: ${path.basename(file)}`);
    });
    console.log();

    // Process each platform
    for (const { file, source } of availableFiles) {
      console.log(`${'─'.repeat(50)}`);
      try {
        await this.insertDataFromFile(file, source);
      } catch (error) {
        console.error(`❌ Failed to process ${source} data:`, error.message);
        // Continue with next file instead of stopping
      }
    }

    // Update product statistics
    console.log('\n📊 Updating product variant counts...');
    await this.updateProductStats();

    // Print comprehensive final statistics
    this.printStats();

    console.log('🎉 Cross-platform ingestion completed successfully!');
  }
}

// Main execution functions
async function main() {
  const inserter = new DatabaseInserter();

  try {
    // Check command line arguments
    const args = process.argv.slice(2);

    if (args.length === 0) {
      // No arguments - process all normalized files
      await inserter.insertAllNormalizedData();
    } else if (args.length === 1) {
      // Single file argument
      const dataFile = args[0];
      const sourceName = path.basename(dataFile, '.json').replace('_normalized_data', '');
      await inserter.insertDataFromFile(dataFile, sourceName);
    } else {
      console.log('Usage:');
      console.log('  node insert-normalized-data.js                    # Process all normalized files');
      console.log('  node insert-normalized-data.js <file.json>        # Process single file');
      process.exit(1);
    }
  } catch (error) {
    console.error('💥 Fatal error:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = DatabaseInserter; 