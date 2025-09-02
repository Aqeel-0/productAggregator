const fs = require('fs');
const path = require('path');
const AmazonAiEnhancer = require('./amazonAiEnhancer');

// Try to import logger, fall back to console if not available
let logger;
try {
  logger = require('../utils/logger');
} catch (e) {
  logger = console;
}

class AmazonTabletNormalizer {
  constructor() {
    this.logger = logger;
    this.currentTitle = null; // Store current title for fallback extractions
    this.aiEnhancer = new AmazonAiEnhancer();
    this.enhancedProducts = []; // Store AI-enhanced products directly
  }

  /**
   * Normalize array of Amazon tablet scraped products
   */
  async normalizeProducts(products) {
    console.log('\n🤖 Starting AI Enhancement for Amazon tablet products...');
    console.log(`📊 Processing ${products.length} products with AI enhancer first`);

    // Step 1: Enhance all products with AI first
    try {
      this.enhancedProducts = await this.aiEnhancer.enhanceAmazonData(products, 'tablet');
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
    let skippedCount = 0;

    for (const enhancedProduct of this.enhancedProducts) {
      try {
        // Skip products with null or empty titles
        if (!enhancedProduct || !enhancedProduct.title || typeof enhancedProduct.title !== 'string' || enhancedProduct.title.trim() === '') {
          skippedCount++;
          continue;
        }

        // Skip non-tablet products
        if (!this.isTablet(enhancedProduct)) {
          skippedCount++;
          continue;
        }

        const normalizedProduct = this.normalizeProduct(enhancedProduct);
        if (normalizedProduct) {
          normalized.push(normalizedProduct);
        }
      } catch (error) {
        skippedCount++;
      }
    }

    if (skippedCount > 0) {
      console.log(`⚠️  Skipped ${skippedCount} non-tablet or invalid products`);
    }

    return normalized;
  }

  /**
   * Check if product is a tablet
   */
  isTablet(product) {
    // Check categories
    if (product.categories && Array.isArray(product.categories)) {
      const categoryString = product.categories.join(' ').toLowerCase();
      if (categoryString.includes('tablet')) {
        return true;
      }
    }

    // Check title
    if (product.title && product.title.toLowerCase().includes('tablet')) {
      return true;
    }

    // Check if it's clearly a phone or laptop
    if (product.title) {
      const titleLower = product.title.toLowerCase();
      if (titleLower.includes('smartphone') || titleLower.includes('mobile') || 
          titleLower.includes('laptop') || titleLower.includes('notebook')) {
        return false;
      }
    }

    return false;
  }

  /**
   * Get AI-enhanced attributes directly from the enhanced product
   */
  getAiAttributes(enhancedProduct) {
    return enhancedProduct.extracted_attributes || null;
  }

  /**
   * Normalize single Amazon tablet product to match exact format specification
   */
  normalizeProduct(product) {
    const specs = product.specifications || {};
    const techDetails = specs['Technical Details']?.technicalDetails || {};
    const aiAttributes = this.getAiAttributes(product);

    // Store current title for fallback extractions
    this.currentTitle = product.title;
    this.currentProduct = product;

    return {
      source_details: {
        source_name: "amazon",
        url: product.url || null,
        scraped_at_utc: product.extractedAt || '2025-08-22T18:55:33.449Z'
      },

      product_identifiers: {
        brand_name: this.extractBrand(product, aiAttributes),
        model_name: this.extractModel(product, aiAttributes),
        model_number: this.extractModelNumber(product, aiAttributes),
        category_breadcrumb: this.generateCategoryBreadcrumb(product)
      },

      product_details: {
        title: product.title || null,
        description: this.extractDescription(product),
        price: this.extractPrice(product),
        availability: product.availability || null,
        rating: this.extractRating(product),
        image_url: product.image || null,
        image_urls: this.extractImageUrls(product)
      },

      key_specifications: {
        display: this.extractDisplaySpecs(specs, techDetails),
        performance: this.extractPerformanceSpecs(specs, techDetails),
        camera: this.extractCameraSpecs(specs, techDetails),
        battery: this.extractBatterySpecs(specs, techDetails),
        connectivity: this.extractConnectivitySpecs(specs, techDetails),
        design: this.extractDesignSpecs(specs, techDetails),
        storage: this.extractStorageSpecs(specs, techDetails),
        multimedia: this.extractMultimediaSpecs(specs, techDetails)
      },

      variant_attributes: {
        ram_gb: this.extractRAM(specs, techDetails, aiAttributes),
        storage_gb: this.extractStorage(specs, techDetails, aiAttributes),
        color: this.extractColor(product, aiAttributes),
        connectivity_type: this.extractConnectivityType(specs, techDetails)
      }
    };
  }

  /**
   * Generate category breadcrumb for tablets (same as Flipkart)
   */
  generateCategoryBreadcrumb(product) {
    return ["Electronics", "Mobiles & Accessories", "Tablets"];
  }

  /**
   * Extract brand name
   */
  extractBrand(product, aiAttributes) {
    const specs = product.specifications || {};
    const techDetails = specs['Technical Details']?.technicalDetails || {};

    // Try AI first
    if (aiAttributes?.brand_name) {
      return aiAttributes.brand_name;
    }

    // Try from specifications
    if (specs.Brand) {
      return specs.Brand;
    }

    // Try from technical details
    if (techDetails.Brand) {
      return techDetails.Brand;
    }

    // Fallback to title extraction
    const title = product.title || '';
    const brandKeywords = ['samsung', 'apple', 'oneplus', 'xiaomi', 'huawei', 'lenovo', 'dell', 'hp', 'asus', 'acer', 'microsoft', 'amazon'];
    
    for (const brand of brandKeywords) {
      if (title.toLowerCase().includes(brand)) {
        return brand.charAt(0).toUpperCase() + brand.slice(1);
      }
    }

    return null;
  }

  /**
   * Extract model name
   */
  extractModel(product, aiAttributes) {
    const specs = product.specifications || {};
    const techDetails = specs['Technical Details']?.technicalDetails || {};

    // Try AI first
    if (aiAttributes?.model_name) {
      return aiAttributes.model_name;
    }

    // Try from specifications
    if (specs['Model Name']) {
      return specs['Model Name'];
    }

    // Try from technical details
    if (techDetails.Series) {
      return techDetails.Series;
    }

    return null;
  }

  /**
   * Extract model number
   */
  extractModelNumber(product, aiAttributes) {
    const specs = product.specifications || {};
    const techDetails = specs['Technical Details']?.technicalDetails || {};

    // Try AI first
    if (aiAttributes?.model_number) {
      return aiAttributes.model_number;
    }

    // Try from technical details
    if (techDetails['Item model number']) {
      return techDetails['Item model number'];
    }

    return null;
  }

  /**
   * Extract description
   */
  extractDescription(product) {
    return product.productName || null;
  }

  /**
   * Extract price information
   */
  extractPrice(product) {
    if (!product.price) return null;

    return {
      current: product.price.current ? parseFloat(product.price.current.replace(/[₹,]/g, '')) : null,
      original: product.price.original ? parseFloat(product.price.original.replace(/[₹,]/g, '')) : null,
      discount_percentage: product.price.discount ? parseFloat(product.price.discount.replace(/[%-]/g, '')) : null
    };
  }

  /**
   * Extract rating information
   */
  extractRating(product) {
    if (!product.rating) return null;

    return {
      value: product.rating.value || null,
      count: product.rating.count || null
    };
  }

  /**
   * Extract image URLs
   */
  extractImageUrls(product) {
    const images = [];
    if (product.image) {
      images.push(product.image);
    }
    return images.length > 0 ? images : null;
  }

  /**
   * Extract RAM
   */
  extractRAM(specs, techDetails, aiAttributes) {
    // Try AI first
    if (aiAttributes?.ram_gb) {
      return aiAttributes.ram_gb;
    }

    // Try from technical details
    if (techDetails['RAM Size']) {
      const match = techDetails['RAM Size'].match(/(\d+)\s*GB/i);
      if (match) {
        return parseInt(match[1]);
      }
    }

    // Fallback to title
    if (this.currentTitle) {
      const match = this.currentTitle.match(/(\d+)\s*GB\s*RAM/i);
      if (match) {
        return parseInt(match[1]);
      }
    }

    return null;
  }

  /**
   * Extract storage
   */
  extractStorage(specs, techDetails, aiAttributes) {
    // Try AI first
    if (aiAttributes?.storage_gb) {
      return aiAttributes.storage_gb;
    }

    // Try from specifications
    if (specs['Memory Storage Capacity']) {
      const match = specs['Memory Storage Capacity'].match(/(\d+)\s*GB/i);
      if (match) {
        return parseInt(match[1]);
      }
    }

    // Fallback to title
    if (this.currentTitle) {
      const match = this.currentTitle.match(/(\d+)\s*GB\s*(?:Storage|ROM)/i);
      if (match) {
        return parseInt(match[1]);
      }
    }

    return null;
  }

  /**
   * Extract color
   */
  extractColor(product, aiAttributes) {
    // Try AI first
    if (aiAttributes?.color) {
      return aiAttributes.color;
    }

    // Try from technical details
    if (techDetails.Colour) {
      return techDetails.Colour;
    }

    return null;
  }

  /**
   * Extract connectivity type
   */
  extractConnectivityType(specs, techDetails) {
    if (techDetails['Connectivity Type']) {
      return techDetails['Connectivity Type'];
    }

    return null;
  }

  /**
   * Extract display specifications
   */
  extractDisplaySpecs(specs, techDetails) {
    const display = {};

    // Screen size
    if (specs['Screen Size']) {
      display.size = specs['Screen Size'];
    } else if (techDetails['Standing screen display size']) {
      display.size = techDetails['Standing screen display size'];
    }

    // Resolution
    if (specs['Display Resolution Maximum']) {
      display.resolution = specs['Display Resolution Maximum'];
    } else if (techDetails.Resolution) {
      display.resolution = techDetails.Resolution;
    } else if (techDetails['Screen Resolution']) {
      display.resolution = techDetails['Screen Resolution'];
    }

    return Object.keys(display).length > 0 ? display : null;
  }

  /**
   * Extract performance specifications
   */
  extractPerformanceSpecs(specs, techDetails) {
    const performance = {};

    // Processor
    if (techDetails['Processor Brand']) {
      performance.processor_brand = techDetails['Processor Brand'];
    }

    if (techDetails['Processor Speed']) {
      performance.processor_speed = techDetails['Processor Speed'];
    }

    if (techDetails['Processor Count']) {
      performance.processor_cores = techDetails['Processor Count'];
    }

    // Operating System
    if (techDetails['Operating System']) {
      performance.os = techDetails['Operating System'];
    }

    // Graphics
    if (techDetails['Graphics Chipset Brand']) {
      performance.graphics_brand = techDetails['Graphics Chipset Brand'];
    }

    if (techDetails['Graphics Card Description']) {
      performance.graphics_type = techDetails['Graphics Card Description'];
    }

    return Object.keys(performance).length > 0 ? performance : null;
  }

  /**
   * Extract camera specifications
   */
  extractCameraSpecs(specs, techDetails) {
    const camera = {};

    // Front camera
    if (techDetails['Front Webcam Resolution']) {
      camera.front = techDetails['Front Webcam Resolution'];
    }

    return Object.keys(camera).length > 0 ? camera : null;
  }

  /**
   * Extract battery specifications
   */
  extractBatterySpecs(specs, techDetails) {
    const battery = {};

    // Battery life
    if (techDetails['Average Battery Life (in hours)']) {
      battery.life_hours = techDetails['Average Battery Life (in hours)'];
    }

    // Battery capacity
    if (techDetails['Lithium Battery Energy Content']) {
      battery.capacity = techDetails['Lithium Battery Energy Content'];
    }

    // Battery weight
    if (techDetails['Lithium Battery Weight']) {
      battery.weight = techDetails['Lithium Battery Weight'];
    }

    return Object.keys(battery).length > 0 ? battery : null;
  }

  /**
   * Extract connectivity specifications
   */
  extractConnectivitySpecs(specs, techDetails) {
    const connectivity = {};

    // Connectivity type
    if (techDetails['Connectivity Type']) {
      connectivity.type = techDetails['Connectivity Type'];
    }

    // Wireless type
    if (techDetails['Wireless Type']) {
      connectivity.wireless = techDetails['Wireless Type'];
    }

    return Object.keys(connectivity).length > 0 ? connectivity : null;
  }

  /**
   * Extract design specifications
   */
  extractDesignSpecs(specs, techDetails) {
    const design = {};

    // Weight
    if (techDetails['Item Weight']) {
      design.weight = techDetails['Item Weight'];
    }

    // Dimensions
    if (techDetails['Product Dimensions']) {
      design.dimensions = techDetails['Product Dimensions'];
    }

    // Package dimensions
    if (techDetails['Package Dimensions']) {
      design.package_dimensions = techDetails['Package Dimensions'];
    }

    return Object.keys(design).length > 0 ? design : null;
  }

  /**
   * Extract storage specifications
   */
  extractStorageSpecs(specs, techDetails) {
    const storage = {};

    // Memory storage capacity
    if (specs['Memory Storage Capacity']) {
      storage.capacity = specs['Memory Storage Capacity'];
    }

    return Object.keys(storage).length > 0 ? storage : null;
  }

  /**
   * Extract multimedia specifications
   */
  extractMultimediaSpecs(specs, techDetails) {
    const multimedia = {};

    // Speakers
    if (techDetails['Speaker Description']) {
      multimedia.speakers = techDetails['Speaker Description'];
    }

    // Included components
    if (techDetails['Included Components']) {
      multimedia.included_components = techDetails['Included Components'];
    }

    return Object.keys(multimedia).length > 0 ? multimedia : null;
  }
}

// Main execution
if (require.main === module) {
  async function main() {
    const normalizer = new AmazonTabletNormalizer();
    
    try {
      // Read raw data
      const rawDataPath = path.join(__dirname, '../scrapers/amazon/raw_data/amazon_tablet_scraped_data.json');
      const rawData = JSON.parse(fs.readFileSync(rawDataPath, 'utf8'));
      
      console.log(`📊 Processing ${rawData.length} Amazon tablet products...`);
      
      // Normalize products
      const normalizedProducts = await normalizer.normalizeProducts(rawData);
      
      // Ensure output directory exists
      const outputDir = path.join(__dirname, '../../parsed_data');
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      
      // Save normalized data
      const outputPath = path.join(outputDir, 'amazon_tablet_normalized_data.json');
      fs.writeFileSync(outputPath, JSON.stringify(normalizedProducts, null, 2));
      
      console.log(`\n✅ Amazon tablet normalization completed!`);
      console.log(`📊 Results:`);
      console.log(`   📦 Total products processed: ${rawData.length}`);
      console.log(`   ✅ Successfully normalized: ${normalizedProducts.length}`);
      console.log(`   📁 Output saved to: ${outputPath}`);
      
    } catch (error) {
      console.error('❌ Error:', error.message);
      process.exit(1);
    }
  }
  
  main();
}

module.exports = AmazonTabletNormalizer;
