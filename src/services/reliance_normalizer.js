const fs = require('fs');
const path = require('path');
const { distance } = require('fastest-levenshtein');

// Try to import logger, fall back to console if not available
let logger;
try {
  const { createLogger } = require('../utils/logger');
  logger = createLogger('reliance_normalizer');
} catch (e) {
  logger = console;
}

class RelianceNormalizer {
  constructor() {
    this.logger = logger;
    this.currentTitle = null;
    this.stats = {
      nullBrandCount: 0,
      nullModelCount: 0,
      manualReviewCount: 0,
      totalProcessed: 0
    };
    // List of known sub-brands to prioritize from title
    this.knownSubBrands = ['Redmi', 'POCO'];
  }

  // Public: normalize array
  normalizeProducts(products) {
    const normalized = [];
    this.resetStats();
    for (const product of products) {
      try {
        if (!product || !product.title || typeof product.title !== 'string' || product.title.trim() === '') {
          this.logger.error('Skipping product with empty title');
          continue;
        }
        this.stats.totalProcessed++;
        const norm = this.normalizeProduct(product);
        if (norm) normalized.push(norm);
      } catch (err) {
        this.logger.error(`Error normalizing product: ${err.message}`);
      }
    }
    this.logStats();
    return normalized;
  }

  // Single product normalization (match Flipkart/Croma structure)
  normalizeProduct(product) {
    this.currentTitle = product.title;
    const specs = product.specifications || {};

    const identifiers = this.extractIdentifiers(product, specs);

    return {
      source_details: {
        source_name: 'reliance',
        url: product.url || product?.source_details?.url || null,
        scraped_at_utc: product.extractedAt || new Date().toISOString()
      },
      product_identifiers: {
        brand: identifiers.brand,
        model_name: this.preprocessModelName(identifiers.model_name, identifiers.brand),
        original_title: product.title || null,
        model_number: identifiers.model_number,
        needs_manual_review: identifiers.needs_manual_review || false
      },
      variant_attributes: {
        color: this.extractColor(specs, product.title),
        ram: this.extractRAM(specs, product.title),
        storage: this.extractStorage(specs, product.title)
      },
      listing_info: {
        price: this.normalizePrice(product.price),
        availability: product.availability || null,
        rating: this.normalizeRating(product.rating),
        image_url: this.extractMainImage(product.image)
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
        category_breadcrumb: this.generateCategoryBreadcrumb(product, specs)
      }
    };
  }

  // ---------- Identifiers (brand + model) with confidence ----------
  extractIdentifiers(product, specs) {
    // Step 1: Extract from specs
    const specBrand = this.extractBrandFromSpecs(specs);
    const specModel = this.extractModelFromSpecs(specs);

    // Step 2: Extract from title  
    const fromTitle = this.extractBrandAndModelFromTitle(product.title || '');
    const titleBrand = this.standardizeBrand(fromTitle.brand);
    const titleModel = this.cleanModelName(fromTitle.model);

    // Step 3: Dual brand extraction with similarity matching
    const brandResult = this.validateBrandExtraction(specBrand, titleBrand);

    // Extract final brand early
    const finalBrand = typeof brandResult === 'object' ? brandResult.final_brand_name : brandResult;
    const brandNeedsReview = typeof brandResult === 'object' ? brandResult.brand_name === 'MANUAL_REVIEW' : brandResult === 'MANUAL_REVIEW';

    // Step 4: Dual model extraction with model number detection, passing finalBrand
    const modelResult = this.validateModelExtraction(specModel, titleModel, specs, finalBrand);

    // Update stats
    if (!finalBrand || brandNeedsReview) this.stats.nullBrandCount++;
    if (!modelResult.final_model_name) this.stats.nullModelCount++;
    if (brandNeedsReview || modelResult.model_name === 'MANUAL_REVIEW') {
      this.stats.manualReviewCount++;
    }

    return {
      brand: finalBrand,
      model_name: modelResult.final_model_name,
      model_number: modelResult.model_number,
      needs_manual_review: brandNeedsReview || modelResult.model_name === 'MANUAL_REVIEW'
    };
  }

  // Title-based brand/model extractor
  extractBrandAndModelFromTitle(title) {
    if (typeof title !== 'string') return { brand: null, model: null };
    const trimmed = title.trim();
    // Known brands seen on Reliance titles (cleaned and deduplicated)
    const brandPattern = /^(Apple|Samsung|Redmi|Realme|OnePlus|POCO|Vivo|Tecno|Google|Infinix|Nothing|Motorola|Nokia|Huawei|Honor|Asus|Lenovo|HTC|Sony|LG|BlackBerry|ZTE|Alcatel|Gionee|Micromax|Lava|Intex|Karbonn|iBall|Xolo|Spice|Videocon|Onida|BPL|Godrej|Panasonic|Sharp|Toshiba|Philips|Sanyo|Hitachi|Daewoo|Hyundai|Sansui|Akai|Bush|Goodmans|Grundig|Loewe|Metz|Nordmende|Telefunken|Thomson|Vestel|Wharfedale|Yamaha|Denon|Marantz|Onkyo|Pioneer|Technics|JVC|Kenwood)\b/i;
    const brandMatch = trimmed.match(brandPattern);
    if (!brandMatch) {
      return { brand: null, model: null };
    }
    const brand = brandMatch[1];
    // Capture model from after the brand up to storage/RAM/color/comma/mobile phone/end
    const modelPattern = new RegExp(
      String.raw`^\s*(?:${brand})\s+(.+?)(?=\s+\d+(?:\.\d+)?\s*(?:GB|TB)\b|\s*,|\s+Mobile Phone\b|$)`,
      'i'
    );
    const modelMatch = trimmed.match(modelPattern);
    if (!modelMatch) {
      return { brand, model: null };
    }
    let model = modelMatch[1].trim();
    // If 5G appears anywhere in the title but not captured, include it in the model
    if (/\b5G\b/i.test(trimmed) && !/\b5G\b/i.test(model)) {
      model = `${model} 5G`;
    }
    // Clean any trailing hyphens or extraneous punctuation
    model = model.replace(/[\s\-,:]+$/g, '').trim();
    return { brand, model };
  }

  // Specs model extraction: try common keys inside nested sections
  extractModelFromSpecs(specs) {
    const candidates = [];
    const findInObject = (obj, keys) => {
      for (const k of keys) {
        if (obj && typeof obj === 'object' && obj[k]) {
          const val = String(obj[k]).trim();
          if (val) candidates.push(val);
        }
      }
    };

    // Flat search in top-level sections
    for (const section of Object.values(specs || {})) {
      if (!section || typeof section !== 'object') continue;
      findInObject(section, ['Model', 'Model Name', 'Model Series', 'Series']);
    }

    // Return cleaned, most plausible
    for (const c of candidates) {
      const cleaned = this.cleanModelName(c);
      if (this.isValidModelName(cleaned)) return cleaned;
    }
    return null;
  }

  // Specs brand extraction
  extractBrandFromSpecs(specs) {
    const candidates = [];
    for (const section of Object.values(specs || {})) {
      if (!section || typeof section !== 'object') continue;
      for (const key of ['Brand', 'Manufacturer', 'Brand Name', 'Sub-brand']) {
        if (section[key]) candidates.push(String(section[key]).trim());
      }
    }
    for (const c of candidates) {
      const std = this.standardizeBrand(c);
      if (std) return std;
    }
    return null;
  }

  // ---------- Other field extractors ----------
  extractColor(specs, title) {
    for (const section of Object.values(specs || {})) {
      if (!section || typeof section !== 'object') continue;
      for (const key of ['Color', 'Brand Color', 'Colour']) {
        if (section[key]) return String(section[key]).trim();
      }
    }
    if (title) {
      const m = title.match(/\(([^)]+)\)/);
      if (m && m[1]) return m[1].split(',')[0].trim();
    }
    return null;
  }

  extractRAM(specs, title) {
    for (const section of Object.values(specs || {})) {
      if (!section || typeof section !== 'object') continue;
      for (const key of ['Memory (RAM)', 'RAM', 'Memory', 'RAM Memory']) {
        if (section[key]) {
          const m = String(section[key]).match(/(\d+)\s*GB/i);
          if (m) return parseInt(m[1], 10);
        }
      }
    }
    if (title) {
      const m = title.match(/(\d+)\s*GB\s*RAM/i);
      if (m) return parseInt(m[1], 10);
    }
    return null;
  }

  extractStorage(specs, title) {
    for (const section of Object.values(specs || {})) {
      if (!section || typeof section !== 'object') continue;
      for (const key of ['Internal Storage', 'Storage', 'Memory Capacity']) {
        if (section[key]) {
          const s = String(section[key]);
          let m = s.match(/(\d+)\s*GB/i);
          if (m) return parseInt(m[1], 10);
          m = s.match(/(\d+)\s*TB/i);
          if (m) return parseInt(m[1], 10) * 1024;
        }
      }
    }
    if (title) {
      const m = title.match(/(\d+)\s*GB(?!\s*RAM)/i);
      if (m) return parseInt(m[1], 10);
    }
    return null;
  }

  normalizePrice(price) {
    if (!price) {
      return { current: null, original: null, discount_percent: null, currency: 'INR' };
    }
    const toNumber = (val) => {
      if (val === null || val === undefined) return null;
      if (typeof val === 'number') return Number.isNaN(val) ? null : Math.round(val);
      if (typeof val === 'string') {
        const cleaned = val.replace(/[,₹\s]/g, '').replace(/[^\d.]/g, '');
        if (!cleaned) return null;
        const n = parseFloat(cleaned);
        return Number.isNaN(n) ? null : Math.round(n);
      }
      if (typeof val === 'object' && val.current !== undefined) return toNumber(val.current);
      return null;
    };
    let current = null;
    let original = null;
    if (typeof price === 'object') {
      current = toNumber(price.price ?? price.current);
      original = toNumber(price.originalPrice ?? price.original);
    } else {
      current = toNumber(price);
    }
    let discountPercent = null;
    if (original && current && original > current) {
      discountPercent = Math.round(((original - current) / original) * 100);
    }
    return { current, original, discount_percent: discountPercent, currency: 'INR' };
  }

  normalizeRating(rating) {
    if (!rating) return { score: null, count: null };
    if (typeof rating === 'object') {
      const score = rating.rating ?? rating.value ?? null;
      const count = rating.ratingCount ?? rating.count ?? null;
      return { score: score ?? null, count: count ?? null };
    }
    return { score: null, count: null };
  }

  extractMainImage(imageObj) {
    if (!imageObj) return null;
    if (typeof imageObj === 'string') return imageObj;
    return imageObj.mainImage || null;
  }

  // ---------- Spec sections ----------
  extractDisplaySpecs(specs) {
    const s = this.findSection(specs, ['Screen Display & Camera', 'Screen Specifications', 'Display Features']);
    if (!s) return null;
    const display = {};
    if (s['Screen Size (Diagonal)']) {
      const m = String(s['Screen Size (Diagonal)']).match(/([\d.]+)/);
      if (m) display.size_in = parseFloat(m[1]);
    }
    if (s['Screen Size in Inches']) {
      const m = String(s['Screen Size in Inches']).match(/([\d.]+)/);
      if (m) display.size_in = parseFloat(m[1]);
    }
    if (s['Screen Resolution'] || s['Resolution']) display.resolution = s['Screen Resolution'] || s['Resolution'];
    if (s['Screen Type'] || s['Display Type']) display.type = s['Screen Type'] || s['Display Type'];
    return Object.keys(display).length > 0 ? display : null;
  }

  extractPerformanceSpecs(specs) {
    const s = this.findSection(specs, ['Phone Hardware & Storage', 'Phone OS', 'Processor Details', 'Os & Processor Features']);
    if (!s) return null;
    const perf = {};
    if (s['Operating System'] || s['OS Name & Version']) perf.operating_system = s['Operating System'] || s['OS Name & Version'];
    if (s['Processor Brand']) perf.processor_brand = s['Processor Brand'];
    if (s['Processor Name'] || s['Processor']) perf.processor_name = s['Processor Name'] || s['Processor'];
    if (s['Processor Type']) perf.processor_chipset = s['Processor Type'];
    if (s['Number of Cores']) perf.processor_cores = s['Number of Cores'];
    return Object.keys(perf).length > 0 ? perf : null;
  }

  extractCameraSpecs(specs) {
    const s = this.findSection(specs, ['Screen Display & Camera', 'Camera', 'Camera Features']);
    if (!s) return null;
    const cam = {};
    if (s['Rear Camera'] || s['Rear Camera Configuration']) cam.rear_setup = s['Rear Camera'] || s['Rear Camera Configuration'];
    if (s['Front Camera'] || s['Front Camera Configuration'] || s['Selfie Camera']) cam.front_setup = s['Front Camera'] || s['Front Camera Configuration'] || s['Selfie Camera'];
    if (s['Video Recording Features']) cam.video_features = s['Video Recording Features'];
    return Object.keys(cam).length > 0 ? cam : null;
  }

  extractBatterySpecs(specs) {
    const s = this.findSection(specs, ['Phone Battery & Charge Time', 'Battery', 'Battery & Power Features']);
    if (!s) return null;
    const out = {};
    if (s['Battery Type']) out.type = s['Battery Type'];
    if (s['Battery Technology']) out.technology = s['Battery Technology'];
    if (s['Battery Capacity']) {
      const m = String(s['Battery Capacity']).match(/(\d+)\s*mAh/i);
      if (m) out.capacity_mah = parseInt(m[1], 10);
    }
    return Object.keys(out).length > 0 ? out : null;
  }

  extractConnectivitySpecs(specs) {
    const s = this.findSection(specs, ['Network & Inter-device Connectivity', 'Phone Network & Inter-device Connectivity', 'Network Connectivity', 'Connectivity Features']);
    if (!s) return null;
    const out = {};
    if (s['Network Type'] || s['Cellular Technology']) out.network_type = s['Network Type'] || s['Cellular Technology'];
    if (s['NFC']) out.nfc = String(s['NFC']).toLowerCase() === 'yes';
    if (s['Wi-Fi Supported']) out.wifi = String(s['Wi-Fi Supported']).toLowerCase() === 'yes';
    if (s['Bluetooth Specifications'] || s['Bluetooth']) out.bluetooth = s['Bluetooth Specifications'] || s['Bluetooth'];
    if (s['Audio Jack'] || s['USB']) out.audio_jack_type = s['Audio Jack'] || s['USB'];
    if (s['5G']) out.supports_5g = String(s['5G']).toLowerCase() === 'yes';
    return Object.keys(out).length > 0 ? out : null;
  }

  extractDesignSpecs(specs) {
    const s = this.findSection(specs, ['Manufacturing & Packing Information', 'Product Dimensions (Open)', 'Dimensions']);
    if (!s) return null;
    const out = {};
    if (s['Weight'] || s['Product Weight'] || s['Net Weight']) {
      const w = String(s['Weight'] || s['Product Weight'] || s['Net Weight']).match(/([\d.]+)/);
      if (w) out.weight_g = parseFloat(w[1]);
    }
    if (s['Dimensions In CM (WxDxH)']) out.dimensions_cm = s['Dimensions In CM (WxDxH)'];
    if (s['Dimensions In Inches (WxDxH)']) out.dimensions_in = s['Dimensions In Inches (WxDxH)'];
    if (s['Item Length'] && s['Item Width'] && s['Item Height']) {
      out.dimensions_cm = `${s['Item Length']} x ${s['Item Width']} x ${s['Item Height']}`;
    }
    return Object.keys(out).length > 0 ? out : null;
  }

  generateCategoryBreadcrumb(product, specs) {
    return ['Electronics', 'Mobiles & Accessories', 'Smartphones & Basic Mobiles', 'Smartphones'];
  }

  // ---------- Methods for Dual Extraction and Validation ----------
  
  // Reset stats for new batch
  resetStats() {
    this.stats = {
      nullBrandCount: 0,
      nullModelCount: 0,
      manualReviewCount: 0,
      totalProcessed: 0
    };
  }

  // Log processing statistics
  logStats() {
    this.logger.info(`=== Reliance Normalizer Statistics ===`);
    this.logger.info(`Total products processed: ${this.stats.totalProcessed}`);
    this.logger.info(`Null brand names: ${this.stats.nullBrandCount} (${(this.stats.nullBrandCount/this.stats.totalProcessed*100).toFixed(1)}%)`);
    this.logger.info(`Null model names: ${this.stats.nullModelCount} (${(this.stats.nullModelCount/this.stats.totalProcessed*100).toFixed(1)}%)`);
    this.logger.info(`Products flagged for manual review: ${this.stats.manualReviewCount} (${(this.stats.manualReviewCount/this.stats.totalProcessed*100).toFixed(1)}%)`);
    this.logger.info(`Success rate - Brands: ${((this.stats.totalProcessed-this.stats.nullBrandCount)/this.stats.totalProcessed*100).toFixed(1)}%, Models: ${((this.stats.totalProcessed-this.stats.nullModelCount)/this.stats.totalProcessed*100).toFixed(1)}%`);
    this.logger.info(`==========================================`);
  }

  // Validate brand extraction with similarity matching
  validateBrandExtraction(specBrand, titleBrand) {
    const cleanSpecBrand = this.standardizeBrand(specBrand);
    const cleanTitleBrand = this.standardizeBrand(titleBrand);

    if (!cleanSpecBrand && !cleanTitleBrand) {
      return null;
    }
    if (!cleanSpecBrand) {
      return cleanTitleBrand;
    }
    if (!cleanTitleBrand) {
      return cleanSpecBrand;
    }

    // Prioritize title brand if it's a known sub-brand
    if (this.knownSubBrands.includes(cleanTitleBrand) && cleanSpecBrand !== cleanTitleBrand) {
      this.logger.info(`Prioritizing title sub-brand '${cleanTitleBrand}' over specs brand '${cleanSpecBrand}'`);
      return cleanTitleBrand;
    }

    // Calculate similarity using levenshtein distance
    const similarity = this.calculateSimilarity(cleanSpecBrand, cleanTitleBrand);
    
    if (similarity >= 90) {
      // Prefer the more complete/standardized version
      return cleanSpecBrand.length >= cleanTitleBrand.length ? cleanSpecBrand : cleanTitleBrand;
    } else {
      this.logger.warn(`Brand mismatch detected: spec='${cleanSpecBrand}', title='${cleanTitleBrand}', similarity=${similarity}% - using title extraction for manual review`);
      return {
        brand_name: 'MANUAL_REVIEW', // For tracking manual review status
        final_brand_name: cleanTitleBrand // Use title-extracted brand name for manual review cases
      };
    }
  }

  // Validate model extraction with model number detection
  validateModelExtraction(specModel, titleModel, specs, chosenBrand) {
    const cleanSpecModel = this.cleanModelName(specModel);
    const cleanTitleModel = this.cleanModelName(titleModel);

    // Check if spec model is actually a model number
    const specModelNumber = this.detectModelNumber(cleanSpecModel);

    let finalModelName = null;
    let finalModelNumber = specModelNumber || null;
    let finalFinalModelName = null; // What actually goes in the output
    
    if (specModelNumber && cleanTitleModel) {
      // If a model number is detected, use title model as the model name, no manual review
      //this.logger.info(`Model number '${specModelNumber}' detected in specs; using title model '${cleanTitleModel}' as model name`);
      finalModelName = cleanTitleModel;
      finalFinalModelName = cleanTitleModel;
    } else if (!cleanSpecModel && !cleanTitleModel) {
      // Both are null - try to extract model name from title as fallback
      const fromTitle = this.extractBrandAndModelFromTitle(this.currentTitle || '');
      const fallbackModel = this.cleanModelName(fromTitle.model);
      if (fallbackModel) {
        finalModelName = fallbackModel;
        finalFinalModelName = fallbackModel;
      } else {
        finalModelName = null;
        finalFinalModelName = null;
      }
    } else if (!cleanSpecModel) {
      finalModelName = cleanTitleModel;
      finalFinalModelName = cleanTitleModel;
    } else if (!cleanTitleModel) {
      finalModelName = cleanSpecModel;
      finalFinalModelName = cleanSpecModel;
    } else {
      // Both exist, use smart similarity that handles brand stripping and 5G normalization
      // Use chosenBrand for stripping, fallback to specs brand if chosenBrand is null or MANUAL_REVIEW
      let brandForStripping = chosenBrand;
      if (!brandForStripping || brandForStripping === 'MANUAL_REVIEW') {
        brandForStripping = this.extractBrandFromSpecs(specs);
        this.logger.warn(`Fallback to specs brand '${brandForStripping}' for model stripping as chosen brand is invalid`);
      }
      const similarity = this.calculateModelSimilarity(cleanSpecModel, cleanTitleModel, brandForStripping);
      
      if (similarity >= 90) {
        finalModelName = this.moreInformative(cleanSpecModel, cleanTitleModel);
        finalFinalModelName = finalModelName;
      } else {
        this.logger.warn(`Model mismatch detected: spec='${cleanSpecModel}', title='${cleanTitleModel}', similarity=${similarity}% - using title extraction for manual review`);
        finalModelName = 'MANUAL_REVIEW';
        finalFinalModelName = cleanTitleModel; // Use title-extracted model name for manual review cases
      }
    }

    return {
      model_name: finalModelName, // For tracking manual review status
      final_model_name: finalFinalModelName, // What actually gets output
      model_number: finalModelNumber
    };
  }

  // Detect if a string is a model number using regex patterns
  detectModelNumber(modelString) {
    if (!modelString || typeof modelString !== 'string') return null;

    // Common mobile model number patterns
    const modelNumberPatterns = [
      /^[A-Z]{2,4}\d{3,4}[A-Z]*$/i,           // CPH2717, E166PD
      /^[A-Z]{2,3}-[A-Z0-9]{5,}$/i,           // SM-F966BDBGINS  
      /^[A-Z]\d{2,4}[A-Z]{0,2}$/i,            // S937BC, P3X
      /^[A-Z]{1,2}\d{1,3}[A-Z]?$/i,           // P55, S24, 10C
      /^[A-Z]+\d+[A-Z]*$/i                    // General alphanumeric
    ];

    for (const pattern of modelNumberPatterns) {
      if (pattern.test(modelString.trim())) {
        return modelString.trim();
      }
    }

    return null;
  }

  // Preprocess model name to remove brand name if present
  preprocessModelName(modelName, brandName) {
    if (!modelName || !brandName) return modelName;
    
    const cleanModel = String(modelName).trim();
    const cleanBrand = String(brandName).toLowerCase().trim();
    
    // Remove brand name from beginning of model name (case insensitive)
    if (cleanModel.toLowerCase().startsWith(cleanBrand)) {
      const withoutBrand = cleanModel.substring(cleanBrand.length).trim();
      return withoutBrand || cleanModel; // Return original if removal results in empty string
    }
    
    return cleanModel;
  }

  // Calculate string similarity percentage (0-100)
  calculateSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    const s1 = str1.toLowerCase().trim();
    const s2 = str2.toLowerCase().trim();
    if (s1 === s2) return 100;
    
    const maxLength = Math.max(s1.length, s2.length);
    if (maxLength === 0) return 100;
    
    const dist = distance(s1, s2);
    const similarity = ((maxLength - dist) / maxLength) * 100;
    return Math.round(similarity);
  }

  // Calculate smart similarity for model names with network suffix normalization
  calculateModelSimilarity(specModel, titleModel, brandName) {
    if (!specModel || !titleModel) return 0;
    
    // Step 1: Strip brand name from both models if present
    let cleanSpecModel = this.stripBrandFromModel(specModel, brandName);
    let cleanTitleModel = this.stripBrandFromModel(titleModel, brandName);
    
    // Step 2: Normalize network suffixes (5G, 4G) for comparison
    const normalizeNetworkSuffix = (model) => {
      return model
        .replace(/\s*(5g)\s*$/i, '') // Remove 5G, 4G, LTE suffixes
        .replace(/\s+/g, ' ')
        .trim();
    };
    
    const normalizedSpec = normalizeNetworkSuffix(cleanSpecModel);
    const normalizedTitle = normalizeNetworkSuffix(cleanTitleModel);
    
    // Step 3: Calculate similarity on normalized versions
    const similarity = this.calculateSimilarity(normalizedSpec, normalizedTitle);
    
    return similarity;
  }

  // Strip brand name from model name more intelligently
  stripBrandFromModel(modelName, brandName) {
    if (!modelName || !brandName) return modelName;
    
    const model = String(modelName).trim();
    const brand = String(brandName).toLowerCase().trim();
    const modelLower = model.toLowerCase();
    
    // Try different brand variations
    const brandVariations = [
      brand,
      brand.replace(/\s+/g, ''), // Remove spaces: "one plus" → "oneplus"
      brand.split(' ')[0] // First word only: "one plus" → "one"
    ];
    
    for (const brandVar of brandVariations) {
      if (modelLower.startsWith(brandVar + ' ') || modelLower.startsWith(brandVar)) {
        const stripped = model.substring(brandVar.length).trim();
        if (stripped) return stripped;
      }
    }
    
    return model;
  }

  // ---------- Utils ----------
  findSection(specs, names) {
    for (const n of names) {
      for (const [sectionName, section] of Object.entries(specs || {})) {
        if (sectionName === n && section && typeof section === 'object') return section;
      }
    }
    return null;
  }

  cleanModelName(modelName) {
    if (!modelName || typeof modelName !== 'string') return null;
    let cleaned = modelName.trim();
    cleaned = cleaned.replace(/\([^)]*\)/g, '').replace(/,[^,]*$/g, ' ').replace(/\s+/g, ' ').trim();
    return cleaned || null;
  }

  standardizeBrand(brand) {
    if (!brand || typeof brand !== 'string') return null;
    const map = {
      'samsung': 'Samsung',
      'apple': 'Apple',
      'xiaomi': 'Xiaomi',
      'redmi': 'Redmi',
      'oneplus': 'OnePlus',
      'one plus': 'OnePlus',
      'realme': 'Realme',
      'vivo': 'Vivo',
      'oppo': 'Oppo',
      'poco': 'POCO',
      'tecno': 'Tecno',
      'motorola': 'Motorola',
      'moto': 'Motorola',
      'nokia': 'Nokia',
      'nothing': 'Nothing'
    };
    const key = brand.toLowerCase();
    return map[key] || brand;
  }

  // Prefer the string with more tokens/characters (basic heuristic)
  moreInformative(a, b) {
    const sa = String(a || '').trim();
    const sb = String(b || '').trim();
    const score = (s) => (s.split(/\s+/).length * 10) + s.length;
    return score(sa) >= score(sb) ? sa : sb;
  }

  // Basic validity check for model names (avoid generic terms)
  isValidModelName(modelName) {
    if (!modelName || typeof modelName !== 'string') return false;
    const trimmed = modelName.trim();
    if (trimmed.length < 2) return false;
    const invalid = new Set([
      'product information', 'mobile phone information', 'smartphone', 'mobile phone', 'phone', 'mobile'
    ]);
    return !invalid.has(trimmed.toLowerCase());
  }

  // IO helpers
  async normalizeFromFile(filePath) {
    const rawData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const normalized = this.normalizeProducts(rawData);
    return { normalized };
  }

  async saveNormalizedData(normalizedData, outputPath) {
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(normalizedData, null, 2));
    this.logger.info(`Saved normalized Reliance data to ${outputPath}`);
  }
}

module.exports = RelianceNormalizer;

// CLI
if (require.main === module) {
  (async () => {
    try {
      logger.info('🚀 Starting Reliance Normalizer...');
      const inputPath = path.join(__dirname, '../scrapers/reliance/reliance_raw.json');
      const outputPath = path.join(__dirname, '../../parsed_data/reliance_normalized_data.json');
      if (!fs.existsSync(inputPath)) {
        logger.error(`❌ Input file not found: ${inputPath}`);
        process.exit(1);
      }
      const normalizer = new RelianceNormalizer();
      const { normalized } = await normalizer.normalizeFromFile(inputPath);
      await normalizer.saveNormalizedData(normalized, outputPath);
      logger.info(`✅ Reliance normalization completed. Products: ${normalized.length}`);
    } catch (err) {
      logger.error(`❌ Reliance normalization failed: ${err.message}`);
      process.exit(1);
    }
  })();
}