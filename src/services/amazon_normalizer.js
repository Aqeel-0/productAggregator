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
  }

  /**
   * Normalize array of Amazon scraped products
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
   * Normalize single Amazon product
   */
  normalizeProduct(product) {
    // Extract brand and model from existing data
    const { brand, model } = this.extractBrandAndModel(product);
    
    // Extract variant attributes from existing specification fields
    const variant = this.extractVariantAttributes(product);
    
    // Extract essential specifications only
    const specifications = this.extractEssentialSpecs(product.specifications);
    
    // Normalize price from Amazon data
    const price = this.normalizePrice(product.price);
    
    // Normalize rating from Amazon data
    const rating = this.normalizeRating(product.rating);

    // Normalize category
    const category = this.normalizeCategory(product);

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
      source: 'amazon',
      url: product.url,
      image: product.image || null,
      
      // Original data (for debugging)
      originalTitle: product.title
    };
  }

  /**
   * Extract brand and model from existing specification data and title
   */
  extractBrandAndModel(product) {
    // Get brand directly from specifications (Amazon has this field)
    const brand = product.specifications?.["Brand"] || 
                  this.extractBrandFromTitle(product.title) || 
                  'Unknown';
    
    // Get model from Item model number or extract from title
    let model = product.specifications?.["Item model number"] || 'Unknown';
    
    // If model is just a code, try to extract from title
    if (model === 'Unknown' || this.isModelCode(model)) {
      model = this.extractModelFromTitle(product.title, brand) || model;
    }

    return { 
      brand: this.standardizeBrand(brand), 
      model: model 
    };
  }

  /**
   * Check if a model string looks like a model code (e.g., "SM-M055F", "I2404")
   */
  isModelCode(model) {
    if (!model || model === 'Unknown') return false;
    // Model codes are usually short with letters, numbers, and dashes
    return model.length <= 10 && /^[A-Z0-9\-]+$/i.test(model);
  }

  /**
   * Extract model name from title
   */
  extractModelFromTitle(title, brand) {
    if (!title || !brand) return null;
    
    // Remove brand from title and extract meaningful model name
    let modelText = title.replace(new RegExp(brand, 'gi'), '').trim();
    
    // Remove variant info and extract first few words as model
    modelText = modelText
      .replace(/\(.*?\)/g, '') // Remove parentheses content
      .replace(/\|.*$/, '') // Remove everything after |
      .replace(/\b\d+\s*GB\s*(RAM|Storage)\b/gi, '') // Remove RAM/Storage info
      .replace(/\b\d+\s*GB\b/g, '') // Remove GB references
      .replace(/\b(Black|White|Blue|Red|Green|Silver|Gold|Gray|Grey|Rose|Pink|Purple|Yellow|Orange|Titanium|Mint|Ultramarine|Glacial)\b/gi, '') // Remove colors
      .replace(/[-,]/g, ' ') // Replace separators
      .replace(/\s+/g, ' ') // Clean spaces
      .trim();

    // Take first 3-4 meaningful words
    const words = modelText.split(' ').filter(word => 
      word.length > 1 && 
      !word.match(/^\d+$/) && // Not just numbers
      word.length < 15 // Not too long
    );
    
    return words.slice(0, 3).join(' ').trim() || null;
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
   * Extract variant attributes from existing specification fields
   */
  extractVariantAttributes(product) {
    const attributes = {};
    const specs = product.specifications || {};

    // Extract RAM from multiple possible fields
    const ramField = specs['RAM Memory Installed Size'] || specs['RAM'];
    if (ramField) {
      // Convert "4 GB" or "6 GB" -> 4, 6
      const ramMatch = ramField.match(/(\d+)\s*GB/i);
      if (ramMatch) {
        attributes.ram_gb = parseInt(ramMatch[1]);
      }
    }

    // Extract Storage from title or technical details
    const storageField = specs['Memory Storage Capacity'];
    if (storageField) {
      // Convert "128 GB" -> 128
      const storageMatch = storageField.match(/(\d+)\s*GB/i);
      if (storageMatch) {
        attributes.storage_gb = parseInt(storageMatch[1]);
      }
    } else {
      // Try to extract from title as fallback
      const title = product.title || '';
      const titleStorageMatch = title.match(/(\d+)\s*GB\s*Storage/i);
      if (titleStorageMatch) {
        attributes.storage_gb = parseInt(titleStorageMatch[1]);
      }
    }

    // Extract Color from Colour field or title
    const colorField = specs['Colour'];
    if (colorField) {
      attributes.color = colorField;
    } else {
      // Try to extract from title
      const title = product.title || '';
      const colorMatch = title.match(/\(([^,)]+),/);
      if (colorMatch) {
        attributes.color = colorMatch[1].trim();
      }
    }

    return attributes;
  }

  /**
   * Create category structure for Amazon using real breadcrumb data
   */
  normalizeCategory(product) {
    const categories = product.categories || [];
    const brand = product.specifications?.["Brand"] || 'Unknown';
    
    if (categories.length === 0) {
      // Fallback to synthetic categories if no breadcrumb data
      const genericName = product.specifications?.["Generic Name"] || 'Unknown';
      return {
        main: 'Electronics',
        sub: genericName,
        specific: `${brand} ${genericName}`,
        brand: this.standardizeBrand(brand),
        breadcrumb: ['Electronics', genericName, `${brand} ${genericName}`],
        full_path: `Electronics > ${genericName} > ${brand} ${genericName}`
      };
    }
    
    // Use real Amazon breadcrumb categories
    return {
      main: categories[0] || 'Electronics',                    // First breadcrumb level
      sub: categories[1] || 'Unknown',                         // Second breadcrumb level  
      specific: categories[2] || `${brand} Products`,          // Third breadcrumb level
      brand: this.standardizeBrand(brand),
      breadcrumb: categories.slice(0, -1),                     // Exclude last item (usually product name)
      full_path: categories.join(' > ')                        // Complete Amazon breadcrumb path
    };
  }

  /**
   * Extract only essential specifications
   */
  extractEssentialSpecs(specifications) {
    if (!specifications) return {};

    const essential = {};

    // General info (keep minimal)
    const general = {};
    
    // Extract model number from Technical Details (nested structure)
    if (specifications["Technical Details"]?.technicalDetails?.["Item model number"]) {
      general.model_number = specifications["Technical Details"].technicalDetails["Item model number"];
    } else if (specifications['Item model number']) {
      general.model_number = specifications['Item model number'];
    }
    
    if (specifications['Operating System']) {
      general.operating_system = specifications['Operating System'];
    }
    if (specifications['Special features']) {
      general.special_features = specifications['Special features'];
    }
    if (Object.keys(general).length > 0) {
      essential.general = general;
    }

    // Display
    const display = {};
    if (specifications["Technical Details"]?.technicalDetails?.["Resolution"]) {
      display.resolution = specifications["Technical Details"].technicalDetails["Resolution"];
    } else if (specifications['Resolution']) {
      display.resolution = specifications['Resolution'];
    }
    if (specifications["Technical Details"]?.technicalDetails?.["Device interface - primary"]) {
      display.interface = specifications["Technical Details"].technicalDetails["Device interface - primary"];
    } else if (specifications['Device interface - primary']) {
      display.interface = specifications['Device interface - primary'];
    }
    if (Object.keys(display).length > 0) {
      essential.display = display;
    }

    // Processor
    const processor = {};
    if (specifications['CPU Model']) {
      processor.chipset = specifications['CPU Model'];
    }
    if (specifications['CPU Speed']) {
      processor.speed = specifications['CPU Speed'];
    }
    if (Object.keys(processor).length > 0) {
      essential.processor = processor;
    }

    // Battery
    const battery = {};
    if (specifications["Technical Details"]?.technicalDetails?.["Battery Power Rating"]) {
      battery.capacity = specifications["Technical Details"].technicalDetails["Battery Power Rating"] + ' mAh';
    } else if (specifications['Battery Power Rating']) {
      battery.capacity = specifications['Battery Power Rating'] + ' mAh';
    }
    if (Object.keys(battery).length > 0) {
      essential.battery = battery;
    }

    // Connectivity
    const connectivity = {};
    if (specifications["Technical Details"]?.technicalDetails?.["Connectivity technologies"]) {
      connectivity.technologies = specifications["Technical Details"].technicalDetails["Connectivity technologies"];
    } else if (specifications['Connectivity technologies']) {
      connectivity.technologies = specifications['Connectivity technologies'];
    }
    if (specifications["Technical Details"]?.technicalDetails?.["Wireless communication technologies"]) {
      connectivity.wireless = specifications["Technical Details"].technicalDetails["Wireless communication technologies"];
    } else if (specifications['Wireless communication technologies']) {
      connectivity.wireless = specifications['Wireless communication technologies'];
    }
    if (specifications["Technical Details"]?.technicalDetails?.["GPS"]) {
      connectivity.gps = specifications["Technical Details"].technicalDetails["GPS"];
    } else if (specifications['GPS']) {
      connectivity.gps = specifications['GPS'];
    }
    if (Object.keys(connectivity).length > 0) {
      essential.connectivity = connectivity;
    }

    return essential;
  }

  /**
   * Normalize price data
   */
  normalizePrice(price) {
    if (!price) return {
      current: null,
      original: null,
      discount: null,
      currency: 'INR'
    };

    // Clean price strings and convert to numbers
    const cleanPrice = (priceStr) => {
      if (!priceStr) return null;
      const cleaned = priceStr.replace(/[₹,]/g, '').trim();
      const match = cleaned.match(/(\d+)/);
      return match ? parseInt(match[1]) : null;
    };

    return {
      current: cleanPrice(price.current),
      original: cleanPrice(price.original),
      discount: price.discount || null,
      currency: 'INR'
    };
  }

  /**
   * Normalize rating data
   */
  normalizeRating(rating) {
    if (!rating) return {
      score: null,
      count: 0
    };

    return {
      score: rating.value || null,
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