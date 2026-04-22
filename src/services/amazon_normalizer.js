const { title } = require('process');
const AmazonAiEnhancer = require('./amazonAiEnhancer');

// Try to import logger, fall back to console if not available
let logger;
try {
  logger = require('../utils/logger');
} catch (e) {
  logger = console;
}

class AmazonNormalizer {
  constructor() {
    this.logger = logger;
    this.currentTitle = null; // Store current title for fallback extractions
    this.aiEnhancer = new AmazonAiEnhancer();
    this.enhancedProducts = []; // Store AI-enhanced products directly
  }

  /**
   * Normalize array of Amazon scraped products
   */
  async normalizeProducts(products) {
    console.log('\n🤖 Starting AI Enhancement for Amazon products...');
    console.log(`📊 Processing ${products.length} products with AI enhancer first`);

    // Step 1: Enhance all products with AI first
    try {
      this.enhancedProducts = await this.aiEnhancer.enhanceAmazonData(products);
      console.log(`✅ AI Enhancement completed for ${this.enhancedProducts.length} products`);
      
      // Calculate success/failure stats
      let successCount = 0;
      let failureCount = 0;
      
      for (const product of this.enhancedProducts) {
        if (product.extracted_attributes && 
            product.extracted_attributes.brand_name && 
            product.extracted_attributes.model_name) {
          successCount++;
        } else {
          failureCount++;
        }
      }
      
      console.log(`📊 AI Enhancement Results:`);
      console.log(`   ✅ Successful: ${successCount} products (${((successCount / products.length) * 100).toFixed(1)}%)`);
      console.log(`   ❌ Failed: ${failureCount} products (${((failureCount / products.length) * 100).toFixed(1)}%)`);
      
    } catch (error) {
      console.error(`❌ AI Enhancement failed: ${error.message}`);
      console.log('⚠️  Continuing with traditional extraction methods...');
      this.enhancedProducts = products; // Use original products if AI fails
    }

    console.log('\n📦 Starting product normalization...');
    const normalized = [];

    for (const enhancedProduct of this.enhancedProducts) {
      try {
        // Skip products with null or empty titles
        if (!enhancedProduct || !enhancedProduct.title || typeof enhancedProduct.title !== 'string' || enhancedProduct.title.trim() === '') {
          console.error(`Error normalizing product: Product has null or empty title - skipping`, enhancedProduct?.title || 'No title');
          continue;
        }

        const normalizedProduct = this.normalizeProduct(enhancedProduct);
        if (normalizedProduct) {
          normalized.push(normalizedProduct);
        }
      } catch (error) {
        console.error(`Error normalizing product: ${error.message}`, enhancedProduct?.title || 'Unknown product');
        // Continue processing other products instead of failing completely
      }
    }

    return normalized;
  }

  /**
   * Get AI-enhanced attributes directly from the enhanced product
   */
  getAiAttributes(enhancedProduct) {
    return enhancedProduct.extracted_attributes || null;
  }

  /**
   * Normalize single Amazon product to match exact format specification
   */
  normalizeProduct(product) {
    const specs = product.specifications || {};

    return {
      source_details: {
        source_name: "amazon",
        url: product.url || null,
        scraped_at_utc: '2025-08-22T18:55:33.449Z'
      },

      product_identifiers: {
        brand: this.getAiBrand(product),
        ...this.getAiModelName(product), 
        original_title: product.title || null,
        model_number: this.extractModelNumber(specs)
      },

      category: this.extractCategory(product),

      variant_attributes: {
        color: this.getAiColor(product),
        ram: this.getAiRAM(product),
        
        storage: this.getAiStorage(product)
      },

      listing_info: {
        price: this.normalizePrice(product.price),
        rating: this.normalizeRating(product.rating),
        image_url: this.cleanAmazonImageUrl(product.image),
        availability: product.availability,
      },

      key_specifications: {
        display: this.extractDisplaySpecs(specs),
        performance: this.extractPerformanceSpecs(specs),
        camera: this.extractCameraSpecs(specs),
        battery: this.extractBatterySpecs(specs),
        connectivity: this.extractConnectivitySpecs(specs),
        design: this.extractDesignSpecs(specs)
      },

      source_metadata: {
        category_breadcrumb: this.getCategoryBreadcrumb(product)
      }
    };
  }

  cleanAmazonImageUrl(imageUrl) {
    if (!imageUrl || typeof imageUrl !== 'string') return null;
    
    // Remove Amazon size suffixes like _SX679_, _SY679_, etc.
    // Pattern: underscore, SX or SY, followed by numbers, then underscore
    let cleanedUrl = imageUrl.replace(/_(SX|SY)\d+_/g, '');
    
    // Fix multiple consecutive dots that might occur after cleaning
    cleanedUrl = cleanedUrl.replace(/\.{2,}/g, '.');
    
    return cleanedUrl;
  }


  /**
   * Get AI-enhanced brand with fallback to traditional extraction
   */
  getAiBrand(product) {
    const aiAttributes = this.getAiAttributes(product);
    if (aiAttributes && aiAttributes.brand_name) {
      return aiAttributes.brand_name;
    }
    return null;
  }

  /**
   * Get AI-enhanced model name with fallback to traditional extraction
   */
  getAiModelName(product) {
    const aiAttributes = this.getAiAttributes(product);
    if (aiAttributes && aiAttributes.model_name) {
      // Return in the same format as traditional extractModelName
      return {
        model_name: aiAttributes.model_name,
      };
    }
    return null;
  }

  /**
   * Get AI-enhanced color with fallback to traditional extraction
   */
  getAiColor(product) {
    const aiAttributes = this.getAiAttributes(product);
    if (aiAttributes && aiAttributes.color) {
      return aiAttributes.color;
    }
    return null;
  }

  /**
   * Get AI-enhanced RAM with fallback to traditional extraction
   */
  getAiRAM(product) {
    const aiAttributes = this.getAiAttributes(product);
    if (aiAttributes && aiAttributes.ram !== null && aiAttributes.ram !== undefined) {
      return aiAttributes.ram;
    }
    return null;
  }

  /**
   * Get AI-enhanced storage with fallback to traditional extraction
   */
  getAiStorage(product) {
    const aiAttributes = this.getAiAttributes(product);
    if (aiAttributes && aiAttributes.storage !== null && aiAttributes.storage !== undefined) {
      return aiAttributes.storage;
    }
    return null;
  }

  /**
   * Extract brand from product data
   */
  extractBrand(product) {
    if (!product) return null;

    // First check title for Apple products specifically
    if (product.title && typeof product.title === 'string' && product.title.toLowerCase().includes('apple')) {
      return 'Apple';
    }

    // Then check specifications
    if (product.specifications?.["Brand"]) {
      return this.standardizeBrand(product.specifications["Brand"]);
    }

    // Finally check title for other brands
    const brandFromTitle = this.extractBrandFromTitle(product.title);
    return brandFromTitle ? this.standardizeBrand(brandFromTitle) : null;
  }

  /**
   * Extract model number from specifications
   */
  extractModelNumber(specs) {
    // New section-based format - ASIN from Item details
    if (specs?.["Item details"]?.["ASIN"]) {
      return specs["Item details"]["ASIN"];
    }

    return null;
  }

  /**
   * Normalize price data
   */
  normalizePrice(price) {
    if (!price) return {
      current: null,
      original: null,
      discount_percent: null,
      currency: "INR"
    };

    // Clean price strings and convert to numbers
    const cleanPrice = (priceStr) => {
      if (!priceStr) return null;
      // Remove currency symbols, commas, and extra spaces
      const cleaned = priceStr.replace(/[₹,\s]/g, '').trim();
      const match = cleaned.match(/(\d+)/);
      return match ? parseInt(match[1]) : null;
    };

    // Extract discount percentage
    let discountPercent = null;
    if (price.discount) {
      const discountMatch = price.discount.match(/-?(\d+)%/);
      if (discountMatch) {
        discountPercent = parseInt(discountMatch[1]);
      }
    }

    return {
      current: cleanPrice(price.current),
      original: cleanPrice(price.original),
      discount_percent: discountPercent,
      currency: "INR"
    };
  }

  /**
   * Normalize rating data
   */
  normalizeRating(rating) {
    if (!rating) return {
      score: null,
      count: null
    };

    return {
      score: rating.value || null,
      count: rating.count || null
    };
  }

  /**
   * Extract display specifications
   */
  extractDisplaySpecs(specs) {
    const display = {};

    // Display size - new section-based format
    if (specs?.["Display"]?.["Screen Size Unit of Measure"]) {
      const sizeMatch = specs["Display"]["Screen Size Unit of Measure"].match(/([\d.]+)/);
      if (sizeMatch) {
        display.size_in = parseFloat(sizeMatch[1]);
      }
    }

    // Resolution - new section-based format
    if (specs?.["Display"]?.["Resolution"]) {
      display.resolution = specs["Display"]["Resolution"];
    } else if (specs?.["Display"]?.["Maximum Display Resolution"]) {
      display.resolution = specs["Display"]["Maximum Display Resolution"];
    }

    // Display type - new section-based format
    if (specs?.["Display"]?.["Display Type"]) {
      display.type = specs["Display"]["Display Type"];
    }

    // PPI - new section-based format
    if (specs?.["Display"]?.["Display Pixel Density"]) {
      const ppiMatch = specs["Display"]["Display Pixel Density"].match(/(\d+)/);
      if (ppiMatch) {
        display.ppi = parseInt(ppiMatch[1]);
      }
    }

    // Refresh rate
    if (specs?.["Display"]?.["Refresh Rate"]) {
      display.refresh_rate = specs["Display"]["Refresh Rate"];
    }

    // Calculate PPI if we have resolution and size but no PPI
    if (display.resolution && display.size_in && !display.ppi) {
      const resMatch = display.resolution.match(/(\d+)\s*x\s*(\d+)/);
      if (resMatch) {
        const width = parseInt(resMatch[1]);
        const height = parseInt(resMatch[2]);
        const diagonal = Math.sqrt(width * width + height * height);
        display.ppi = Math.round(diagonal / display.size_in);
      }
    }

    return Object.keys(display).length > 0 ? display : null;
  }

  /**
   * Extract performance specifications
   */
  extractPerformanceSpecs(specs) {
    const performance = {};

    // Operating system - new section-based format from Product Overview
    if (specs?.["Product Overview"]?.["Operating System"]) {
      performance.operating_system = specs["Product Overview"]["Operating System"];
    } else if (specs?.["Additional details"]?.["Operating System"]) {
      performance.operating_system = specs["Additional details"]["Operating System"];
    }

    // Processor brand and chipset - new section-based format
    if (specs?.["Product Overview"]?.["CPU Model"]) {
      const cpuModel = specs["Product Overview"]["CPU Model"];
      performance.processor_brand = cpuModel.split(' ')[0];
      performance.processor_chipset = cpuModel;
    }

    // CPU Speed - new section-based format
    if (specs?.["Product Overview"]?.["CPU Speed"]) {
      performance.processor_cores = specs["Product Overview"]["CPU Speed"];
    }

    return Object.keys(performance).length > 0 ? performance : null;
  }

  /**
   * Extract camera specifications
   */
  extractCameraSpecs(specs) {
    const camera = {};

    if (specs?.["Camera"]?.["Rear Facing Camera Photo Sensor Resolution"]) {
      camera.rear_setup = specs["Camera"]["Rear Facing Camera Photo Sensor Resolution"];
    }

    if (specs?.["Camera"]?.["Front Photo Sensor Resolution"]) {
      camera.front_setup = specs["Camera"]["Front Photo Sensor Resolution"];
    }

    if (specs?.["Camera"]?.["Number of Rear Facing Cameras"]) {
      camera.rear_camera_count = parseInt(specs["Camera"]["Number of Rear Facing Cameras"]);
    }

    if (specs?.["Camera"]?.["Number of Front Cameras"]) {
      camera.front_camera_count = parseInt(specs["Camera"]["Number of Front Cameras"]);
    }

    return Object.keys(camera).length > 0 ? camera : null;
  }

  /**
   * Extract battery specifications
   */
  extractBatterySpecs(specs) {
    const battery = {};

    if (specs?.["Battery"]?.["Battery Capacity"]) {
      const capacity = specs["Battery"]["Battery Capacity"];
      const capacityMatch = capacity.match(/(\d+)/);
      if (capacityMatch) {
        battery.capacity_mah = parseInt(capacityMatch[1]);
      }
    } else if (specs?.["Battery"]?.["Battery Power"]) {
      const capacity = specs["Battery"]["Battery Power"];
      const capacityMatch = capacity.match(/(\d+)/);
      if (capacityMatch) {
        battery.capacity_mah = parseInt(capacityMatch[1]);
      }
    }

    return Object.keys(battery).length > 0 ? battery : null;
  }

  /**
   * Extract connectivity specifications
   */
  extractConnectivitySpecs(specs) {
    const connectivity = {};

    if (specs?.["Connectivity"]?.["Cellular Technology"]) {
      connectivity.network_type = specs["Connectivity"]["Cellular Technology"];
    }

    if (specs?.["Additional details"]?.["SIM Card Slot Count"]) {
      connectivity.sim_type = specs["Additional details"]["SIM Card Slot Count"];
    }

    return Object.keys(connectivity).length > 0 ? connectivity : null;
  }

  /**
   * Extract design specifications
   */
  extractDesignSpecs(specs) {
    const design = {};

    if (specs?.["Measurements"]?.["Item Dimensions"]) {
      const dimensions = specs["Measurements"]["Item Dimensions"];
      const dimMatch = dimensions.match(/([\d.]+)\s*x\s*([\d.]+)\s*x\s*([\d.]+)/);
      if (dimMatch) {
        design.height_mm = parseFloat(dimMatch[1]) * 10;
        design.width_mm = parseFloat(dimMatch[2]) * 10;
        design.depth_mm = parseFloat(dimMatch[3]) * 10;
      }
    }

    if (specs?.["Measurements"]?.["Item Weight Unit of Measure"]) {
      const weight = specs["Measurements"]["Item Weight Unit of Measure"];
      const weightMatch = weight.match(/([\d.]+)/);
      if (weightMatch) {
        design.weight_g = parseFloat(weightMatch[1]);
      }
    }

    return Object.keys(design).length > 0 ? design : null;
  }

  /**
   * Get category breadcrumb
   */
  getCategoryBreadcrumb(product) {
    if (product.title && typeof product.title === 'string') {
      const title = product.title.toLowerCase();
      
      if (title.includes('iphone 16') || 
          title.includes('iphone16') || 
          title.match(/iphone\s*16/i)) {
        console.log(`📱 Detected iPhone 16 model: "${product.title.substring(0, 60)}..."`);
        return [
          "Electronics",
          "Mobiles & Accessories",
          "Smartphones & Basic Mobiles",
          "Smartphones"
        ];
      }
    }
    
    return product.categories || [];
  }

  /**
   * Extract category from breadcrumb
   */
  extractCategory(product) {
    const breadcrumb = this.getCategoryBreadcrumb(product);
    return breadcrumb[3] || null;
  }

  /**
   * Normalize products from file
   */
  async normalizeFromFile(filePath) {
    try {
      const fs = require('fs');
      const rawData = JSON.parse(fs.readFileSync(filePath, 'utf8'));

      console.log(`Normalizing ${rawData.length} Amazon products...`);
      const normalized = await this.normalizeProducts(rawData);

      console.log(`Successfully normalized ${normalized.length} products`);
      return normalized;
    } catch (error) {
      console.error(`Error reading/normalizing file: ${error.message}`);
      throw error;
    }
  }

  /**
   * Save normalized data to file
   */
  async saveNormalizedData(normalizedData, outputPath) {
    try {
      const fs = require('fs');
      fs.writeFileSync(outputPath, JSON.stringify(normalizedData, null, 2));
      console.log(`Saved normalized data to ${outputPath}`);
    } catch (error) {
      console.error(`Error saving normalized data: ${error.message}`);
      throw error;
    }
  }
}

// Main execution block for running directly - Mobile only
async function main() {
  const fs = require('fs');
  const path = require('path');
  
  try {
    console.log('🚀 Running Amazon Mobile Normalizer...\n');

    const inputPath = path.join(__dirname, '../scrapers/amazon/raw_data/amazon_mobile_scraped_data.json');
    const outputPath = path.join(__dirname, '../../parsed_data/amazon_mobile_normalized_data.json');

    // Ensure output directory exists
    const outputDir = path.join(__dirname, '../../parsed_data');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    console.log('=' .repeat(50));
    
    if (!fs.existsSync(inputPath)) {
      console.log(`⚠️  Input file not found: ${inputPath}`);
      process.exit(1);
    }

    console.log(`📂 Reading mobile data from: ${inputPath}`);
    
    const rawData = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
    console.log(`📊 Total mobile products to process: ${rawData.length}`);

    if (rawData.length === 0) {
      console.log('⚠️  No data found. Exiting...');
      process.exit(0);
    }

    const normalizer = new AmazonNormalizer();
    
    console.log(`⚡ Starting normalization with AI enhancement...\n`);
    const startTime = Date.now();
    
    const normalizedData = await normalizer.normalizeProducts(rawData);
    
    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;
    
    console.log(`\n⏱️  Processing completed in ${duration.toFixed(2)} seconds`);
    console.log(`📈 Successfully normalized ${normalizedData.length} mobile products`);

    // Save results
    fs.writeFileSync(outputPath, JSON.stringify(normalizedData, null, 2), 'utf8');
    console.log(`✅ Saved to: ${outputPath}`);

    // Statistics
    let successfulExtractions = 0;
    normalizedData.forEach(product => {
      if (product.product_identifiers?.brand && 
          product.product_identifiers?.model_name &&
          product.variant_attributes?.color &&
          product.variant_attributes?.ram !== null &&
          product.variant_attributes?.storage !== null) {
        successfulExtractions++;
      }
    });

    console.log(`\n📊 Statistics:`);
    console.log(`🎯 Complete extractions: ${successfulExtractions}/${normalizedData.length} (${((successfulExtractions/normalizedData.length)*100).toFixed(1)}%)`);
    console.log(`🚀 Processing rate: ${(normalizedData.length / duration).toFixed(2)} products/second`);
    
  } catch (error) {
    console.error('\n❌ Normalization failed:', error.message);
    process.exit(1);
  }
}

// Run directly if this file is executed
if (require.main === module) {
  main()
    .then(() => {
      console.log('\n✅ Direct execution completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Direct execution failed:', error.message);
      process.exit(1);
    });
}

module.exports = AmazonNormalizer; 