const fs = require('fs');
const path = require('path');

const { sequelize, Brand, Category, Product, ProductVariant, Listing } = require('../database/models');

class DatabaseInserter {
  constructor() {
    this.brandCache = new Map();
    this.categoryCache = new Map();
    this.productCache = new Map();
    this.variantCache = new Map();
    this.stats = {
      brands: { created: 0, existing: 0 },
      categories: { created: 0, existing: 0 },
      products: { created: 0, existing: 0 },
      variants: { created: 0, existing: 0 },
      listings: { created: 0, existing: 0 },
      deduplication: {
        model_number_matches: 0,
        cross_field_matches: 0,
        fuzzy_name_matches: 0,
        new_products: 0,
        apple_variants: 0
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
   * Get or create product using model method
   */
  async getOrCreateProduct(productData, brandId, categoryId) {
    return await Product.insertWithCache(productData, brandId, categoryId, this.productCache, this.stats);
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
   * Process single product data with detailed logging
   */
  async processProduct(productData, index, showDetailedLog = false) {
    try {
      const productName = productData.product_identifiers?.model_name || 'Unknown Product';
      console.log(`\n📱 Processing product ${index + 1}: ${productName}`);
      
      if (showDetailedLog) {
        console.log(`📋 Original breadcrumb: [${productData.source_metadata?.category_breadcrumb?.join(' -> ') || 'None'}]`);
      }
      
      // Extract data
      const brand_name = productData.product_identifiers?.brand;
      const breadcrumb = productData.source_metadata?.category_breadcrumb;

      if (!brand_name) {
        console.log(`⚠️  Skipping product ${index + 1}: No brand name`);
        return null;
      }

      // Step 1: Create/Get Brand
      const brandId = await this.getOrCreateBrand(brand_name);
      if (!brandId) {
        console.log(`⚠️  Skipping product ${index + 1}: Could not create brand`);
        return null;
      }
      
      if (showDetailedLog) {
        console.log(`🏷️  Brand: ${brand_name} (ID: ${brandId})`);
      }

      // Step 2: Get Category based on product type
      const categoryId = await this.getCategoryForProduct(productData);
      if (showDetailedLog && categoryId) {
        const category = await Category.findByPk(categoryId);
        console.log(`📂 Category: ${category?.name} (Path: ${category?.path})`);
      }

      // Step 3: Create/Get Product
      const productId = await this.getOrCreateProduct(productData, brandId, categoryId);
      if (!productId) {
        console.log(`⚠️  Skipping product ${index + 1}: Could not create product`);
        return null;
      }
      
      if (showDetailedLog) {
        console.log(`📱 Product: ${productName} (ID: ${productId})`);
      }

      // Step 4: Create/Get Variant
      const variantId = await this.getOrCreateVariant(productData, productId, brand_name);
      if (!variantId) {
        console.log(`⚠️  Skipping product ${index + 1}: Could not create variant`);
        return null;
      }
      
      if (showDetailedLog) {
        const variant = productData.variant_attributes;
        console.log(`🔧 Variant: ${variant?.ram || 0}GB RAM, ${variant?.storage || 0}GB Storage, ${variant?.color || 'Default'} (ID: ${variantId})`);
      }

      // Step 5: Create Listing
      const listingId = await this.createListing(productData, variantId);
      
      if (showDetailedLog && listingId) {
        const price = productData.listing_info?.price?.current || 0;
        const store = productData.source_details?.source_name || 'unknown';
        console.log(`🛒 Listing: ${store} - ₹${price} (ID: ${listingId})`);
        console.log(`✅ Complete data flow: Brand -> Category -> Product -> Variant -> Listing`);
      }

      return {
        brandId,
        categoryId,
        productId,
        variantId,
        listingId
      };

    } catch (error) {
      console.error(`❌ Error processing product ${index + 1}:`, error.message);
      this.stats.errors.push(`Product ${index + 1}: ${error.message}`);
      return null;
    }
  }

  /**
   * Update product variant counts (removed price stats as they belong to listings)
   */
  async updateProductStats() {
    console.log('\n📊 Updating product variant counts...');
    
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
        
        if (updated % 10 === 0) {
          console.log(`Updated ${updated}/${products.length} products...`);
        }
      }

      console.log(`✅ Updated variant counts for ${updated} products`);
    } catch (error) {
      console.error('❌ Error updating product statistics:', error.message);
    }
  }

  /**
   * Print final statistics
   */
  printStats() {
    console.log('\n' + '='.repeat(50));
    console.log('📊 INSERTION STATISTICS');
    console.log('='.repeat(50));
    
    console.log(`\n🏷️  Brands:`);
    console.log(`   Created: ${this.stats.brands.created}`);
    console.log(`   Existing: ${this.stats.brands.existing}`);
    console.log(`   Total: ${this.stats.brands.created + this.stats.brands.existing}`);

    console.log(`\n📂 Categories:`);
    console.log(`   Created: ${this.stats.categories.created}`);
    console.log(`   Existing: ${this.stats.categories.existing}`);
    console.log(`   Total: ${this.stats.categories.created + this.stats.categories.existing}`);

    console.log(`\n📱 Products:`);
    console.log(`   Created: ${this.stats.products.created}`);
    console.log(`   Existing: ${this.stats.products.existing}`);
    console.log(`   Total: ${this.stats.products.created + this.stats.products.existing}`);

    console.log(`\n🔧 Variants:`);
    console.log(`   Created: ${this.stats.variants.created}`);
    console.log(`   Existing: ${this.stats.variants.existing}`);
    console.log(`   Total: ${this.stats.variants.created + this.stats.variants.existing}`);

    console.log(`\n🛒 Listings:`);
    console.log(`   Created: ${this.stats.listings.created}`);
    console.log(`   Updated: ${this.stats.listings.existing}`);
    console.log(`   Total: ${this.stats.listings.created + this.stats.listings.existing}`);

    console.log(`\n🔍 Enhanced Deduplication:`);
    console.log(`   Model Number Matches: ${this.stats.deduplication.model_number_matches}`);
    console.log(`   Cross-Field Matches (Model# → Model Name): ${this.stats.deduplication.cross_field_matches || 0}`);
    console.log(`   Fuzzy Name Matches: ${this.stats.deduplication.fuzzy_name_matches}`);
    console.log(`   New Products Created: ${this.stats.deduplication.new_products}`);
    console.log(`   Apple Variants (Storage+Color): ${this.stats.deduplication.apple_variants}`);
    
    const totalMatches = this.stats.deduplication.model_number_matches + 
                        (this.stats.deduplication.cross_field_matches || 0) + 
                        this.stats.deduplication.fuzzy_name_matches;
    const totalProcessed = totalMatches + this.stats.deduplication.new_products;
    if (totalProcessed > 0) {
      const deduplicationRate = ((totalMatches / totalProcessed) * 100).toFixed(1);
      console.log(`   Deduplication Rate: ${deduplicationRate}%`);
    }

    if (this.stats.errors.length > 0) {
      console.log(`\n❌ Errors (${this.stats.errors.length}):`);
      this.stats.errors.slice(0, 10).forEach(error => {
        console.log(`   - ${error}`);
      });
      if (this.stats.errors.length > 10) {
        console.log(`   ... and ${this.stats.errors.length - 10} more errors`);
      }
    }
  }

  /**
   * Test single product insertion with detailed logging
   */
  async testSingleProductInsertion(productData) {
    try {
      console.log('🧪 TESTING SINGLE PRODUCT INSERTION');
      console.log('='.repeat(60));
      
      // Test database connection
      await sequelize.authenticate();
      console.log('✅ Database connection established');

      console.log('\n📋 INPUT DATA:');
      console.log('Source:', productData.source_details?.source_name);
      console.log('Brand:', productData.product_identifiers?.brand);
      console.log('Model:', productData.product_identifiers?.model_name);
      console.log('Original Breadcrumb:', productData.source_metadata?.category_breadcrumb?.join(' -> '));
      console.log('Variant:', `${productData.variant_attributes?.ram || 0}GB RAM, ${productData.variant_attributes?.storage || 0}GB Storage, ${productData.variant_attributes?.color || 'Default'}`);
      console.log('Price:', `₹${productData.listing_info?.price?.current || 0}`);

      console.log('\n🔄 PROCESSING STEPS:');
      const result = await this.processProduct(productData, 0, true);

      if (result) {
        console.log('\n📊 FINAL DATABASE RECORDS:');
        
        // Show the actual database records created
        const brand = await Brand.findByPk(result.brandId);
        const category = await Category.findByPk(result.categoryId);
        const product = await Product.findByPk(result.productId);
        const variant = await ProductVariant.findByPk(result.variantId);
        const listing = await Listing.findByPk(result.listingId);

        console.log(`\n🏷️  BRANDS TABLE:`);
        console.log(`   ID: ${brand?.id}`);
        console.log(`   Name: ${brand?.name}`);
        console.log(`   Slug: ${brand?.slug}`);

        console.log(`\n📂 CATEGORIES TABLE:`);
        console.log(`   ID: ${category?.id}`);
        console.log(`   Name: ${category?.name}`);
        console.log(`   Path: ${category?.path}`);
        console.log(`   Level: ${category?.level}`);

        console.log(`\n📱 PRODUCTS TABLE:`);
        console.log(`   ID: ${product?.id}`);
        console.log(`   Model Name: ${product?.model_name}`);
        console.log(`   Model Number: ${product?.model_number}`);
        console.log(`   Brand ID: ${product?.brand_id}`);
        console.log(`   Category ID: ${product?.category_id}`);
        console.log(`   Status: ${product?.status}`);

        console.log(`\n🔧 PRODUCT_VARIANTS TABLE:`);
        console.log(`   ID: ${variant?.id}`);
        console.log(`   Product ID: ${variant?.product_id}`);
        console.log(`   Name: ${variant?.name}`);
        console.log(`   Attributes: ${JSON.stringify(variant?.attributes)}`);
        console.log(`   RAM: ${variant?.attributes?.ram_gb || 'N/A'}GB`);
        console.log(`   Storage: ${variant?.attributes?.storage_gb || 'N/A'}GB`);
        console.log(`   Color: ${variant?.attributes?.color || 'N/A'}`);

        console.log(`\n🛒 LISTINGS TABLE:`);
        console.log(`   ID: ${listing?.id}`);
        console.log(`   Variant ID: ${listing?.variant_id}`);
        console.log(`   Store: ${listing?.store_name}`);
        console.log(`   Price: ₹${listing?.price}`);
        console.log(`   Original Price: ₹${listing?.original_price}`);
        console.log(`   Discount: ${listing?.discount_percentage}%`);
        console.log(`   Rating: ${listing?.rating}`);
        console.log(`   Availability: ${listing?.availability}`);
        console.log(`   Stock Status: ${listing?.stock_status}`);
        console.log(`   URL: ${listing?.url?.substring(0, 50)}...`);

        console.log('\n✅ Single product insertion test completed successfully!');
        return result;
      } else {
        console.log('\n❌ Single product insertion test failed!');
        return null;
      }

    } catch (error) {
      console.error('\n❌ Single product test failed:', error.message);
      throw error;
    }
  }

  /**
   * Process single normalized data file
   */
  async insertDataFromFile(dataFile, sourceName = 'unknown') {
    try {
      console.log(`🚀 Starting insertion for ${sourceName}...`);
      
      // Test database connection
      await sequelize.authenticate();
      console.log('✅ Database connection established');

      // Sync models (create tables if they don't exist)
      await sequelize.sync();
      console.log('✅ Database models synchronized');

      // Load data file
      if (!fs.existsSync(dataFile)) {
        throw new Error(`Data file not found: ${dataFile}`);
      }

      const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
      console.log(`📊 Loaded ${data.length} ${sourceName} products`);

      // Process data
      console.log(`\n📱 Processing ${sourceName} data...`);
      for (let i = 0; i < data.length; i++) {
        await this.processProduct(data[i], i);
        
        // Progress indicator
        if ((i + 1) % 25 === 0) {
          console.log(`\n📈 Progress: ${i + 1}/${data.length} ${sourceName} products processed`);
        }
      }

      // Update product statistics
      await this.updateProductStats();

      // Print final statistics
      this.printStats();

      console.log(`\n✅ ${sourceName} insertion completed successfully!`);

    } catch (error) {
      console.error(`\n❌ ${sourceName} insertion failed:`, error.message);
      throw error;
    }
  }

  /**
   * Process multiple normalized data files
   */
  async insertAllNormalizedData() {
    const normalizedFiles = [
      { file: path.join(__dirname, '..', '..', 'parsed_data', 'flipkart_normalized_data.json'), source: 'Flipkart' },
      { file: path.join(__dirname, '..', '..', 'parsed_data', 'amazon_normalized_data.json'), source: 'Amazon' }
    ];

    console.log('🚀 Starting batch insertion for all normalized data...\n');

    for (const { file, source } of normalizedFiles) {
      if (fs.existsSync(file)) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`📂 Processing ${source} data from: ${file}`);
        console.log('='.repeat(60));
        
        try {
          await this.insertDataFromFile(file, source);
        } catch (error) {
          console.error(`❌ Failed to process ${source} data:`, error.message);
          // Continue with next file instead of stopping
        }
      } else {
        console.log(`⚠️  ${source} file not found: ${file}`);
      }
    }

    console.log('\n🎉 Batch insertion completed!');
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