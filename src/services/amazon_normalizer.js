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
        if (!product || !product.title || typeof product.title !== 'string' || product.title.trim() === '') {
          console.error(`Error normalizing product: Product has null or empty title - skipping`, product?.title || 'No title');
          continue;
        }

        const normalizedProduct = this.normalizeProduct(product);
        if (normalizedProduct) {
          normalized.push(normalizedProduct);
        }
      } catch (error) {
        console.error(`Error normalizing product: ${error.message}`, product?.title || 'Unknown product');
        // Continue processing other products instead of failing completely
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

    // Special handling for iPhone 16 products
    if (this.isIPhone16Product(product)) {
      return this.normalizeIPhone16Product(product);
    }

    return {
      source_details: {
        source_name: "amazon",
        url: product.url || null,
        scraped_at_utc: '2025-08-22T18:55:33.449Z'
      },

      product_identifiers: {
        brand: this.extractBrand(product),
        ...this.extractModelName(product), // This now returns { model_name, model_name_with_5g }
        original_title: product.title || null,
        model_number: this.extractModelNumber(specs)
      },

      variant_attributes: {
        color: this.extractColor(specs),
        ram: this.extractRAM(product),
        availability: product.availability,
        storage: this.extractStorage(specs)
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
   * Check if product is an iPhone 16 variant
   */
  isIPhone16Product(product) {
    if (!product || !product.title) return false;
    
    const title = product.title.toLowerCase();
    return title.includes('iphone 16');
  }

  /**
   * Check if product is any iPhone model
   */
  isAnyIPhoneProduct(product) {
    if (!product || !product.title) return false;
    
    const title = product.title.toLowerCase();
    return title.includes('iphone');
  }

  /**
   * Extract iPhone 16 model name using regex patterns
   */
  extractIPhone16ModelName(title) {
    if (!title) return '';

    const titleLower = title.toLowerCase();
    
    // iPhone 16 model patterns
    const iphone16Patterns = [
      // iPhone 16 Pro Max
      /iphone\s+16\s+pro\s+max/i,
      // iPhone 16 Pro
      /iphone\s+16\s+pro/i,
      // iPhone 16 Plus
      /iphone\s+16\s+plus/i,
      // iPhone 16e
      /iphone\s+16e/i,
      // iPhone 16 (base model)
      /iphone\s+16\b/i
    ];

    for (const pattern of iphone16Patterns) {
      const match = titleLower.match(pattern);
      if (match) {
        // Convert to proper case
        const modelName = match[0].replace(/\b\w/g, l => l.toUpperCase());
        return modelName;
      }
    }

    return '';
  }

  extractIPhone16Color(title, specs) {
    if (!title) return null;
    
    // Handle special cases and normalize colors
    const colorMapping = {
      'Black': 'Black',
      'White': 'White',
      'Pink': 'Pink',
      'Teal': 'Teal',
      'Ultramarine': 'Ultramarine',
      'Desert': 'Desert Titanium',
      'Natural': 'Natural Titanium',
      'Whit': 'White', // Handle truncated
      'Ultrmarine': 'Ultramarine' // Handle typo
    };
    
    // First try to extract color from title after semicolon (most common pattern)
    if (title.includes(';')) {
      const afterSemicolon = title.split(';')[1];
      if (afterSemicolon) {
        const color = afterSemicolon.trim();
        if (color && color.length > 0) {
          // Apply color mapping to semicolon-extracted color
          if (colorMapping[color]) {
            return colorMapping[color];
          }
          return color;
        }
      }
    }
    
    // Fallback: try to extract color from anywhere in the title
    const words = title.trim().split(/\s+/);
    
    // Look for any word that matches our color mapping
    for (const word of words) {
      const cleanWord = word.replace(/[^\w]/g, '');
      if (colorMapping[cleanWord]) {
        return colorMapping[cleanWord];
      }
    }
    
    // Try to extract multi-word colors from anywhere in the title
    // Look for patterns like "Natural Titanium", "Desert Titanium", etc.
    const multiWordColors = ['Natural Titanium', 'Desert Titanium', 'Black Titanium', 'White Titanium'];
    for (const multiColor of multiWordColors) {
      if (title.toLowerCase().includes(multiColor.toLowerCase())) {
        return multiColor;
      }
    }
    
    // If title extraction didn't work, fall back to specifications
    return this.extractColor(specs);
  }

  normalizeIPhone16Product(product) {
    const specs = product.specifications || {};

    return {
      source_details: {
        source_name: "amazon",
        url: product.url || null,
        scraped_at_utc: new Date().toISOString()
      },

      product_identifiers: {
        brand: "Apple",
        model_name: this.extractIPhone16ModelName(product.title),
        original_title: product.title || null,
        model_number: this.extractModelNumber(specs)
      },

      variant_attributes: {
        color: this.extractIPhone16Color(product.title, specs),
        ram: null,
        availability: product.availability,
        storage: this.extractStorage(specs)
      },

      listing_info: {
        price: this.normalizePrice(product.price),
        rating: this.normalizeRating(product.rating),
        image_url: this.cleanAmazonImageUrl(product.image)
      },

      key_specifications: null,

      source_metadata: {
        category_breadcrumb: [ "Electronics",
          "Mobiles & Accessories",
          "Smartphones & Basic Mobiles",
          "Smartphones"]
      }
    };
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
   * Validate model name against product title with 80% similarity threshold
   */
  validateModelNameAgainstTitle(modelName, title) {
    if (!modelName || !title) return false;

    // Normalize strings for comparison
    const normalizedModel = modelName.toLowerCase().trim();
    const normalizedTitle = title.toLowerCase();

    // Split model name into words for better matching
    const modelWords = normalizedModel.split(/\s+/).filter(word => word.length > 0);

    if (modelWords.length === 0) return false;

    // Count how many model words appear in the title
    let matchedWords = 0;

    modelWords.forEach(word => {
      // Check if word appears in title (allowing for partial matches for very short words)
      if (word.length <= 2) {
        // For very short words (like "13", "S24"), require exact word boundary match
        const wordPattern = new RegExp(`\\b${this.escapeRegex(word)}\\b`, 'i');
        if (wordPattern.test(title)) {
          matchedWords++;
        }
      } else {
        // For longer words, allow substring matching
        if (normalizedTitle.includes(word)) {
          matchedWords++;
        }
      }
    });

    // Calculate similarity percentage
    const similarity = matchedWords / modelWords.length;

    // Return true if 80% or more of the model name words are found in title
    return similarity >= 0.8;
  }

  /**
   * Enhanced model name extraction with dual model name generation
   */
  extractModelName(product) {
    const candidates = [];

    // PHASE 1: Enhanced Specs Validation (NEW APPROACH)
    const specModelName = this.getModelFromSpecs(product);
    if (specModelName && this.isValidSpecModelName(specModelName, product)) {

      // Validate against title with 80% threshold
      if (this.validateModelNameAgainstTitle(specModelName, product.title)) {
        const brand = this.extractBrand(product);
        const cleanedSpecModel = this.cleanModelNameFromBrand(specModelName, brand);
        const finalCleanedModel = this.cleanModelName(cleanedSpecModel);

        candidates.push({
          source: 'specs_validated',
          value: finalCleanedModel,
          confidence: 0.9, // Higher confidence due to title validation
          validation: 'title_validated'
        });
      } else {
        // Still include as candidate but with lower confidence
        const brand = this.extractBrand(product);
        const cleanedSpecModel = this.cleanModelNameFromBrand(specModelName, brand);
        const finalCleanedSpecModel = this.cleanModelName(cleanedSpecModel);
        candidates.push({
          source: 'specs_unvalidated',
          value: finalCleanedSpecModel,
          confidence: 0.5, // Lower confidence due to failed validation
          validation: 'title_failed'
        });
      }
    }

    // Candidate 2: Model name from productName
    if (product.productName && product.productName !== "Product information") {
      const { brand, model } = this.extractBrandAndModelName(product.productName);
      if (model && this.isValidModelName(model)) {
        // Clean the model name to remove RAM/ROM, colors, etc.
        const cleanedModel = this.cleanModelName(model);
        candidates.push({
          source: 'productName',
          value: cleanedModel,
          confidence: 0.8 // Higher confidence as it's usually more accurate
        });
      }
    }

    // Candidate 3: Model name from title
    const titleModel = this.extractModelNameFromTitle(product.title, product);
    if (titleModel && this.isValidModelName(titleModel)) {
      // Clean the model name to remove RAM/ROM, colors, etc.
      const cleanedTitleModel = this.cleanModelName(titleModel);
      candidates.push({
        source: 'title',
        value: cleanedTitleModel,
        confidence: 0.6 // Lower confidence due to parsing complexity
      });
    }

    // Cross-validate and select best candidate
    const bestModelName = this.selectBestModelNameCandidate(candidates, product);

    // Process the model name through color removal and dual name generation
    const colorRemovedModelName = this.removeColorFromModelName(bestModelName, product);
    
    // Final cleanup: ensure RAM/ROM and other specs are removed from the final model name
    const finalCleanedModelName = this.cleanModelName(colorRemovedModelName);
    
    return {
      model_name: finalCleanedModelName,
    };
  }

  /**
   * Remove color from model name if it matches the extracted color (simplified approach)
   */
  removeColorFromModelName(modelName, product) {
    if (!modelName) return modelName;

    // Extract color from specifications
    const extractedColor = this.extractColor(product.specifications || {});
    if (!extractedColor) return modelName;

    // Normalize both model name and color to lowercase for case-insensitive matching
    const lowerModelName = modelName.toLowerCase();
    const lowerColor = extractedColor.toLowerCase().trim();

    // Remove common color prefixes/suffixes that might not be in model names
    const cleanColor = lowerColor
      .replace(/\s*(color|colour)\s*$/i, '')
      .replace(/^(color|colour)\s*/i, '')
      .trim();

    if (!cleanColor || cleanColor.length < 2) return modelName;

    // Check if the color exists in the model name and remove it
    let cleanedModelName = modelName;

    // Simple case-insensitive replacement using word boundaries
    const colorPattern = new RegExp(`\\b${this.escapeRegex(cleanColor)}\\b`, 'gi');

    if (colorPattern.test(lowerModelName)) {
      cleanedModelName = modelName.replace(colorPattern, '').trim();

      // Clean up extra spaces
      cleanedModelName = cleanedModelName.replace(/\s+/g, ' ').trim();

      // If the cleaned name is too short or empty, return original
      if (cleanedModelName.length < 2) {
        return modelName;
      }

      return cleanedModelName;
    }

    // If no color match found, return original model name
    return modelName;
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
   * Extract model name from title using regex patterns
   */
  extractModelNameFromTitle(title, product) {
    if (!title) return '';

    const brand = this.extractBrand(product);

    // Special handling for Nothing Phone models
    if (brand === 'Nothing' && title.toLowerCase().includes('nothing phone')) {
      return this.extractNothingPhoneModel(title);
    }

    // Comprehensive regex patterns for different model name formats
    const modelPatterns = [
      // Pattern 1: Brand + Model + Number (e.g., "Redmi 13 5G Prime Edition")
      // More restrictive to stop at RAM/ROM/Storage or other specs
      new RegExp(`(${brand}\\s+)([A-Za-z0-9]+\\s*[0-9]*[A-Za-z]*\\s*[0-9]*[A-Za-z]*?)(?=\\s*(?:\\d+GB|\\d+TB|RAM|ROM|Storage|\\||\\(|$))`, 'i'),

      // Pattern 2: Specific brand patterns with model extraction
      /(Redmi\s+)([A-Za-z0-9]+)/i,
      /(POCO\s+)([A-Za-z0-9]+)/i,
      /(OnePlus\s+)([A-Za-z0-9]+)/i,
      /(Nothing\s+Phone\s*)([0-9]*)/i,
      /(Motorola\s+)([A-Za-z0-9]+)/i,
      /(Vivo\s+)([A-Za-z0-9]+)/i,
      /(Oppo\s+)([A-Za-z0-9]+)/i,
      /(Realme\s+)([A-Za-z0-9]+)/i,
      /(iQOO\s+)([A-Za-z0-9]+)/i,
      /(Samsung\s+Galaxy\s+)([A-Za-z0-9]+)/i,
      /(Apple\s+iPhone\s+)([0-9]+[A-Za-z]*)/i,

      // Pattern 3: Generic model patterns
      /([A-Za-z]+[\s-]*[0-9]+[A-Za-z]*)/g,
      /([A-Za-z]+\s+[A-Za-z]+\s*[0-9]*)/g
    ];

    for (const pattern of modelPatterns) {
      const matches = title.match(pattern);
      if (matches) {
        // For patterns with capture groups, use the second group (model part)
        let modelName = matches.length > 1 ? matches[2] : matches[0];

        // Remove brand name if it's at the start
        if (brand && modelName && typeof modelName === 'string' && typeof brand === 'string' &&
          modelName.toLowerCase().startsWith(brand.toLowerCase())) {
          modelName = modelName.substring(brand.length).trim();
        }

        // Clean the model name
        modelName = this.cleanModelName(modelName);

        if (modelName && modelName.length > 1) {
          return modelName;
        }
      }
    }

    return '';
  }

  /**
   * Extract Nothing Phone model with proper parenthetical handling
   */
  extractNothingPhoneModel(title) {
    if (!title) return '';

    const titleLower = title && typeof title === 'string' ? title.toLowerCase() : '';

    // Pattern for Nothing Phone models with parenthetical identifiers
    // Examples: "Nothing Phone (3a)", "Nothing Phone (2a) Plus", "Nothing Phone (3a) Pro 5G"
    const nothingPatterns = [
      // Pattern 1: Phone (identifier) Pro/Plus/5G variations
      /nothing\s+phone\s*\(([^)]+)\)\s*(pro|plus)?\s*(5g)?/i,
      // Pattern 2: Phone (identifier) with additional descriptors
      /nothing\s+phone\s*\(([^)]+)\)([^|]*?)(?:\s*\||$)/i
    ];

    for (const pattern of nothingPatterns) {
      const match = titleLower.match(pattern);
      if (match) {
        let modelName = `Phone (${match[1]})`;

        // Add Pro/Plus if present
        if (match[2]) {
          modelName += ` ${match[2].charAt(0).toUpperCase() + match[2].slice(1).toLowerCase()}`;
        }

        // Add 5G if present and not already included
        if (match[3] && !modelName.includes('5G')) {
          modelName += ' 5G';
        }

        return modelName;
      }
    }

    // Fallback: try to extract any parenthetical content after "Phone"
    const fallbackMatch = titleLower.match(/nothing\s+phone\s*\(([^)]+)\)/i);
    if (fallbackMatch) {
      return `Phone (${fallbackMatch[1]})`;
    }

    return '';
  }

  /**
   * Get model name from specifications
   */
  getModelFromSpecs(product) {
    const productDetails = product.specifications?.["Product Details"]?.productDetails;

    if (productDetails && productDetails["model name"]) {
      return productDetails["model name"];
    }

    return null;
  }

  /**
   * Check if model name is valid (not empty, not dash, not generic terms)
   */
  isValidModelName(modelName) {
    if (!modelName || typeof modelName !== 'string') {
      return false;
    }

    const trimmed = modelName.trim();

    // Check for empty or dash
    if (trimmed === '' || trimmed === '—' || trimmed === '-') {
      return false;
    }

    // Check for generic invalid terms
    const invalidTerms = [
      'product information',
      'mobile phone information',
      'smartphone',
      'mobile phone',
      'phone',
      'mobile'
    ];

    const lowerTrimmed = trimmed.toLowerCase();
    if (invalidTerms.some(term => lowerTrimmed === term)) {
      return false;
    }

    // Must have at least 2 characters
    return trimmed.length >= 2;
  }

  /**
   * Enhanced check if the value is a model number rather than a model name
   * Based on analysis of 500 Amazon products:
   * - Model numbers: RMX3940, SM-A145F, CPH2345, I2410, MTP03HN/A, etc.
   * - Model names: iPhone 15, Galaxy S24, iQOO Neo 10R 5G, etc.
   */
  isModelNumber(value) {
    if (!value || typeof value !== 'string') {
      return false;
    }

    const trimmed = value.trim();

    // If it's too short (1-2 chars), it's likely not a proper model name
    if (trimmed.length <= 2) {
      return true;
    }

    // Enhanced model number patterns based on Amazon data analysis
    const modelNumberPatterns = [
      // Brand-specific patterns
      /^RMX\d{4}$/i,                    // Realme: RMX3940, RMX5313
      /^SM-[A-Z]\d{3}[A-Z]?$/i,        // Samsung: SM-M055F, SM-M066B
      /^CPH\d{4}$/i,                    // OnePlus: CPH2345, CPH2619, CPH2739
      /^I\d{4}$/i,                      // iQOO: I2410, I2221, I2409, I2404, I2407
      /^MTP\d{2}[A-Z]{2}\/[A-Z]$/i,    // Apple: MTP03HN/A, MTP43HN/A
      /^S\d{3}[A-Z]{1,2}$/i,           // Samsung: S928BZ

      // Generic technical code patterns
      /^[A-Z]{2,4}\d{3,5}[A-Z]?$/i,    // Generic: KL4h, 60515
      /^[A-Z]\d{4}[A-Z]?$/i,           // Single letter + 4 digits: I2410
      /^\d{5,}$/i,                      // Pure numbers: 60515, 24116RNC1I
      /^[A-Z]{2,3}\d{4}[A-Z]{1,3}$/i,  // Complex codes: 24116RNC1I, 24040RN64Y
      /^[A-Z]{3,4}\d{2,4}[A-Z]{2,4}$/i, // Mixed patterns: various technical codes

      // Patterns that are clearly technical identifiers
      /^[A-Z0-9]{6,}$/i,               // Long alphanumeric codes without spaces
      /^[A-Z]+\d+[A-Z]+\d*$/i,         // Alternating letters and numbers
      /^\d+[A-Z]+\d+[A-Z]*$/i          // Numbers, letters, numbers pattern
    ];

    // Check if it matches any model number pattern
    if (modelNumberPatterns.some(pattern => pattern.test(trimmed))) {
      return true;
    }

    // Additional heuristics based on analysis

    // If it contains no spaces and is all uppercase with numbers, likely a model number
    if (!/\s/.test(trimmed) && /^[A-Z0-9]+$/i.test(trimmed) && /\d/.test(trimmed) && trimmed.length > 4) {
      // But exclude valid short model names like "M05", "A55", "Z10"
      if (!/^[A-Z]\d{1,3}[A-Z]?$/i.test(trimmed)) {
        return true;
      }
    }

    // If it's a single word with mixed case and numbers but no spaces, might be model number
    if (!/\s/.test(trimmed) && /[A-Z]/.test(trimmed) && /[a-z]/.test(trimmed) && /\d/.test(trimmed)) {
      // Examples: "Reno14Pro" - this is likely a model number masquerading as model name
      if (trimmed.length > 8) {
        return true;
      }
    }

    return false;
  }

  /**
   * Enhanced validation to check if extracted spec model name is actually a valid model name
   * This addresses the issue where Amazon specs sometimes contain model numbers instead of model names
   */
  isValidSpecModelName(specModelName, product) {
    if (!specModelName || typeof specModelName !== 'string') {
      return false;
    }

    const trimmed = specModelName.trim();

    // First check if it's obviously a model number
    if (this.isModelNumber(trimmed)) {
      return false;
    }

    // Check if it's a valid model name format
    if (!this.isValidModelName(trimmed)) {
      return false;
    }

    // Additional validation: check if it appears in the title
    // Valid model names usually appear in product titles
    if (product.title && this.validateModelNameAgainstTitle(trimmed, product.title)) {
      return true;
    }

    // If it contains brand name + model pattern, it's likely valid
    const brand = this.extractBrand(product);
    if (brand && trimmed.toLowerCase().includes(brand.toLowerCase())) {
      return true;
    }

    // If it contains common model name patterns, it's likely valid
    const modelNamePatterns = [
      /^(iPhone|Galaxy|OnePlus|Redmi|iQOO|realme|POCO|Vivo|Oppo|Nothing)\s+/i,
      /^[A-Za-z]+\s+[A-Za-z0-9]+/,     // Brand + Model pattern
      /\s+5G$/i,                        // Ends with 5G
      /\s+(Pro|Max|Ultra|Lite|Plus)(\s|$)/i // Contains model variants
    ];

    if (modelNamePatterns.some(pattern => pattern.test(trimmed))) {
      return true;
    }

    // If none of the above, it's questionable - return false to be safe
    return false;
  }

  /**
   * Remove brand name from model name if present
   */
  cleanModelNameFromBrand(modelName, brand) {
    if (!modelName || !brand) {
      return this.cleanModelName(modelName);
    }

    let cleaned = modelName;

    // Remove brand name if it starts with it (case insensitive)
    if (cleaned && brand && typeof cleaned === 'string' && typeof brand === 'string' &&
      cleaned.toLowerCase().startsWith(brand.toLowerCase())) {
      cleaned = cleaned.substring(brand.length).trim();
    }

    // Remove brand variations
    if (brand && typeof brand === 'string') {
      const brandVariations = this.getBrandVariations(brand);
      for (const variation of brandVariations) {
        if (cleaned && typeof cleaned === 'string' && typeof variation === 'string' &&
          cleaned.toLowerCase().startsWith(variation.toLowerCase())) {
          cleaned = cleaned.substring(variation.length).trim();
          break;
        }
      }
    }

    return this.cleanModelName(cleaned);
  }

  /**
   * Get brand variations for better brand removal
   */
  getBrandVariations(brand) {
    const variations = {
      'Samsung': ['Samsung', 'Galaxy'],
      'Apple': ['Apple', 'iPhone'],
      'Xiaomi': ['Xiaomi', 'Mi', 'Redmi'],
      'Realme': ['Realme', 'realme'],
      'OnePlus': ['OnePlus', 'One Plus'],
      'iQOO': ['iQOO', 'IQOO'],
      'Vivo': ['Vivo', 'VIVO'],
      'Oppo': ['Oppo', 'OPPO'],
      'Nothing': ['Nothing']
    };

    return variations[brand] || [brand];
  }

  /**
   * Select the best model name candidate using cross-validation
   */
  selectBestModelNameCandidate(candidates, product) {
    if (candidates.length === 0) {
      return null;
    }

    if (candidates.length === 1) {
      return candidates[0].value;
    }

    // Cross-validate candidates against title for accuracy
    const title = product.title?.toLowerCase() || '';
    const brandObj = this.extractBrand(product);
    const brand = brandObj ? brandObj.toLowerCase() : '';

    // Score each candidate based on title validation
    const scoredCandidates = candidates.map(candidate => {
      let score = candidate.confidence;
      const modelLower = candidate.value && typeof candidate.value === 'string' ? candidate.value.toLowerCase() : '';

      // Check if the model name appears in the title
      if (title.includes(modelLower)) {
        score += 0.3;
      }

      // Check if brand + model appears in title (e.g., "Galaxy F05")
      if (brand && typeof brand === 'string' && title.includes(`${brand} ${modelLower}`)) {
        score += 0.2;
      }

      // Check for exact model pattern in title (e.g., "F05" in "Galaxy F05")
      const modelPattern = new RegExp(`\\b${this.escapeRegex(candidate.value)}\\b`, 'i');
      if (modelPattern.test(title)) {
        score += 0.25;
      }

      // Penalize if model name contradicts title
      // For example, if specs say "M05" but title clearly says "F05"
      if (this.hasModelContradiction(candidate.value, title, brand)) {
        score -= 0.4;
      }

      return {
        ...candidate,
        finalScore: score
      };
    });

    // Sort by final score and return the best candidate
    scoredCandidates.sort((a, b) => b.finalScore - a.finalScore);

    const bestCandidate = scoredCandidates[0];

    // If the best candidate has a very low score, it might be unreliable
    if (bestCandidate.finalScore < 0.5) {
      // Log for manual review
      console.warn(`Low confidence model name for: ${product.title}`);
      console.warn(`Best candidate: ${bestCandidate.value} (score: ${bestCandidate.finalScore})`);
    }

    return bestCandidate.value;
  }

  /**
   * Check if there's a contradiction between model name and title
   */
  hasModelContradiction(modelName, title, brand) {
    if (!brand || !title || !modelName) return false;

    const titleLower = title && typeof title === 'string' ? title.toLowerCase() : '';
    const brandLower = brand && typeof brand === 'string' ? brand.toLowerCase() : '';
    const modelLower = modelName && typeof modelName === 'string' ? modelName.toLowerCase() : '';

    // Look for clear model indicators in title that contradict the model name
    // For Samsung Galaxy series
    if (brandLower === 'samsung' && titleLower.includes('galaxy')) {
      // Extract the model part after "Galaxy"
      const galaxyMatch = titleLower.match(/galaxy\s+([a-z]\d+)/);
      if (galaxyMatch) {
        const titleModel = galaxyMatch[1];
        // If title says "F05" but model name is "M05", that's a contradiction
        if (titleModel !== modelLower && titleModel.slice(1) === modelLower.slice(1)) {
          return true;
        }
      }
    }

    // For other brands, check for similar patterns
    const modelNumberPattern = /([a-z]\d+)/gi;
    const titleModels = titleLower.match(modelNumberPattern) || [];

    for (const titleModel of titleModels) {
      // If we find a model in title that's very similar but different (like F05 vs M05)
      if (titleModel.length === modelLower.length &&
        titleModel.slice(1) === modelLower.slice(1) &&
        titleModel[0] !== modelLower[0]) {
        return true;
      }
    }

    return false;
  }

  /**
   * Escape special regex characters
   */
  escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Clean model name by removing color, storage, and other irrelevant information
   */
  cleanModelName(modelName) {
    if (!modelName) return '';

    let cleaned = modelName;

    // Remove color information (usually in parentheses or after comma)
    // BUT preserve Nothing Phone identifiers like "(3a)", "(2a)" etc.
    if (cleaned.includes('Phone (') && /Phone\s*\([^)]+\)/.test(cleaned)) {
      // For Nothing Phone models, preserve the identifier in parentheses
      // Only remove other parentheses content that's not a phone identifier
      cleaned = cleaned.replace(/\(([^)]*)\)/g, (match, content) => {
        // If it's a phone identifier (like "3a", "2a"), keep it
        if (/^\d+[a-z]?$/i.test(content.trim())) {
          return match; // Keep the original parentheses
        }
        // Otherwise remove it
        return '';
      });
    } else {
      // For non-phone models, remove all parentheses content
      cleaned = cleaned.replace(/\([^)]*\)/g, '').trim();
    }
    
    cleaned = cleaned.replace(/,[^,]*$/g, '').trim();

    // Remove embedded colors that appear directly in model names
    const commonColors = [
      // Basic colors
      'Black', 'White', 'Red', 'Blue', 'Green', 'Yellow', 'Orange', 'Purple', 'Pink',
      'Gray', 'Grey', 'Brown', 'Silver', 'Gold', 'Rose', 'Coral', 'Mint', 'Aqua',

      // Color variations
      'Midnight', 'Space', 'Jet', 'Pearl', 'Matte', 'Glossy', 'Metallic', 'Satin',
      'Deep', 'Light', 'Dark', 'Bright', 'Pale', 'Vivid', 'Rich', 'Soft',

      // Specific color names commonly used in phones
      'Panda', 'Just', 'Mystic', 'Phantom', 'Cosmic', 'Aurora', 'Ocean', 'Sky',
      'Forest', 'Desert', 'Arctic', 'Lunar', 'Solar', 'Stellar', 'Nebula',
      'Diamond', 'Crystal', 'Platinum', 'Titanium', 'Chrome', 'Bronze', 'Copper',
      'Obsidian', 'Emerald', 'Ruby', 'Sapphire', 'Onyx', 'Jade', 'Amber',
      'Orchid', 'Pink', 'Stellar Pink',

      // Color combinations (will be handled as single words)
      'Starlight', 'Graphite', 'Magsafe', 'Alpine', 'Sierra', 'Pacific', 'Ceramic',
      'Frosted', 'Gradient', 'Prism', 'Spectrum', 'Iridescent', 'Holographic'
    ];

    // Remove common color combinations first (more specific matches)
    // This prevents partial color names from remaining
    const colorCombinations = [
      'Midnight Black', 'Space Gray', 'Space Grey', 'Jet Black', 'Pearl White',
      'Rose Gold', 'Matte Black', 'Glossy White', 'Deep Blue', 'Light Blue',
      'Dark Green', 'Bright Red', 'Pale Pink', 'Vivid Purple', 'Rich Brown',
      'Soft Silver', 'Mystic Black', 'Phantom Silver', 'Cosmic Gray', 'Aurora Green',
      'Ocean Blue', 'Sky Blue', 'Forest Green', 'Desert Gold', 'Arctic White',
      'Lunar Silver', 'Solar Red', 'Stellar Blue', 'Nebula Purple', 'Diamond Black',
      'Crystal White', 'Platinum Silver', 'Titanium Gray', 'Chrome Silver',
      'Panda White', 'Just Black', 'Satin Black', 'Aqua Blue',
      
          // Additional color combinations found in phone data
    'Ice Silver', 'Glacier Green', 'Cosmic Silver', 'Stellar Pink', 'Ethereal Blue',
    'Mystical Green', 'Enchanted Green', 'Aqua Bliss', 'Diamond Dust Black',
    'Pondicherry Blue', 'Jaisalmer Gold', 'Hawaiian Blue', 'Dimond Black',
    'Charcoal', 'Nature Green', 'Wave Green', 'Pepermint Green', 'Moonlight Silver',
    'Leather Blue', 'Satin Black', 'Power Black', 'Titanium Grey', 'Midnight Shadow',
    'Midnight Galaxy', 'Diamond Dust', 'Ethereal Blue', 'Mystical Green',
    'Dimond'
    ];

    const combinationPattern = new RegExp(`\\s+(${colorCombinations.join('|')})\\b`, 'gi');
    cleaned = cleaned.replace(combinationPattern, '');
    
    // Remove colors that appear as separate words (with word boundaries)
    // But only if they weren't already handled by combinations
    const colorPattern = new RegExp(`\\s+(${commonColors.join('|')})\\b`, 'gi');
    cleaned = cleaned.replace(colorPattern, '');

    // Remove storage information
    cleaned = cleaned.replace(/\d+GB\s*RAM?/gi, '').trim();
    cleaned = cleaned.replace(/\d+GB\s*Storage?/gi, '').trim();
    cleaned = cleaned.replace(/\d+GB\s*ROM?/gi, '').trim();
    cleaned = cleaned.replace(/\+\d+GB/gi, '').trim();
    
    // Remove standalone GB numbers (like "8GB", "128GB") that might not have RAM/Storage/ROM labels
    cleaned = cleaned.replace(/\b\d+GB\b/gi, '').trim();
    
    // Remove standalone TB numbers (like "1TB", "2TB")
    cleaned = cleaned.replace(/\b\d+TB\b/gi, '').trim();
    
    // Remove any remaining storage-like patterns
    cleaned = cleaned.replace(/\b\d+\s*[GM]B\b/gi, '').trim();
    
    // Remove brand-related terms that shouldn't be in model names
    cleaned = cleaned.replace(/\b(CMF|BY NOTHING)\b/gi, '').trim();
    
    cleaned = cleaned.replace(/\s+(Mobile|Phone|Smartphone)$/i, '').trim();

    // Clean up extra spaces
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    return cleaned;
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


  extractRAM(product) {
    let ramValue = null;
    const specs = product.specifications || {};
    const isAnyIPhone = this.isAnyIPhoneProduct(product);
    if (isAnyIPhone) {
      return null;
    }
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
            return parseInt(value);
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

    return brandMappings[brand && typeof brand === 'string' ? brand.toLowerCase() : ''] || brand;
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
      { brand: 'Nothing', patterns: ['nothing'] },
      { brand: 'Poco', patterns: ['poco'] },
      { brand: 'Tecno', patterns: ['tecno'] },
      { brand: 'Infinix', patterns: ['infinix'] },
      { brand: 'Honor', patterns: ['honor'] },
      { brand: 'Huawei', patterns: ['huawei'] },
      { brand: 'iQOO', patterns: ['iqoo'] }
    ];

    const titleLower = title && typeof title === 'string' ? title.toLowerCase() : '';

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