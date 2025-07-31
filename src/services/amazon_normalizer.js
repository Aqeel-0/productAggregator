const { title } = require('process');

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
  }

  /**
   * Normalize array of Amazon scraped products
   */
  normalizeProducts(products) {
    const normalized = [];
    
    for (const product of products) {
      try {
        // Skip products with null or empty titles
        if (!product.title || product.title.trim() === '') {
          console.error(`Error normalizing product: Product has null or empty title - skipping`, product.title);
          continue;
        }

        const normalizedProduct = this.normalizeProduct(product);
        normalized.push(normalizedProduct);
      } catch (error) {
        console.error(`Error normalizing product: ${error.message}`, product.title);
      }
    }
    
    return normalized;
  }

  /**
   * Normalize single Amazon product to match exact format specification
   */
  normalizeProduct(product) {
    const specs = product.specifications || {};
    
    // Store current title for fallback extractions
    this.currentTitle = product.title;

    return {
      source_details: {
        source_name: "amazon",
        url: product.url || null,
        scraped_at_utc: new Date().toISOString()
      },
      
      product_identifiers: {
        brand: this.extractBrand(product),
        model_name: this.extractModelName(product),
        original_title: product.title || null,
        model_number: this.extractModelNumber(specs)
      },
      
      variant_attributes: {
        color: this.extractColor(specs),
        ram: this.extractRAM(specs),
        availability: product.availability,
        storage: this.extractStorage(specs)
      },
      
      listing_info: {
        price: this.normalizePrice(product.price),
        rating: this.normalizeRating(product.rating),
        image_url: product.image || null
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

  /**
   * Extract brand from product data
   */
  extractBrand(product) {
    // First check title for Apple products specifically
    if (product.title && product.title.toLowerCase().includes('apple')) {
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
   * Extract model name from product data
   */
  extractModelName(product) {
    const {brand, model} = this.extractBrandAndModelName(product.productName);
    return model;
  }

  extractBrandAndModelName(fullProductName) {
    // Remove trailing suffixes like "Mobile Phone Information", "Smartphone Mobile Phone Information", "AI Smartphone", etc.
    const suffixPattern = /\s*(Mobile Phone Information|Smartphone Mobile Phone Information|Mobile Phone|AI Smartphone|AI|Smartphone|Phone Information|Mobile).*$/i;
    const cleanedName = fullProductName.replace(suffixPattern, '').trim();
  
    // Split by spaces assuming first word is brand
    const parts = cleanedName.split(/\s+/, 2);
  
    let brand = '';
    let model = '';
  
    if (parts.length === 1) {
      brand = parts[0];
      model = '';
    } else {
      brand = parts[0];
      model = parts[1];
    }
  
    // To get the model including everything after the brand (except suffixes),
    // we take substring after first space to include multi-word models.
    if (cleanedName.indexOf(' ') !== -1) {
      model = cleanedName.substring(cleanedName.indexOf(' ') + 1).trim();
    } else {
      model = '';
    }
  
    // Remove anything after a comma in the model to exclude colors or extras
    if (model.includes(',')) {
      model = model.split(',')[0].trim();
    }
  
    return { brand, model };
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
   * Extract color from specifications or title
   */
  extractColor(specs) {
    // Try specifications first
    if (specs?.["Technical Details"]?.technicalDetails?.["Colour"]) {
      return specs["Technical Details"].technicalDetails["Colour"];
    }
    
    if (specs?.["Colour"]) {
      return specs["Colour"];
    }

    // Try to extract from title
    if (this.currentTitle) {
      const colorMatch = this.currentTitle.match(/\(([^,)]+),/);
      if (colorMatch) {
        return colorMatch[1].trim();
      }
    }

    return null;
  }


  extractRAM(specs) {
    let ramValue = null;

    // Try multiple paths for RAM
    if (specs?.["RAM Memory Installed Size"]) {
      const ramMatch = specs["RAM Memory Installed Size"].match(/(\d+)\s*GB/i);
      if (ramMatch) {
        ramValue = parseInt(ramMatch[1]);
      }
    } else if (specs?.["Technical Details"]?.technicalDetails?.["RAM"]) {
      const ramMatch = specs["Technical Details"].technicalDetails["RAM"].match(/(\d+)\s*GB/i);
      if (ramMatch) {
        ramValue = parseInt(ramMatch[1]);
      }
    } else if (specs?.["RAM"]) {
      const ramMatch = specs["RAM"].match(/(\d+)\s*GB/i);
      if (ramMatch) {
        ramValue = parseInt(ramMatch[1]);
      }
    }

    // Fallback to title extraction
    if (!ramValue && this.currentTitle) {
      const titleRamMatch = this.currentTitle.match(/(\d+)\s*GB\s*RAM/i);
      if (titleRamMatch) {
        ramValue = parseInt(titleRamMatch[1]);
      }
    }

    return ramValue ? ramValue : null;
  }

  /**
   * Extract storage from specifications or title
   */
  extractStorage(specs) {
    let storageValue = null;

    // Try specifications first
    if (specs?.["Product Details"]?.productDetails?.["memory capacity"]) {
      const storageMatch = specs["Product Details"].productDetails["memory capacity"].match(/(\d+)\s*GB/i);
      if (storageMatch) {
        return parseInt(storageMatch[1]);
      }
    } else if (specs?.["Memory Storage Capacity"]) {
      const storageMatch = specs["Memory Storage Capacity"].match(/(\d+)\s*GB/i);
      if (storageMatch) {
        return parseInt(storageMatch[1]);
      }
    }
    
    if (this.currentTitle) {
      const cleanTitle = this.currentTitle.toLowerCase();
      
      // Common mobile phone storage capacities
      const storageValues = ['32', '64', '128', '256', '512', '1024', '1', '2'];
      
      // Look for these specific values followed by GB/TB
      for (const value of storageValues) {
        let pattern;
        
        if (value === '1' || value === '2') {
          // For TB values
          pattern = new RegExp(`\\b${value}\\s*tb\\b`, 'i');
          const match = cleanTitle.match(pattern);
          if (match) {
            return parseInt(value);
          }
        } else {
          // For GB values
          pattern = new RegExp(`\\b${value}\\s*gb\\b`, 'i');
          const match = cleanTitle.match(pattern);
          if (match && !cleanTitle.match(new RegExp(`${value}\\s*gb\\s*ram`, 'i'))) {
            // Found storage value, but make sure it's not RAM
            return  parseInt(value);
          }
        }
      }
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
   * Standardize brand names
   */
  standardizeBrand(brand) {
    const brandMappings = {
      'samsung': 'Samsung',
      'iqoo': 'iQOO',
      'apple': 'Apple',
      'xiaomi': 'Xiaomi',
      'oneplus': 'OnePlus',
      'realme': 'Realme',
      'oppo': 'Oppo',
      'vivo': 'Vivo',
      'motorola': 'Motorola',
      'nokia': 'Nokia',
      'nothing': 'Nothing',
      'poco': 'Poco',
      'tecno': 'Tecno',
      'infinix': 'Infinix',
      'honor': 'Honor',
      'huawei': 'Huawei',
      'google': 'Google'
    };
    
    return brandMappings[brand.toLowerCase()] || brand;
  }

  /**
   * Fallback: Extract brand from title
   */
  extractBrandFromTitle(title) {
    if (!title) return null;

    const brandPatterns = [
      { brand: 'Samsung', patterns: ['samsung', 'galaxy'] },
      { brand: 'Apple', patterns: ['apple', 'iphone'] },
      { brand: 'Google', patterns: ['google', 'pixel'] },
      { brand: 'OnePlus', patterns: ['oneplus', 'one plus'] },
      { brand: 'Xiaomi', patterns: ['xiaomi', 'mi', 'redmi'] },
      { brand: 'Realme', patterns: ['realme'] },
      { brand: 'Oppo', patterns: ['oppo'] },
      { brand: 'Vivo', patterns: ['vivo'] },
      { brand: 'Motorola', patterns: ['motorola', 'moto'] },
      { brand: 'Nokia', patterns: ['nokia'] },
      { brand: 'Nothing', patterns: ['nothing', 'cmf'] },
      { brand: 'Poco', patterns: ['poco'] },
      { brand: 'Tecno', patterns: ['tecno'] },
      { brand: 'Infinix', patterns: ['infinix'] },
      { brand: 'Honor', patterns: ['honor'] },
      { brand: 'Huawei', patterns: ['huawei'] },
      { brand: 'iQOO', patterns: ['iqoo'] }
    ];

    const titleLower = title.toLowerCase();
    
    for (const brandInfo of brandPatterns) {
      for (const pattern of brandInfo.patterns) {
        if (titleLower.includes(pattern)) {
          return brandInfo.brand;
        }
      }
    }
    
    return null;
  }

  /**
   * Normalize products from file
   */
  async normalizeFromFile(filePath) {
    try {
      const fs = require('fs');
      const rawData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      
      console.log(`Normalizing ${rawData.length} Amazon products...`);
      const normalized = this.normalizeProducts(rawData);
      
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

module.exports = AmazonNormalizer; 

// Main execution block - run when file is executed directly
if (require.main === module) {
  const path = require('path');
  
  async function main() {
    try {
      console.log('🚀 Starting Amazon Normalizer...\n');
      
      // Initialize normalizer
      const normalizer = new AmazonNormalizer();
      
      // Define input and output paths
      const inputPath = path.join(__dirname, '../scrapers/amazon/amazon_scraped_data.json');
      const outputPath = path.join(__dirname, '../../parsed_data/amazon_normalized_data.json');
      
      console.log(`📁 Input file: ${inputPath}`);
      console.log(`📁 Output file: ${outputPath}\n`);
      
      // Check if input file exists
      const fs = require('fs');
      if (!fs.existsSync(inputPath)) {
        console.error(`❌ Input file not found: ${inputPath}`);
        console.log('💡 Please run the Amazon crawler first to generate scraped data.');
        process.exit(1);
      }
      
      // Normalize the data
      const normalizedData = await normalizer.normalizeFromFile(inputPath);
      
      // Save normalized data
      await normalizer.saveNormalizedData(normalizedData, outputPath);
      
      console.log('\n✅ Amazon normalization completed successfully!');
      console.log(`📊 Normalized ${normalizedData.length} products`);
      
    } catch (error) {
      console.error('\n❌ Normalization failed:', error.message);
      process.exit(1);
    }
  }
  
  // Run the main function
  main();
} 