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
      
      // Calculate success/filtered stats
      let successCount = 0;
      let filteredCount = 0;
      
      for (const product of this.enhancedProducts) {
        if (product.extracted_attributes && 
            product.extracted_attributes.brand_name && 
            product.extracted_attributes.model_name) {
          successCount++;
        } else {
          filteredCount++;
        }
      }
      
      console.log(`📊 AI Enhancement Results:`);
      console.log(`   ✅ Successful: ${successCount} products (${((successCount / products.length) * 100).toFixed(1)}%)`);
      console.log(`   🔍 Filtered: ${filteredCount} products (${((filteredCount / products.length) * 100).toFixed(1)}%)`);
      
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

        // Check if product is in tablets category - filter out non-tablets
        if (!this.isTabletCategory(enhancedProduct)) {
          skippedCount++;
          continue;
        }

        // Get AI attributes
        const aiAttributes = this.getAiAttributes(enhancedProduct);

        // Check if AI marked it as not a tablet
        if (aiAttributes && aiAttributes.not_tablet === true) {
          skippedCount++;
          continue;
        }

        const normalizedProduct = this.normalizeProduct(enhancedProduct, aiAttributes);
        if (normalizedProduct) {
          normalized.push(normalizedProduct);
        }
      } catch (error) {
        skippedCount++;
      }
    }

    if (skippedCount > 0) {
      console.log(`🔍 Filtered ${skippedCount} non-tablet or invalid products (category filtering + AI filtering)`);
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
   * Normalize single Amazon tablet product to match exact format specification
   */
  normalizeProduct(product, aiAttributes) {
    // Filter out non-tablet products based on AI flag
    if (aiAttributes && aiAttributes.not_tablet === true) {
      throw new Error('Product is not a tablet - skipping');
    }

    const specs = product.specifications || {};
    const techDetails = specs['Technical Details']?.technicalDetails || {};

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
        brand: this.extractBrand(product, aiAttributes),
        model_name: this.extractModel(product, aiAttributes),
        original_title: product.title || null,
        model_number: this.extractModelNumber(product, aiAttributes)
      },

      category: this.extractCategory(product),

      variant_attributes: {
        color: this.extractColor(product, aiAttributes),
        ram: this.extractRAM(specs, techDetails, aiAttributes),
        storage: this.extractStorage(specs, techDetails, aiAttributes),
        display_size: this.extractDisplaySize(specs, techDetails, aiAttributes),
        connectivity_type: this.extractConnectivityType(specs, techDetails, aiAttributes)
      },

      listing_info: {
        price: this.extractPrice(product),
        rating: this.extractRating(product),
        image_url: this.cleanAmazonImageUrl(product.image),
        availability: product.availability || null,
      },

      key_specifications: {
        display: this.extractDisplaySpecs(specs, techDetails),
        performance: this.extractPerformanceSpecs(specs, techDetails),
        camera: this.extractCameraSpecs(specs, techDetails),
        battery: this.extractBatterySpecs(specs, techDetails),
        connectivity: this.extractConnectivitySpecs(specs, techDetails),
        design: this.extractDesignSpecs(specs, techDetails)
      },

      source_metadata: {
        category_breadcrumb: this.generateCategoryBreadcrumb(product)
      }
    };
  }

  /**
   * Clean Amazon image URL
   */
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
   * Generate category breadcrumb for tablets (same as Flipkart)
   */
  generateCategoryBreadcrumb(product) {
    return ["Electronics", "Mobiles & Accessories", "Tablets"];
  }

  /**
   * Extract category from breadcrumb
   */
  extractCategory(product) {
    // For tablet products, always return "Tablets" as the category
    return "Tablets";
  }

  /**
   * Check if product is in tablets category
   */
  isTabletCategory(product) {
    // Check if product has categories array and categories[1] is "Tablets"
    if (product.categories && Array.isArray(product.categories) && product.categories.length > 1) {
      return product.categories[1] === 'Tablets';
    }
    return false;
  }

  /**
   * Extract brand name
   */
  extractBrand(product, aiAttributes) {
    const specs = product.specifications || {};
    const techDetails = specs['Technical Details']?.technicalDetails || {};

    // Try from specifications
    if (specs.Brand) {
      return specs.Brand;
    }

    // Try from technical details
    if (techDetails.Brand) {
      return techDetails.Brand;
    }
    // Try AI first
    if (aiAttributes?.brand_name) {
      return aiAttributes.brand_name;
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
    if (!product.price) return {
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
    if (product.price.discount) {
      const discountMatch = product.price.discount.match(/-?(\d+)%/);
      if (discountMatch) {
        discountPercent = parseInt(discountMatch[1]);
      }
    }

    return {
      current: cleanPrice(product.price.current),
      original: cleanPrice(product.price.original),
      discount_percent: discountPercent,
      currency: "INR"
    };
  }

  /**
   * Extract rating information
   */
  extractRating(product) {
    if (!product.rating) return {
      score: null,
      count: null
    };

    return {
      score: product.rating.value || null,
      count: product.rating.count || null
    };
  }
  /**
   * Extract RAM
   */
  extractRAM(specs, techDetails, aiAttributes) {
    // Try AI first
    if (aiAttributes?.ram !== null && aiAttributes?.ram !== undefined) {
      return aiAttributes.ram;
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
    if (aiAttributes?.storage !== null && aiAttributes?.storage !== undefined) {
      return aiAttributes.storage;
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
    const specs = product.specifications || {};
    const techDetails = specs['Technical Details']?.technicalDetails || {};
    if (techDetails.Colour) {
      return techDetails.Colour;
    }

    return null;
  }

  /**
   * Extract connectivity type
   */
  extractConnectivityType(specs, techDetails, aiAttributes) {
    // First try AI attributes
    if (aiAttributes && aiAttributes.connectivity_type) {
      return aiAttributes.connectivity_type;
    }

    // Fallback to raw data
    if (techDetails['Connectivity Type']) {
      const connectivity = techDetails['Connectivity Type'];
      // Normalize connectivity type
      if (connectivity.toLowerCase().includes('cellular') || connectivity.toLowerCase().includes('5g') || connectivity.toLowerCase().includes('4g')) {
        return 'Wi-Fi + Cellular';
      } else if (connectivity.toLowerCase().includes('wi-fi') || connectivity.toLowerCase().includes('wifi')) {
        return 'Wi-Fi Only';
      }
      return connectivity;
    }

    return null;
  }

  /**
   * Extract display size in inches
   */
  extractDisplaySize(specs, techDetails, aiAttributes) {
    // First try AI attributes
    if (aiAttributes && aiAttributes.display_size) {
      return aiAttributes.display_size;
    }

    // Helper function to parse screen size
    const parseScreenSize = (screenSize) => {
      if (!screenSize) return null;
      
      // Extract number and unit
      const match = screenSize.match(/(\d+\.?\d*)\s*(inch|inches|cm|centimetres?)?/i);
      if (!match) return null;
      
      let size = parseFloat(match[1]);
      const unit = match[2] ? match[2].toLowerCase() : '';
      
      // Convert cm to inches if needed
      if (unit.includes('cm') || unit.includes('centimetre')) {
        size = size / 2.54;
      }
      // If no unit specified, assume inches (most common case)
      
      // Filter out unrealistic sizes (likely misclassified products)
      if (size < 6 || size > 20) {
        return null; // Skip TVs, monitors, or other non-tablet products
      }
      
      return Math.round(size * 10) / 10; // Round to 1 decimal place
    };

    // Try primary field
    if (specs['Screen Size']) {
      const result = parseScreenSize(specs['Screen Size']);
      if (result) return result;
    }

    // Try alternative field
    if (techDetails['Standing screen display size']) {
      const result = parseScreenSize(techDetails['Standing screen display size']);
      if (result) return result;
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
