const fs = require('fs');
const path = require('path');

// Try to import logger, fall back to console if not available
let logger;
try {
  logger = require('../utils/logger');
} catch (e) {
  logger = console;
}

class FlipkartNormalizer {
  constructor() {
    this.logger = logger;
  }

  /**
   * Normalize array of Flipkart scraped products
   */
  normalizeProducts(products) {
    const normalized = [];
    
    for (const product of products) {
      try {
        const normalizedProduct = this.normalizeProduct(product);
        normalized.push(normalizedProduct);
      } catch (error) {
        console.error(`Error normalizing product: ${error.message}`, product.title);
      }
    }
    
    return normalized;
  }

  /**
   * Normalize single Flipkart product to exact output format
   */
  normalizeProduct(product) {
    // Skip products with null or empty title (corrupted data)
    if (!product.title || product.title.trim() === '') {
      throw new Error('Product has null or empty title - skipping');
    }
    
    const specs = product.specifications || {};
    
    // Store current title for fallback extractions
    this.currentTitle = product.title;
    
    return {
      source_details: {
        source_name: "flipkart",
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
        category_breadcrumb: this.enhanceCategoryBreadcrumb(product.category, product.price)
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
    
    // First try from category
    if (product.category && Array.isArray(product.category) && product.category[3]) {
      const brandCategory = product.category[3];
      const brand = brandCategory.replace(/\s+Mobiles?$/i, '').trim();
      
      const brandMappings = {
        'Samsung': 'Samsung',
        'realme': 'Realme', 
        'POCO': 'POCO',
        'Tecno': 'Tecno',
        'Google': 'Google',
        'Xiaomi': 'Xiaomi',
        'Nothing': 'Nothing',
        'OnePlus': 'OnePlus',
        'OPPO': 'OPPO',
        'vivo': 'Vivo',
        'Motorola': 'Motorola',
        'Infinix': 'Infinix',
        'IQOO': 'IQOO',
        'Apple': 'Apple',
        'Micromax': 'Micromax',
        'LAVA': 'LAVA',
        'Kechaoda': 'Kechaoda'
      };
      
      if (brandMappings[brand]) {
        return brandMappings[brand];
      }
    }
    
    // Fallback to title extraction
    if (product.title) {
      const title = product.title.toLowerCase();
      if (title.includes('samsung')) return 'Samsung';
      if (title.includes('apple') || title.includes('iphone')) return 'Apple';
      if (title.includes('realme')) return 'Realme';
      if (title.includes('poco')) return 'POCO';
      if (title.includes('tecno')) return 'Tecno';
      if (title.includes('google') || title.includes('pixel')) return 'Google';
      if (title.includes('xiaomi') || title.includes('redmi')) return 'Xiaomi';
      if (title.includes('nothing')) return 'Nothing';
      if (title.includes('oneplus')) return 'OnePlus';
      if (title.includes('oppo')) return 'OPPO';
      if (title.includes('vivo')) return 'Vivo';
      if (title.includes('motorola') || title.includes('moto')) return 'Motorola';
      if (title.includes('infinix')) return 'Infinix';
      if (title.includes('iqoo')) return 'IQOO';
      if (title.includes('micromax')) return 'Micromax';
      if (title.includes('lava')) return 'LAVA';
      if (title.includes('kechaoda')) return 'Kechaoda';
    }
    
    return null;
  }

  /**
   * Extract model name from specifications or title
   */
  extractModelName(product) {
    const specs = product.specifications || {};
    
    // First try from specifications
    if (specs.General && specs.General['Model Name']) {
      return specs.General['Model Name'];
    }
    
    // Try from Series in Other Details
    if (specs['Other Details'] && specs['Other Details']['Series']) {
      return specs['Other Details']['Series'];
    }
    
    // Fallback to extract from title
    if (product.title) {
      // Remove brand name and extract model
      const title = product.title;
      const brandPatterns = ['Samsung', 'realme', 'POCO', 'Tecno', 'Google', 'Xiaomi', 'Nothing', 'OnePlus', 'OPPO', 'vivo', 'Motorola', 'Infinix', 'IQOO'];
      
      for (const brand of brandPatterns) {
        if (title.toLowerCase().includes(brand.toLowerCase())) {
          // Extract everything after brand until first parenthesis
          const afterBrand = title.substring(title.toLowerCase().indexOf(brand.toLowerCase()) + brand.length).trim();
          const match = afterBrand.match(/^([^(]+)/);
          if (match) {
            return match[1].trim();
          }
        }
      }
    }
    
    return null;
  }

  /**
   * Extract model number from specifications
   */
  extractModelNumber(specs) {
    if (specs.General && specs.General['Model Number']) {
      return specs.General['Model Number'];
    }
    return null;
  }

  /**
   * Extract color from specifications
   */
  extractColor(specs) {
    if (specs.General && specs.General['Color']) {
      return specs.General['Color'];
    }
    return null;
  }

  /**
   * Extract RAM information
   */
  extractRAM(specs) {
    // First try from Memory & Storage Features
    if (specs['Memory & Storage Features'] && specs['Memory & Storage Features']['RAM']) {
      const ramStr = specs['Memory & Storage Features']['RAM'];
      const match = ramStr.match(/(\d+)\s*GB/i);
      if (match) {
        return parseInt(match[1]);
      }
    }
    
    // Fallback: try to extract from title
    if (this.currentTitle) {
      // Pattern 1: "Product Name (8 GB RAM)" or "Product Name  (8 GB RAM)"
      let titleMatch = this.currentTitle.match(/\(\s*(\d+)\s*GB\s+RAM\s*\)/i);
      if (titleMatch) {
        return parseInt(titleMatch[1]);
      }
      // // Pattern 2: For Apple products like "Apple iPhone 16 (Teal, 256 GB)" 
      // // Default to common iPhone RAM values based on storage
      // if (this.currentTitle.toLowerCase().includes('iphone')) {
      //   const storageMatch = this.currentTitle.match(/,\s*(\d+)\s*GB\s*\)/i);
      //   if (storageMatch) {
      //     const storage = parseInt(storageMatch[1]);
      //     // Common iPhone RAM patterns
      //     if (storage >= 256) return { value: 8 }; // Higher storage usually means more RAM
      //     if (storage >= 128) return { value: 6 }; // Standard RAM
      //     return { value: 4 }; // Base model
      //   }
      // }
    }
    
    return null;
  }

  /**
   * Extract storage information
   */
  extractStorage(specs) {
    // First try from Memory & Storage Features
    if (specs['Memory & Storage Features'] && specs['Memory & Storage Features']['Internal Storage']) {
      const storageStr = specs['Memory & Storage Features']['Internal Storage'];
      const match = storageStr.match(/(\d+)\s*GB/i);
      if (match) {
        return parseInt(match[1]);
      }
    }
    
    // Fallback: try to extract from title (common pattern is "Product Name (Color, 128 GB)")
    if (this.currentTitle) {
      const titleMatch = this.currentTitle.match(/,\s*(\d+)\s*GB\s*\)/i);
      if (titleMatch) {
        return parseInt(titleMatch[1]);
      }
    }
    
    return null;
  }

  /**
   * Normalize price data
   */
  normalizePrice(price) {
    if (!price) {
      return {
        current: null,
        original: null,
        discount_percent: null,
        currency: "INR"
      };
    }

    let discountPercent = null;
    if (price.discount && typeof price.discount === 'string') {
      const match = price.discount.match(/(\d+)%/);
      if (match) {
        discountPercent = parseInt(match[1]);
      }
    }

    return {
      current: price.current || null,
      original: price.original || null,
      discount_percent: discountPercent,
      currency: "INR"
    };
  }

  /**
   * Normalize rating data
   */
  normalizeRating(rating) {
    if (!rating) {
      return {
        score: null,
        count: null
      };
    }

    return {
      score: rating.score || null,
      count: rating.count || null
    };
  }

  /**
   * Extract display specifications
   */
  extractDisplaySpecs(specs) {
    const display = {};
    
    if (specs['Display Features']) {
      const displayFeatures = specs['Display Features'];
      
      // Extract size
      if (displayFeatures['Display Size']) {
        const sizeStr = displayFeatures['Display Size'];
        const match = sizeStr.match(/([\d.]+)\s*inch/i);
        if (match) {
          display.size_in = parseFloat(match[1]);
        }
      }
      
      // Extract resolution
      if (displayFeatures['Resolution']) {
        display.resolution = displayFeatures['Resolution'];
      }
      
      // Extract display type
      if (displayFeatures['Display Type']) {
        display.type = displayFeatures['Display Type'];
      }
      
      // Extract PPI
      if (specs['Other Details'] && specs['Other Details']['Graphics PPI']) {
        const ppiStr = specs['Other Details']['Graphics PPI'];
        const match = ppiStr.match(/(\d+)\s*PPI/i);
        if (match) {
          display.ppi = parseInt(match[1]);
        }
      }
    }
    
    return Object.keys(display).length > 0 ? display : null;
  }

  /**
   * Extract performance specifications
   */
  extractPerformanceSpecs(specs) {
    const performance = {};
    
    if (specs['Os & Processor Features']) {
      const procFeatures = specs['Os & Processor Features'];
      
      // Operating System
      if (procFeatures['Operating System']) {
        performance.operating_system = procFeatures['Operating System'];
      }
      
      // Processor Brand
      if (procFeatures['Processor Brand']) {
        performance.processor_brand = procFeatures['Processor Brand'];
      }
      
      // Processor Type/Chipset
      if (procFeatures['Processor Type']) {
        performance.processor_chipset = procFeatures['Processor Type'];
      }
      
      // Processor Cores
      if (procFeatures['Processor Core']) {
        performance.processor_cores = procFeatures['Processor Core'];
      }
    }
    
    return Object.keys(performance).length > 0 ? performance : null;
  }

  /**
   * Extract camera specifications
   */
  extractCameraSpecs(specs) {
    const camera = {};
    
    if (specs['Camera Features']) {
      const cameraFeatures = specs['Camera Features'];
      
      // Rear camera
      if (cameraFeatures['Primary Camera']) {
        camera.rear_setup = cameraFeatures['Primary Camera'];
      }
      
      // Front camera
      if (cameraFeatures['Secondary Camera']) {
        camera.front_setup = cameraFeatures['Secondary Camera'];
      }
      
      // Video resolution
      if (cameraFeatures['Video Recording Resolution']) {
        camera.video_resolution = cameraFeatures['Video Recording Resolution'];
      }
    }
    
    return Object.keys(camera).length > 0 ? camera : null;
  }

  /**
   * Extract battery specifications
   */
  extractBatterySpecs(specs) {
    const battery = {};
    
    if (specs['Battery & Power Features']) {
      const batteryFeatures = specs['Battery & Power Features'];
      
      // Battery capacity
      if (batteryFeatures['Battery Capacity']) {
        const capacityStr = batteryFeatures['Battery Capacity'];
        const match = capacityStr.match(/(\d+)\s*mAh/i);
        if (match) {
          battery.capacity_mah = parseInt(match[1]);
        }
      }
    }
    
    // Quick charging from General specs
    if (specs.General && specs.General['Quick Charging']) {
      battery.quick_charging = specs.General['Quick Charging'] === 'Yes';
    }
    
    return Object.keys(battery).length > 0 ? battery : null;
  }

  /**
   * Extract connectivity specifications
   */
  extractConnectivitySpecs(specs) {
    const connectivity = {};
    
    if (specs['Connectivity Features']) {
      const connFeatures = specs['Connectivity Features'];
      
      // Network type
      if (connFeatures['Network Type']) {
        connectivity.network_type = connFeatures['Network Type'];
      }
      
      // NFC
      if (connFeatures['NFC']) {
        connectivity.nfc = connFeatures['NFC'] === 'Yes';
      }
      
      // Audio jack type
      if (connFeatures['Audio Jack']) {
        connectivity.audio_jack_type = connFeatures['Audio Jack'];
      }
    }
    
    // SIM type from General specs
    if (specs.General && specs.General['SIM Type']) {
      connectivity.sim_type = specs.General['SIM Type'];
    }
    
    return Object.keys(connectivity).length > 0 ? connectivity : null;
  }

  /**
   * Extract design specifications
   */
  extractDesignSpecs(specs) {
    const design = {};
    
    if (specs['Dimensions']) {
      const dimensions = specs['Dimensions'];
      
      // Width
      if (dimensions['Width']) {
        const widthStr = dimensions['Width'];
        const match = widthStr.match(/([\d.]+)\s*mm/i);
        if (match) {
          design.width_mm = parseFloat(match[1]);
        }
      }
      
      // Height
      if (dimensions['Height']) {
        const heightStr = dimensions['Height'];
        const match = heightStr.match(/([\d.]+)\s*mm/i);
        if (match) {
          design.height_mm = parseFloat(match[1]);
        }
      }
      
      // Depth
      if (dimensions['Depth']) {
        const depthStr = dimensions['Depth'];
        const match = depthStr.match(/([\d.]+)\s*mm/i);
        if (match) {
          design.depth_mm = parseFloat(match[1]);
        }
      }
      
      // Weight
      if (dimensions['Weight']) {
        const weightStr = dimensions['Weight'];
        const match = weightStr.match(/([\d.]+)\s*g/i);
        if (match) {
          design.weight_g = parseFloat(match[1]);
        }
      }
    }
    
    return Object.keys(design).length > 0 ? design : null;
  }

  /**
   * Enhance category breadcrumb with device type based on price
   */
  enhanceCategoryBreadcrumb(category, price) {
    if (!category || !Array.isArray(category)) {
      return [];
    }

    // Create enhanced category array
    let enhancedCategory = [...category];
    
    // Find the "Mobiles" entry in the breadcrumb and add device type after it
    const mobilesIndex = enhancedCategory.findIndex(item => 
      item && item.toLowerCase().includes('mobiles')
    );
    
    if (mobilesIndex !== -1 && price && price.current) {
      const priceValue = parseFloat(price.current);
      
      if (!isNaN(priceValue)) {
        // Add device classification based on price threshold of ₹3000
        const deviceType = priceValue < 3000 ? 'Basic Mobile' : 'Smartphone';
        
        // Insert the device type right after "Mobiles"
        enhancedCategory.splice(mobilesIndex + 1, 0, deviceType);
      }
    }
    
    return enhancedCategory;
  }

  /**
   * Normalize products from file
   */
  async normalizeFromFile(filePath) {
    try {
      const rawData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      
      console.log(`Normalizing ${rawData.length} Flipkart products...`);
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
      // Ensure output directory exists
      const outputDir = path.dirname(outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      
      fs.writeFileSync(outputPath, JSON.stringify(normalizedData, null, 2));
      console.log(`Saved normalized data to ${outputPath}`);
    } catch (error) {
      console.error(`Error saving normalized data: ${error.message}`);
      throw error;
    }
  }
}

module.exports = FlipkartNormalizer;

// Main execution block - run when file is executed directly
if (require.main === module) {
  async function main() {
    try {
      console.log('🚀 Starting Flipkart Normalizer...\n');
      
      // Initialize normalizer
      const normalizer = new FlipkartNormalizer();
      
      // Define input and output paths
      const inputPath = path.join(__dirname, '../scrapers/flipkart/flipkart_scraped_data_rate_limited.json');
      const outputPath = path.join(__dirname, '../../parsed_data/flipkart_normalized_data.json');
      
      console.log(`📁 Input file: ${inputPath}`);
      console.log(`📁 Output file: ${outputPath}\n`);
      
      // Check if input file exists
      if (!fs.existsSync(inputPath)) {
        console.error(`❌ Input file not found: ${inputPath}`);
        console.log('💡 Please run the Flipkart crawler first to generate scraped data.');
        process.exit(1);
      }
      
      // Normalize the data
      const normalizedData = await normalizer.normalizeFromFile(inputPath);
      
      // Save normalized data
      await normalizer.saveNormalizedData(normalizedData, outputPath);
      
      console.log('\n✅ Flipkart normalization completed successfully!');
      console.log(`📊 Normalized ${normalizedData.length} products`);
      
    } catch (error) {
      console.error('\n❌ Normalization failed:', error.message);
      process.exit(1);
    }
  }
  
  // Run the main function
  main();
} 