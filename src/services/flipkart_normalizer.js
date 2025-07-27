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
   * Normalize single Flipkart product
   */
  normalizeProduct(product) {
    // Extract brand and model from existing data
    const { brand, model } = this.extractBrandAndModel(product);
    
    // Extract variant attributes from existing specification fields
    const variant = this.extractVariantAttributes(product);
    
    // Extract essential specifications only
    const specifications = this.extractEssentialSpecs(product.specifications);
    
    // Normalize price
    const price = this.normalizePrice(product.price);
    
    // Normalize rating
    const rating = this.normalizeRating(product.rating);

    // Normalize category
    const category = this.normalizeCategory(product.category);

    return {
      // Core product identification
      brand: brand,
      model: model,
      title: product.title,
      
      // Variant attributes (used for matching same products)
      variant: {
        ram_gb: variant.ram_gb,
        storage_gb: variant.storage_gb,
        color: variant.color
      },
      
      // Product categorization
      category: category,
      
      // Essential specifications only
      specifications: specifications,
      
      // Pricing and rating
      price: price,
      rating: rating,
      
      // Metadata
      source: 'flipkart',
      url: product.url,
      image: product.image || null,
      
      // Original data (for debugging)
      originalTitle: product.title
    };
  }

  /**
   * Extract brand and model from existing specification data
   */
  extractBrandAndModel(product) {
    // Get model name directly from specifications
    const modelName = product.specifications?.General?.["Model Name"] || 'Unknown';
    
    // Extract brand from category or title
    let brand = this.extractBrandFromCategory(product.category) || 
                this.extractBrandFromTitle(product.title) || 
                'Unknown';

    return { 
      brand: brand, 
      model: modelName 
    };
  }

  /**
   * Extract brand from category array
   */
  extractBrandFromCategory(category) {
    if (!category || !Array.isArray(category)) return null;
    
    // Look for brand-specific category (usually 4th element)
    // Format: ["Home", "Mobiles & Accessories", "Mobiles", "Tecno Mobiles", "..."]
    const brandCategory = category[3];
    if (!brandCategory) return null;
    
    // Remove " Mobiles" suffix to get brand name
    const brand = brandCategory.replace(/\s+Mobiles?$/i, '').trim();
    
    // Handle special cases
    const brandMappings = {
      'MOTOROLA': 'Motorola',
      'realme': 'Realme',
      'POCO': 'Poco',
      'Tecno': 'Tecno',
      'Google': 'Google',
      'Xiaomi': 'Xiaomi',
      'Nothing': 'Nothing',
      'Samsung': 'Samsung'
    };
    
    return brandMappings[brand] || brand || null;
  }

  /**
   * Fallback: Extract brand from title (simplified version)
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
      { brand: 'Huawei', patterns: ['huawei'] }
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
   * Extract variant attributes from existing specification fields
   */
  extractVariantAttributes(product) {
    const attributes = {};
    const specs = product.specifications || {};

    // Extract RAM directly from Memory & Storage Features
    const ramSpec = specs['Memory & Storage Features']?.['RAM'];
    if (ramSpec) {
      // Convert "8 GB" -> 8
      const ramMatch = ramSpec.match(/(\d+)\s*GB/i);
      if (ramMatch) {
        attributes.ram_gb = parseInt(ramMatch[1]);
      }
    }

    // Extract Storage directly from Memory & Storage Features
    const storageSpec = specs['Memory & Storage Features']?.['Internal Storage'];
    if (storageSpec) {
      // Convert "128 GB" -> 128
      const storageMatch = storageSpec.match(/(\d+)\s*GB/i);
      if (storageMatch) {
        attributes.storage_gb = parseInt(storageMatch[1]);
      }
    }

    // Extract Color directly from General specifications
    const colorSpec = specs.General?.['Color'];
    if (colorSpec) {
      attributes.color = colorSpec;
    }

    return attributes;
  }

  /**
   * Normalize category array into structured format
   */
  normalizeCategory(category) {
    if (!category || !Array.isArray(category)) {
      return {
        main: 'Unknown',
        sub: 'Unknown',
        specific: 'Unknown',
        brand: 'Unknown',
        breadcrumb: []
      };
    }

    return {
      main: category[1] || 'Unknown',        // "Mobiles & Accessories"
      sub: category[2] || 'Unknown',         // "Mobiles"
      specific: category[3] || 'Unknown',    // "Tecno Mobiles"
      brand: this.extractBrandFromCategory(category) || 'Unknown',
      breadcrumb: category.slice(1, -1),     // Exclude "Home" and last product-specific item
      full_path: category.join(' > ')        // Complete path for reference
    };
  }

  /**
   * Extract only essential specifications
   */
  extractEssentialSpecs(specifications) {
    if (!specifications) return {};

    const essential = {};

    // General info (keep minimal)
    if (specifications.General) {
      const general = {};
      if (specifications.General['Model Number']) {
        general.model_number = specifications.General['Model Number'];
      }
      if (specifications.General['SIM Type']) {
        general.sim_type = specifications.General['SIM Type'];
      }
      if (specifications.General['Quick Charging']) {
        general.quick_charging = specifications.General['Quick Charging'];
      }
      if (Object.keys(general).length > 0) {
        essential.general = general;
      }
    }

    // Display (essential only)
    if (specifications['Display Features']) {
      const display = {};
      if (specifications['Display Features']['Display Size']) {
        display.size = specifications['Display Features']['Display Size'];
      }
      if (specifications['Display Features']['Resolution']) {
        display.resolution = specifications['Display Features']['Resolution'];
      }
      if (Object.keys(display).length > 0) {
        essential.display = display;
      }
    }

    // Processor (essential only)
    if (specifications['Os & Processor Features']) {
      const processor = {};
      if (specifications['Os & Processor Features']['Operating System']) {
        processor.os = specifications['Os & Processor Features']['Operating System'];
      }
      if (specifications['Os & Processor Features']['Processor Type']) {
        processor.chipset = specifications['Os & Processor Features']['Processor Type'];
      }
      if (specifications['Os & Processor Features']['Processor Core']) {
        processor.cores = specifications['Os & Processor Features']['Processor Core'];
      }
      if (Object.keys(processor).length > 0) {
        essential.processor = processor;
      }
    }

    // Camera (essential only)
    if (specifications['Camera Features']) {
      const camera = {};
      if (specifications['Camera Features']['Primary Camera']) {
        camera.rear = specifications['Camera Features']['Primary Camera'];
      }
      if (specifications['Camera Features']['Secondary Camera']) {
        camera.front = specifications['Camera Features']['Secondary Camera'];
      }
      if (Object.keys(camera).length > 0) {
        essential.camera = camera;
      }
    }

    // Battery (essential only)
    if (specifications['Battery & Power Features']) {
      const battery = {};
      if (specifications['Battery & Power Features']['Battery Capacity']) {
        battery.capacity = specifications['Battery & Power Features']['Battery Capacity'];
      }
      if (Object.keys(battery).length > 0) {
        essential.battery = battery;
      }
    }

    // Connectivity (essential only)
    if (specifications['Connectivity Features']) {
      const connectivity = {};
      if (specifications['Connectivity Features']['Network Type']) {
        connectivity.network = specifications['Connectivity Features']['Network Type'];
      }
      if (specifications['Connectivity Features']['Supported Networks']) {
        connectivity.supported_networks = specifications['Connectivity Features']['Supported Networks'];
      }
      if (Object.keys(connectivity).length > 0) {
        essential.connectivity = connectivity;
      }
    }

    return essential;
  }

  /**
   * Normalize price data
   */
  normalizePrice(price) {
    if (!price) return null;

    return {
      current: price.current || null,
      original: price.original || null,
      discount: price.discount || null,
      currency: 'INR'
    };
  }

  /**
   * Normalize rating data
   */
  normalizeRating(rating) {
    if (!rating) return null;

    return {
      score: rating.score || null,
      count: rating.count || 0
    };
  }

  /**
   * Normalize products from file
   */
  async normalizeFromFile(filePath) {
    try {
      const fs = require('fs');
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
      const fs = require('fs');
      fs.writeFileSync(outputPath, JSON.stringify(normalizedData, null, 2));
      console.log(`Saved normalized data to ${outputPath}`);
    } catch (error) {
      console.error(`Error saving normalized data: ${error.message}`);
      throw error;
    }
  }
}

module.exports = FlipkartNormalizer; 