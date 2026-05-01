/**
 * Flipkart Mouse Data Normalizer
 * Extracts model names, model numbers, and brand names from Flipkart mouse product data
 */

const fs = require('fs');
const path = require('path');

class FlipkartMouseNormalizer {
  /**
   * Normalize Flipkart mouse product data
   * @param {Object} product - Raw product data from Flipkart scraper
   * @returns {Object} Normalized product data
   */
  static normalize(product) {
    // Extract brand, model name, and model number
    const brandInfo = this.extractBrandInfo(product);
    const modelInfo = this.extractModelInfo(product);
    
    // Combine all normalized data
    return {
      // Basic product information
      url: product.url,
      title: product.title,
      
      // Extracted information
      brand: brandInfo.brand,
      modelName: modelInfo.modelName,
      modelNumber: modelInfo.modelNumber,
      
      // Pricing information
      price: product.price?.current,
      originalPrice: product.price?.original,
      discount: product.price?.discount,
      
      // Rating information
      rating: product.rating?.score,
      ratingCount: product.rating?.count,
      
      // Availability
      availability: product.availability,
      
      // Specifications (organized by category)
      specifications: this.organizeSpecifications(product.specifications),
      
      // Categories
      categories: this.extractCategories(product.category),
      
      // Images
      mainImage: product.image,
      images: product.images || [],
      
      // Timestamp
      normalizedAt: new Date().toISOString()
    };
  }
  
  /**
   * Extract brand information from product data
   * @param {Object} product - Raw product data
   * @returns {Object} Brand information
   */
  static extractBrandInfo(product) {
    // Try to extract brand from title first
    const titleBrand = this.extractBrandFromTitle(product.title);
    
    // Try to extract brand from category if not found in title
    const categoryBrand = this.extractBrandFromCategory(product.category);
    
    // Return the first found brand
    const brand = titleBrand || categoryBrand || 'Unknown';
    
    return {
      brand: brand
    };
  }
  
  /**
   * Extract brand name from product title
   * @param {string} title - Product title
   * @returns {string|null} Brand name or null if not found
   */
  static extractBrandFromTitle(title) {
    if (!title) return null;
    
    // Common brand names/patterns
    const brandPatterns = [
      'Razer', 'Logitech', 'Apple', 'HP', 'Dell', 'Microsoft', 'Corsair', 
      'SteelSeries', 'HyperX', 'Redragon', 'Asus', 'Lenovo', 'Acer', 
      'Samsung', 'Sony', 'JBL', 'Bose', 'Philips', 'Panasonic'
    ];
    
    // Check for exact matches first
    for (const brand of brandPatterns) {
      const regex = new RegExp(`\\b${brand}\\b`, 'i');
      if (regex.test(title)) {
        return brand;
      }
    }
    
    // If no exact match, try to extract first word as potential brand
    // (This is risky but sometimes works)
    const firstWord = title.split(' ')[0];
    if (firstWord && firstWord.length > 1) {
      // Check if it looks like a brand name (capitalized)
      if (firstWord.charAt(0) === firstWord.charAt(0).toUpperCase()) {
        return firstWord;
      }
    }
    
    return null;
  }
  
  /**
   * Extract brand name from category information
   * @param {Array} categories - Array of category strings
   * @returns {string|null} Brand name or null if not found
   */
  static extractBrandFromCategory(categories) {
    if (!Array.isArray(categories) || categories.length === 0) return null;
    
    // Look for category entries that contain "Brand" or end with "Mouse"
    for (const category of categories) {
      if (typeof category === 'string') {
        // Pattern: "Brand Mouse" or "Brand Product Name"
        const brandMousePattern = /^([A-Za-z]+)\s+(?:Mouse|Gaming Mouse)/;
        const match = category.match(brandMousePattern);
        if (match) {
          return match[1];
        }
        
        // Pattern: "Brand Product Name" where Brand is a known brand
        const brandPatterns = [
          'Razer', 'Logitech', 'Apple', 'HP', 'Dell', 'Microsoft', 'Corsair', 
          'SteelSeries', 'HyperX', 'Redragon', 'Asus', 'Lenovo', 'Acer', 
          'Samsung', 'Sony', 'JBL', 'Bose', 'Philips', 'Panasonic'
        ];
        
        for (const brand of brandPatterns) {
          if (category.includes(brand)) {
            return brand;
          }
        }
      }
    }
    
    return null;
  }
  
  /**
   * Extract model information from product data
   * @param {Object} product - Raw product data
   * @returns {Object} Model information
   */
  static extractModelInfo(product) {
    // First try to get model info from specifications
    const specModelInfo = this.extractModelFromSpecifications(product.specifications);
    if (specModelInfo.modelName || specModelInfo.modelNumber) {
      return specModelInfo;
    }
    
    // If not found in specifications, try to extract from title
    const titleModelInfo = this.extractModelFromTitle(product.title);
    return titleModelInfo;
  }
  
  /**
   * Extract model name and model number from specifications
   * @param {Object} specifications - Product specifications
   * @returns {Object} Model information
   */
  static extractModelFromSpecifications(specifications) {
    if (!specifications || typeof specifications !== 'object') {
      return { modelName: null, modelNumber: null };
    }
    
    let modelName = null;
    let modelNumber = null;
    
    // Look in the "General" category first
    if (specifications.General && typeof specifications.General === 'object') {
      const generalSpecs = specifications.General;
      
      // Look for common model name fields
      const modelNameFields = ['Model Name', 'Model', 'Product Name', 'Name'];
      for (const field of modelNameFields) {
        if (generalSpecs[field]) {
          modelName = generalSpecs[field];
          break;
        }
      }
      
      // Look for common model number fields
      const modelNumberFields = ['Model Number', 'Part Number', 'Product Number', 'Item Number'];
      for (const field of modelNumberFields) {
        if (generalSpecs[field]) {
          modelNumber = generalSpecs[field];
          break;
        }
      }
    }
    
    // If not found in General, look in all categories
    if (!modelName || !modelNumber) {
      for (const category in specifications) {
        if (typeof specifications[category] === 'object') {
          const categorySpecs = specifications[category];
          
          // Look for model name fields
          if (!modelName) {
            const modelNameFields = ['Model Name', 'Model', 'Product Name', 'Name'];
            for (const field of modelNameFields) {
              if (categorySpecs[field]) {
                modelName = categorySpecs[field];
                break;
              }
            }
          }
          
          // Look for model number fields
          if (!modelNumber) {
            const modelNumberFields = ['Model Number', 'Part Number', 'Product Number', 'Item Number'];
            for (const field of modelNumberFields) {
              if (categorySpecs[field]) {
                modelNumber = categorySpecs[field];
                break;
              }
            }
          }
          
          // If we found both, we can stop
          if (modelName && modelNumber) {
            break;
          }
        }
      }
    }
    
    // If we have a model name but no model number, try to extract model number from model name
    if (modelName && !modelNumber) {
      modelNumber = this.extractModelNumberFromString(modelName);
    }
    
    // If we have a model name that is very long and contains the model number,
    // we might want to simplify the model name
    if (modelName && modelNumber && modelName !== modelNumber) {
      // Check if model name contains model number
      if (modelName.includes(modelNumber)) {
        // If model name is significantly longer than model number, use model number as primary
        if (modelName.length > modelNumber.length * 2) {
          modelName = modelNumber; // Use the cleaner model number as model name
        }
      }
    }
    
    // If we have a model name from specifications that is very long and contains a model number pattern,
    // try to extract just the model number part
    if (modelName && !modelNumber) {
      const extractedModelNumber = this.extractModelNumberFromString(modelName);
      if (extractedModelNumber && modelName.length > extractedModelNumber.length * 2) {
        modelName = extractedModelNumber; // Use the cleaner model number as model name
      }
    }
    
    // If we have a model number but it's the same as model name, we don't need to clear either
    // Both can coexist as they provide the same information
    
    return {
      modelName: modelName,
      modelNumber: modelNumber
    };
  }
  
  /**
   * Extract model number from a string using patterns
   * @param {string} str - String to extract model number from
   * @returns {string|null} Model number or null if not found
   */
  static extractModelNumberFromString(str) {
    if (!str) return null;
    
    // Common patterns for model numbers:
    // - Alphanumeric with dashes (e.g., RZ01-04620200-R3A1)
    // - Alphanumeric with slashes (e.g., MMMQ3HN/A)
    // - Simple alphanumeric model numbers (e.g., MX518)
    
    const modelNumberPatterns = [
      // Pattern: Alphanumeric with dashes (e.g., RZ01-04620200-R3A1)
      /\b[A-Z0-9]+-[A-Z0-9-]+\b/i,
      // Pattern: Alphanumeric with slashes (e.g., MMMQ3HN/A)
      /\b[A-Z0-9]+\/[A-Z0-9]+\b/i,
      // Pattern: Simple alphanumeric model numbers (e.g., MX518)
      /\b[A-Z]{1,3}[0-9][A-Z0-9]*\b/i
    ];
    
    for (const pattern of modelNumberPatterns) {
      const match = str.match(pattern);
      if (match) {
        return match[0];
      }
    }
    
    return null;
  }
  
  /**
   * Check if a string looks like a model number
   * @param {string} str - String to check
   * @returns {boolean} True if string looks like a model number
   */
  static looksLikeModelNumber(str) {
    if (!str) return false;
    
    // Model numbers typically:
    // - Contain both letters and numbers
    // - Have specific patterns like dashes or slashes
    // - Are relatively short (less than 30 characters)
    
    if (str.length > 30) return false;
    
    // Check for common model number patterns
    const modelNumberPatterns = [
      /[A-Z0-9]+-[A-Z0-9-]+/,  // Alphanumeric with dashes
      /[A-Z0-9]+\/[A-Z0-9]+/,  // Alphanumeric with slashes
      /[A-Z]{1,3}[0-9][A-Z0-9]*/  // Simple alphanumeric pattern
    ];
    
    for (const pattern of modelNumberPatterns) {
      if (pattern.test(str)) {
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Extract model name from product title
   * @param {string} title - Product title
   * @returns {Object} Model information
   */
  static extractModelFromTitle(title) {
    if (!title) {
      return { modelName: null, modelNumber: null };
    }
    
    // Common patterns for model numbers in titles:
    // - Alphanumeric sequences with dashes or slashes (e.g., RZ01-04620200-R3A1, MMMQ3HN/A)
    // - Model numbers often come after brand name
    
    // Try to extract model number using regex patterns
    const modelNumberPatterns = [
      // Pattern: Alphanumeric with dashes (e.g., RZ01-04620200-R3A1)
      /\b[A-Z0-9]+-[A-Z0-9-]+\b/i,
      // Pattern: Alphanumeric with slashes (e.g., MMMQ3HN/A)
      /\b[A-Z0-9]+\/[A-Z0-9]+\b/i,
      // Pattern: Simple alphanumeric model numbers (e.g., MX518)
      /\b[A-Z]{1,3}[0-9][A-Z0-9]*\b/i
    ];
    
    let modelNumber = null;
    for (const pattern of modelNumberPatterns) {
      const match = title.match(pattern);
      if (match) {
        modelNumber = match[0];
        break;
      }
    }
    
    // Try to extract model name by removing brand and other common terms
    let modelName = this.extractModelNameFromTitle(title);
    
    // If we couldn't extract a specific model name, use the model number as model name
    if (!modelName && modelNumber) {
      modelName = modelNumber;
    }
    
    return {
      modelName: modelName,
      modelNumber: modelNumber
    };
  }
  
  /**
   * Extract model name from title by removing brand and common terms
   * @param {string} title - Product title
   * @returns {string|null} Model name or null if not found
   */
  static extractModelNameFromTitle(title) {
    if (!title) return null;
    
    // First, try to extract model number directly from title
    const modelNumber = this.extractModelNumberFromString(title);
    if (modelNumber) {
      return modelNumber;
    }
    
    // Remove brand name from title if found
    let cleanTitle = title;
    const brand = this.extractBrandFromTitle(title);
    if (brand) {
      const brandRegex = new RegExp(`\\b${brand}\\b`, 'gi');
      cleanTitle = cleanTitle.replace(brandRegex, '');
    }
    
    // Remove common terms that are not part of model name
    const commonTerms = [
      'Wireless', 'Bluetooth', 'Gaming', 'Mouse', 'Optical', 'Laser', 'Trackball',
      'Ambidextrous', 'Ergonomic', 'Vertical', 'Mechanical', 'RGB', 'LED',
      'Rechargeable', 'Battery', 'USB', 'Receiver', 'Adapter', 'Charging',
      'Black', 'White', 'Red', 'Blue', 'Green', 'Grey', 'Silver', 'Gold',
      'Classic', 'Modern', 'Premium', 'Standard', 'Advanced', 'Professional',
      '\\([^)]*\\)', // Remove anything in parentheses
      'AA', 'A', // Special characters
      // Remove extra spaces
      '\\s{2,}'
    ];
    
    for (const term of commonTerms) {
      const termRegex = new RegExp(`\\b${term}\\b`, 'gi');
      cleanTitle = cleanTitle.replace(termRegex, ' ');
    }
    
    // Remove extra spaces and special characters
    cleanTitle = cleanTitle.replace(/\s+/g, ' ').trim();
    cleanTitle = cleanTitle.replace(/[^\w\s\-\/]/g, '');
    cleanTitle = cleanTitle.replace(/\s+/g, ' ').trim();
    
    // If we have something left, return it as model name
    return cleanTitle || null;
  }
  
  /**
   * Organize specifications by category
   * @param {Object} specifications - Raw specifications
   * @returns {Object} Organized specifications
   */
  static organizeSpecifications(specifications) {
    if (!specifications || typeof specifications !== 'object') {
      return {};
    }
    
    // Return specifications as-is, but ensure they're properly structured
    const organized = {};
    
    for (const category in specifications) {
      if (typeof specifications[category] === 'object') {
        organized[category] = { ...specifications[category] };
      }
    }
    
    return organized;
  }
  
  /**
   * Extract categories from category array
   * @param {Array} categories - Array of category strings
   * @returns {Array} Cleaned categories
   */
  static extractCategories(categories) {
    if (!Array.isArray(categories)) {
      return [];
    }
    
    // Filter out empty or invalid categories
    return categories.filter(category => 
      typeof category === 'string' && 
      category.trim().length > 0 &&
      category !== 'Home' // Exclude generic "Home" category
    ).map(category => category.trim());
  }
}

// Main method to run the normalizer directly
if (require.main === module) {
  // Default file paths
  const inputFilePath = path.join(__dirname, '..', 'scrapers', 'flipkart', 'raw_data', 'flipkart_mouse_scraped_data.json');
  const outputFilePath = path.join(__dirname, '..', '..', 'parsed_data', 'flipkart_mouse_normalized_data.json');
  
  // Function to read JSON file
  function readJsonFile(filePath) {
    try {
      const data = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error(`Error reading JSON file: ${error.message}`);
      return null;
    }
  }
  
  // Function to write JSON file
  function writeJsonFile(filePath, data) {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      return true;
    } catch (error) {
      console.error(`Error writing JSON file: ${error.message}`);
      return false;
    }
  }
  
  // Main execution
  async function main() {
    console.log('Running Flipkart Mouse Normalizer...\n');
    
    // Read input file
    console.log('Reading input data...');
    const rawData = readJsonFile(inputFilePath);
    
    if (!rawData || !Array.isArray(rawData)) {
      console.error('Could not read input data or data is not an array');
      process.exit(1);
    }
    
    console.log(`Found ${rawData.length} products in the input file.`);
    
    // Normalize all products
    console.log('Normalizing products...');
    const normalizedData = [];
    const errors = [];
    
    for (let i = 0; i < rawData.length; i++) {
      try {
        const product = rawData[i];
        const normalized = FlipkartMouseNormalizer.normalize(product);
        normalizedData.push(normalized);
        
        // Show progress every 100 products
        if ((i + 1) % 100 === 0) {
          console.log(`Processed ${i + 1}/${rawData.length} products...`);
        }
      } catch (error) {
        console.error(`Error normalizing product ${i + 1}: ${error.message}`);
        errors.push({
          index: i,
          error: error.message,
          product: rawData[i]
        });
      }
    }
    
    console.log(`\nNormalization complete!`);
    console.log(`Successfully normalized: ${normalizedData.length} products`);
    console.log(`Errors encountered: ${errors.length} products`);
    
    // Save normalized data
    console.log('\nSaving normalized data...');
    const saveSuccess = writeJsonFile(outputFilePath, normalizedData);
    
    if (saveSuccess) {
      console.log(`Normalized data saved to: ${outputFilePath}`);
    } else {
      console.error('Failed to save normalized data');
      process.exit(1);
    }
    
    // Save errors if any
    if (errors.length > 0) {
      const errorsFilePath = path.join(__dirname, '..', '..', 'parsed_data', 'flipkart_mouse_normalization_errors.json');
      const saveErrorsSuccess = writeJsonFile(errorsFilePath, errors);
      
      if (saveErrorsSuccess) {
        console.log(`Errors saved to: ${errorsFilePath}`);
      } else {
        console.error('Failed to save errors data');
      }
    }
    
    console.log('\nDone!');
    process.exit(0);
  }
  
  // Run main function
  main().catch(error => {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = FlipkartMouseNormalizer;