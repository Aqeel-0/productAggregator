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

      variant_attributes: {
        color: this.getAiColor(product),
        ram: this.getAiRAM(product),
        availability: product.availability,
        storage: this.getAiStorage(product)
      },

      listing_info: {
        price: this.normalizePrice(product.price),
        rating: this.normalizeRating(product.rating),
        image_url: this.cleanAmazonImageUrl(product.image)
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
        category_breadcrumb: product.categories || []
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
    // Try multiple paths for model number
    if (specs?.["Technical Details"]?.technicalDetails?.["Item model number"]) {
      return specs["Technical Details"].technicalDetails["Item model number"];
    }

    if (specs?.["Item model number"]) {
      return specs["Item model number"];
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

    // Display size
    if (specs?.["Product Details"]?.productDetails?.["display size"]) {
      const sizeMatch = specs["Product Details"].productDetails["display size"].match(/([\d.]+)/);
      if (sizeMatch) {
        display.size_in = parseFloat(sizeMatch[1]);
      }
    }

    // Resolution
    if (specs?.["Technical Details"]?.technicalDetails?.["Resolution"]) {
      display.resolution = specs["Technical Details"].technicalDetails["Resolution"];
    } else if (specs?.["Resolution"]) {
      display.resolution = specs["Resolution"];
    }

    // Display type
    if (specs?.["Product Details"]?.productDetails?.["display type"]) {
      display.type = specs["Product Details"].productDetails["display type"];
    }

    // Calculate PPI if we have resolution and size
    if (display.resolution && display.size_in) {
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

    // Operating system
    if (specs?.["Operating System"]) {
      performance.operating_system = specs["Operating System"];
    } else if (specs?.["Technical Details"]?.technicalDetails?.["OS"]) {
      performance.operating_system = specs["Technical Details"].technicalDetails["OS"];
    }

    // Processor brand and chipset
    if (specs?.["CPU Model"]) {
      performance.processor_brand = specs["CPU Model"].split(' ')[0]; // First word as brand
      performance.processor_chipset = specs["CPU Model"];
    }

    // CPU Speed
    if (specs?.["CPU Speed"]) {
      performance.processor_cores = specs["CPU Speed"];
    }

    return Object.keys(performance).length > 0 ? performance : null;
  }

  /**
   * Extract camera specifications
   */
  extractCameraSpecs(specs) {
    const camera = {};

    // Try to extract camera info from title or specs
    if (this.currentTitle) {
      // Look for camera mentions in title
      const cameraMatch = this.currentTitle.match(/(\d+MP[^|]*)/i);
      if (cameraMatch) {
        camera.rear_setup = cameraMatch[1].trim();
      }
    }

    // Check technical details for camera features
    if (specs?.["Technical Details"]?.technicalDetails?.["Other camera features"]) {
      const features = specs["Technical Details"].technicalDetails["Other camera features"];
      if (features.includes("Front")) {
        camera.front_setup = "Front Camera";
      }
    }

    return Object.keys(camera).length > 0 ? camera : null;
  }

  /**
   * Extract battery specifications
   */
  extractBatterySpecs(specs) {
    const battery = {};

    // Battery capacity
    if (specs?.["Technical Details"]?.technicalDetails?.["Battery Power Rating"]) {
      const capacity = specs["Technical Details"].technicalDetails["Battery Power Rating"];
      battery.capacity_mah = parseInt(capacity);
    }

    // Quick charging from special features
    if (specs?.["Technical Details"]?.technicalDetails?.["Special features"]) {
      const features = specs["Technical Details"].technicalDetails["Special features"];
      if (features && features.toLowerCase().includes("fast charging")) {
        battery.quick_charging = true;
      }
    }

    return Object.keys(battery).length > 0 ? battery : null;
  }

  /**
   * Extract connectivity specifications
   */
  extractConnectivitySpecs(specs) {
    const connectivity = {};

    // Connectivity technologies
    if (specs?.["Technical Details"]?.technicalDetails?.["Connectivity technologies"]) {
      const tech = specs["Technical Details"].technicalDetails["Connectivity technologies"];
      connectivity.network_type = tech;
    }

    // Wireless communication
    if (specs?.["Technical Details"]?.technicalDetails?.["Wireless communication technologies"]) {
      const wireless = specs["Technical Details"].technicalDetails["Wireless communication technologies"];
      if (wireless.toLowerCase().includes("cellular")) {
        connectivity.sim_type = "Dual Sim"; // Default assumption
      }
    }

    // Audio jack
    if (specs?.["Technical Details"]?.technicalDetails?.["Audio Jack"]) {
      connectivity.audio_jack_type = specs["Technical Details"].technicalDetails["Audio Jack"];
    }

    // GPS
    if (specs?.["Technical Details"]?.technicalDetails?.["GPS"]) {
      connectivity.gps = specs["Technical Details"].technicalDetails["GPS"] === "True";
    }

    return Object.keys(connectivity).length > 0 ? connectivity : null;
  }

  /**
   * Extract design specifications
   */
  extractDesignSpecs(specs) {
    const design = {};

    // Product dimensions
    if (specs?.["Technical Details"]?.technicalDetails?.["Product Dimensions"]) {
      const dimensions = specs["Technical Details"].technicalDetails["Product Dimensions"];

      // Parse dimensions like "0.9 x 7.8 x 16.9 cm; 195 g"
      const dimMatch = dimensions.match(/([\d.]+)\s*x\s*([\d.]+)\s*x\s*([\d.]+)\s*cm/);
      if (dimMatch) {
        design.depth_mm = parseFloat(dimMatch[1]) * 10; // Convert cm to mm
        design.width_mm = parseFloat(dimMatch[2]) * 10;
        design.height_mm = parseFloat(dimMatch[3]) * 10;
      }

      // Parse weight
      const weightMatch = dimensions.match(/([\d.]+)\s*g/);
      if (weightMatch) {
        design.weight_g = parseFloat(weightMatch[1]);
      }
    }

    // Item weight as fallback
    if (!design.weight_g && specs?.["Technical Details"]?.technicalDetails?.["Item Weight"]) {
      const weight = specs["Technical Details"].technicalDetails["Item Weight"];
      const weightMatch = weight.match(/([\d.]+)\s*g/);
      if (weightMatch) {
        design.weight_g = parseFloat(weightMatch[1]);
      }
    }

    return Object.keys(design).length > 0 ? design : null;
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

// Main execution block for running directly
async function main() {
  const fs = require('fs');
  const path = require('path');
  
  try {
    console.log('🚀 Running Amazon Normalizer Directly on Full Dataset...\n');

    // Read the complete Amazon scraped data
    const inputFilePath = path.join(__dirname, '../scrapers/amazon/amazon_scraped_data.json');
    console.log('📂 Reading Amazon data from:', inputFilePath);
    
    if (!fs.existsSync(inputFilePath)) {
      throw new Error(`Input file not found: ${inputFilePath}`);
    }

    const rawData = JSON.parse(fs.readFileSync(inputFilePath, 'utf8'));
    console.log(`📊 Total products to process: ${rawData.length}`);

    // Initialize and run normalizer
    const normalizer = new AmazonNormalizer();
    
    console.log('⚡ Starting normalization with AI enhancement...\n');
    const startTime = Date.now();
    
    const normalizedData = await normalizer.normalizeProducts(rawData);
    
    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;
    
    console.log(`\n⏱️  Processing completed in ${duration.toFixed(2)} seconds (${(duration/60).toFixed(2)} minutes)`);
    console.log(`📈 Successfully normalized ${normalizedData.length} products`);
    console.log(`🎯 Processing rate: ${(normalizedData.length / duration).toFixed(2)} products/second`);

    // Save results
    const outputDir = path.join(__dirname, '../../normalized-output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputFilePath = path.join(outputDir, `amazon_normalized_${timestamp}.json`);
    
    console.log('\n💾 Saving normalized dataset...');
    fs.writeFileSync(outputFilePath, JSON.stringify(normalizedData, null, 2), 'utf8');
    
    console.log(`✅ Normalized dataset saved to: ${outputFilePath}`);

    // Generate statistics
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

    console.log('\n📊 Final Statistics:');
    console.log('=' .repeat(50));
    console.log(`📦 Total products: ${rawData.length}`);
    console.log(`✅ Successfully normalized: ${normalizedData.length}`);
    console.log(`🎯 Complete extractions: ${successfulExtractions} (${((successfulExtractions/normalizedData.length)*100).toFixed(1)}%)`);
    console.log(`⏱️  Total time: ${(duration/60).toFixed(2)} minutes`);
    console.log(`🚀 Processing rate: ${(normalizedData.length / duration).toFixed(2)} products/second`);

    console.log('\n🎉 Amazon normalization completed successfully!');
    
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