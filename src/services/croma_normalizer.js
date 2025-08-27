const fs = require('fs');
const path = require('path');

// Try to import logger, fall back to console if not available
let logger;
try {
  const { createLogger } = require('../utils/logger');
  logger = createLogger('croma_normalizer');
} catch (e) {
  logger = console;
}

class CromaNormalizer {
  constructor() {
    this.logger = logger;
    this.missingCounts = this._initializeMissingCounts();
  }

  _initializeMissingCounts() {
    return {
      source_details: { url: 0 },
      product_identifiers: { brand: 0, model_name: 0, original_title: 0, model_number: 0 },
      variant_attributes: { color: 0, ram: 0, storage: 0 },
      listing_info: {
        price_current: 0,
        price_original: 0,
        price_discount_percent: 0,
        rating_score: 0,
        rating_count: 0,
        availability: 0,
        image_url: 0,
        image_urls: 0
      },
      key_specifications: {
        display: 0,
        performance: 0,
        camera: 0,
        battery: 0,
        connectivity: 0,
        design: 0
      },
      source_metadata: { category_breadcrumb: 0 },
      products_processed: 0
    };
  }

  normalizeProducts(products) {
    const normalized = [];

    for (const product of products) {
      try {
        const normalizedProduct = this.normalizeProduct(product);
        normalized.push(normalizedProduct);
      } catch (error) {
        this.logger.error(`Error normalizing product: ${error.message}`);
      }
    }

    return { normalized, missingSummary: this.missingCounts };
  }

  normalizeProduct(product) {
    this.missingCounts.products_processed += 1;

    // Skip products with null or empty title (corrupted data)
    if (!product.title || product.title.trim() === '') {
      this._inc('product_identifiers', 'original_title');
      throw new Error('Product has null or empty title - skipping');
    }

    const specs = product.specifications || {};

    // Keep current title for regex-based extractions
    this.currentTitle = product.title;

    const source_details = {
      source_name: 'croma',
      url: product.url || null,
      scraped_at_utc: product.extractedAt || new Date().toISOString()
    };
    if (!source_details.url) this._inc('source_details', 'url');

    const product_identifiers = {
      brand: this.extractBrandFromSpecsOrTitle(specs, product.title),
      //...this.generateDualModelNamesForCroma(this.extractModelName(specs, product.title), product.title, specs),
      model_name: this.extractModelName(specs, product.title),
      original_title: product.title || null,
      model_number: this.extractModelNumber(specs)
    };
    this._countMissing(product_identifiers, 'product_identifiers');

    const variant_attributes = {
      color: this.extractColor(specs, product.title),
      ram: this.extractRAM(specs, product.title), // Will be raw string like "6GB" or null
      storage: this.extractStorage(specs, product.title) // Will be raw string like "128GB" or "1TB" or null
    };
    this._countMissing(variant_attributes, 'variant_attributes');

    const listing_info = {
      price: this.normalizePrice(product.price),
      availability: null, // Not reliably available in Croma scraped data
      rating: this.normalizeRating(product.rating),
      image_url: product.image && !product.image.includes('video_thumbnail') ? product.image : null,
      image_urls: Array.isArray(product.allImages) ? this._dedupe(product.allImages) : []
    };
    if (listing_info.image_url === null) this._inc('listing_info', 'image_url');
    if (!listing_info.image_urls || listing_info.image_urls.length === 0) this._inc('listing_info', 'image_urls');
    if (listing_info.price.current === null) this._inc('listing_info', 'price_current');
    if (listing_info.price.original === null) this._inc('listing_info', 'price_original');
    if (listing_info.price.discount_percent === null) this._inc('listing_info', 'price_discount_percent');
    if (listing_info.rating.score === null) this._inc('listing_info', 'rating_score');
    if (listing_info.rating.count === null) this._inc('listing_info', 'rating_count');
    if (listing_info.availability === null) this._inc('listing_info', 'availability');

    const key_specifications = {
      display: this.extractDisplaySpecs(specs),
      performance: this.extractPerformanceSpecs(specs),
      camera: this.extractCameraSpecs(specs),
      battery: this.extractBatterySpecs(specs),
      connectivity: this.extractConnectivitySpecs(specs),
      design: this.extractDesignSpecs(specs)
    };
    for (const [k, v] of Object.entries(key_specifications)) {
      if (v === null) this._inc('key_specifications', k);
    }

    const source_metadata = {
      category_breadcrumb: this.generateCategoryBreadcrumb(product, specs)
    };
    if (!source_metadata.category_breadcrumb || source_metadata.category_breadcrumb.length === 0) {
      this._inc('source_metadata', 'category_breadcrumb');
    }

    return {
      source_details,
      product_identifiers,
      variant_attributes,
      listing_info,
      key_specifications,
      source_metadata
    };
  }

  // ---------- Helpers ----------
  _inc(section, field) {
    if (this.missingCounts[section] && Object.prototype.hasOwnProperty.call(this.missingCounts[section], field)) {
      this.missingCounts[section][field] += 1;
    }
  }

  _countMissing(obj, section) {
    for (const [key, value] of Object.entries(obj)) {
      if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
        this._inc(section, key);
      }
    }
  }

  _dedupe(arr) {
    const seen = new Set();
    const out = [];
    for (const url of arr) {
      if (!url || typeof url !== 'string') continue;
      
      // Filter out video thumbnail images
      if (url.includes('video_thumbnail')) {
        continue;
      }
      
      if (!seen.has(url)) {
        seen.add(url);
        out.push(url);
      }
    }
    return out;
  }

  // Convert capacity strings like "128 GB", "1 TB", "512MB" to integer GB
  _toGbNumber(val) {
    if (val === null || val === undefined) return null;
    if (typeof val === 'number') return Number.isNaN(val) ? null : Math.round(val);
    const s = String(val).trim();
    const numMatch = s.match(/([\d]+(?:\.[\d]+)?)/);
    if (!numMatch) return null;
    const num = parseFloat(numMatch[1]);
    if (Number.isNaN(num)) return null;
    const lower = s.toLowerCase();
    if (lower.includes('tb')) return Math.round(num * 1024);
    if (lower.includes('mb')) return Math.round(num / 1024);
    return Math.round(num); // default GB
  }

  // ---------- Extractors ----------
  extractBrandFromSpecsOrTitle(specs, title) {
    // Only from specs, no title fallback
    const rawBrand = specs?.['Manufacturer Details']?.['Brand'] || null;
    if (!rawBrand) return null;
    const brandStr = String(rawBrand);
    // If brand appears like "Realme | Realme", keep only the part before '|'
    const cleaned = brandStr.split('|')[0].trim();
    return cleaned || brandStr.trim();
  }

  extractModelName(specs, title) {
    // Only from specs, no title fallback
    return specs?.['Manufacturer Details']?.['Model Series'] || null;
  }

  // Generate base and 4G/5G variant names following Amazon logic
  generateDualModelNamesForCroma(modelFromSpecs, title, specs) {
    const base = this._cleanModelName(modelFromSpecs);
    const titleStr = title || '';
    const networkField = specs?.['Network Connectivity']?.['Cellular Technology']
      || specs?.['Network Connectivity']?.['Network Technology']
      || specs?.['Connectivity Features']?.['Cellular Technology']
      || specs?.['Connectivity Features']?.['Network Technology']
      || '';

    const has5gInModel = this._contains5G(base);
    const has4gInModel = this._contains4G(base);
    const has5gInTitle = /\b5g\b/i.test(titleStr);
    const has4gInTitle = /\b4g\b/i.test(titleStr);
    const has5gInSpecs = /\b5g\b/i.test(String(networkField));
    const has4gInSpecs = /\b4g\b/i.test(String(networkField));

    // Case 1: Model already includes 4G/5G → also create base without suffix
    if (base && (has5gInModel || has4gInModel)) {
      const without = has5gInModel ? this._remove5G(base) : this._remove4G(base);
      return { model_name: without || base, model_name_with_5g: base };
    }

    // Determine desired suffix from title/specs if not in model
    let desiredSuffix = null;
    if (has5gInTitle || has5gInSpecs) desiredSuffix = '5G';
    else if (has4gInTitle || has4gInSpecs) desiredSuffix = '4G';

    if (!base) {
      return { model_name: null, model_name_with_5g: null };
    }

    if (desiredSuffix === '5G') {
      return { model_name: base, model_name_with_5g: `${base} 5G` };
    }
    if (desiredSuffix === '4G') {
      return { model_name: base, model_name_with_5g: `${base} 4G` };
    }

    // No signals → default to base and a 5G variant (keeps parity with Amazon logic)
    return { model_name: base, model_name_with_5g: `${base} 5G` };
  }

  _cleanModelName(name) {
    if (!name || typeof name !== 'string') return null;
    let cleaned = name.trim();
    // Remove trailing commas/parentheticals/colors
    cleaned = cleaned.replace(/\([^)]*\)/g, ' ').replace(/,[^,]*$/g, ' ').replace(/\s+/g, ' ').trim();
    return cleaned || null;
  }

  _contains4G(s) { return !!(s && /\b4g\b/i.test(s)); }
  _contains5G(s) { return !!(s && /\b5g\b/i.test(s)); }
  _remove4G(s) { return s ? s.replace(/\b4g\b/i, '').replace(/\s+/g, ' ').trim() : s; }
  _remove5G(s) { return s ? s.replace(/\b5g\b/i, '').replace(/\s+/g, ' ').trim() : s; }

  extractModelNumber(specs) {
    return specs?.['Manufacturer Details']?.['Model Number'] || null;
  }

  extractColor(specs, title) {
    // Only from specs, no title fallback
    const brandColor = specs?.['Aesthetics']?.['Brand Color'];
    const aestheticColor = specs?.['Aesthetics']?.['Color'];
    
    // Prefer Brand Color as it's more descriptive (e.g., "Majestic Green" vs "GREEN")
    if (brandColor && brandColor !== aestheticColor) return brandColor;
    if (aestheticColor) return aestheticColor;
    
    return null;
  }

  extractRAM(specs, title) {
    // Only from specs, no title fallback
    const ramFromSpecs = specs?.['Storage Specifications']?.['RAM'];
    if (ramFromSpecs) return this._toGbNumber(ramFromSpecs);
    
    // Check other sections
    const groups = [
      specs?.['Memory Specifications'],
      specs?.['Memory & Storage Features'], 
      specs?.['Performance Features']
    ];
    for (const g of groups) {
      const ramStr = g?.['RAM'] || g?.['Memory (RAM)'];
      if (ramStr) return this._toGbNumber(ramStr);
    }
    
    return null;
  }

  extractStorage(specs, title) {
    // Only from specs, no title fallback
    const storageStr = specs?.['Storage Specifications']?.['Internal Storage'];
    if (storageStr) return this._toGbNumber(storageStr);
    
    // Check other sections
    const altStorageStr = specs?.['Memory & Storage Features']?.['Internal Storage'];
    if (altStorageStr) return this._toGbNumber(altStorageStr);
    
    return null;
  }

  normalizePrice(price) {
    // Helper to parse a price value to integer rupees
    const toNumber = (val) => {
      if (val === null || val === undefined) return null;
      if (typeof val === 'number') {
        return Number.isNaN(val) ? null : Math.round(val);
      }
      if (typeof val === 'string') {
        // Remove currency symbols and formatting, keep digits and decimal
        const cleaned = val.replace(/,/g, '').replace(/[^\d.]/g, '');
        if (!cleaned) return null;
        const n = parseFloat(cleaned);
        return Number.isNaN(n) ? null : Math.round(n);
      }
      return null;
    };

    if (!price) {
      return { current: null, original: null, discount_percent: null, currency: 'INR' };
    }

    const current = toNumber(price.current);
    const original = toNumber(price.original);

    let discountPercent = null;
    if (price.discount && typeof price.discount === 'string') {
      const m = price.discount.match(/(\d+)\s*%/);
      if (m) discountPercent = parseInt(m[1], 10);
    }
    if (discountPercent === null && typeof price.discount_percent === 'number') {
      discountPercent = Math.round(price.discount_percent);
    }
    if (discountPercent === null && current !== null && original !== null && original > 0 && current <= original) {
      discountPercent = Math.round(((original - current) / original) * 100);
    }

    return { current, original, discount_percent: discountPercent, currency: 'INR' };
  }

  normalizeRating(rating) {
    if (!rating) return { score: null, count: null };
    let score = null;
    let count = null;
    
    // Handle star rating (convert "Not Available" to null)
    if (rating.star && rating.star !== 'Not Available') {
      const n = parseFloat(String(rating.star).replace(/,/g, ''));
      score = Number.isNaN(n) ? null : n;
    }
    
    // Handle rating/review count (convert "Not Available" to null)
    if (rating.rating && rating.rating !== 'Not Available') {
      const n = parseInt(String(rating.rating).replace(/\D/g, ''), 10);
      count = Number.isNaN(n) ? null : n;
    } else if (rating.reviews && rating.reviews !== 'Not Available') {
      const n = parseInt(String(rating.reviews).replace(/\D/g, ''), 10);
      count = Number.isNaN(n) ? null : n;
    }
    
    return { score, count };
  }

  extractDisplaySpecs(specs) {
    const s = specs?.['Screen Specifications'] || specs?.['Display Features'] || null;
    if (!s) return null;
    const display = {};
    if (s['Screen Size in Inches']) {
      const m = String(s['Screen Size in Inches']).match(/([\d.]+)/);
      if (m) display.size_in = parseFloat(m[1]);
    }
    if (s['Screen Resolution'] || s['Resolution']) {
      display.resolution = s['Screen Resolution'] || s['Resolution'];
    }
    if (s['Screen Type'] || s['Display Type']) {
      display.type = s['Screen Type'] || s['Display Type'];
    }
    if (s['Brightness']) {
      const n = parseInt(String(s['Brightness']).replace(/\D/g, ''), 10);
      if (!Number.isNaN(n)) display.brightness_nits = n;
    }
    return Object.keys(display).length > 0 ? display : null;
  }

  extractPerformanceSpecs(specs) {
    const s = specs?.['Processor Details'] || specs?.['Os & Processor Features'] || null;
    if (!s) return null;
    const perf = {};
    if (s['Operating System']) perf.operating_system = s['Operating System'];
    if (s['OS Name & Version']) perf.operating_system = s['OS Name & Version'];
    if (s['Processor Brand']) perf.processor_brand = s['Processor Brand'];
    if (s['Processor Name']) perf.processor_name = s['Processor Name'];
    if (s['Processor Type']) perf.processor_chipset = s['Processor Type'];
    if (s['Number of Cores']) perf.processor_cores = s['Number of Cores'];
    return Object.keys(perf).length > 0 ? perf : null;
  }

  extractCameraSpecs(specs) {
    const s = specs?.['Camera'] || specs?.['Camera Features'] || null;
    if (!s) return null;
    const cam = {};
    if (s['Rear Camera'] || s['Rear Camera Configuration']) cam.rear_setup = s['Rear Camera'] || s['Rear Camera Configuration'];
    if (s['Front Camera'] || s['Front Camera Configuration']) cam.front_setup = s['Front Camera'] || s['Front Camera Configuration'];
    if (s['Video Recording Features']) cam.video_features = s['Video Recording Features'];
    return Object.keys(cam).length > 0 ? cam : null;
  }

  extractBatterySpecs(specs) {
    const b = specs?.['Battery'] || specs?.['Battery & Power Features'] || null;
    if (!b) return null;
    const out = {};
    if (b['Battery Type']) out.type = b['Battery Type'];
    if (b['Battery Technology']) out.technology = b['Battery Technology'];
    if (b['Battery Capacity']) {
      const m = String(b['Battery Capacity']).match(/(\d+)\s*mAh/i);
      if (m) out.capacity_mah = parseInt(m[1], 10);
    }
    return Object.keys(out).length > 0 ? out : null;
  }

  extractConnectivitySpecs(specs) {
    const n = specs?.['Network Connectivity'] || specs?.['Connectivity Features'] || null;
    if (!n) return null;
    const out = {};
    if (n['Network Type'] || n['Cellular Technology']) {
      out.network_type = n['Network Type'] || n['Cellular Technology'];
    }
    if (n['NFC']) out.nfc = String(n['NFC']).toLowerCase() === 'yes';
    if (n['Wi-Fi Supported']) out.wifi = String(n['Wi-Fi Supported']).toLowerCase() === 'yes';
    if (n['Bluetooth Specifications']) out.bluetooth = n['Bluetooth Specifications'];
    if (n['Audio Jack']) out.audio_jack_type = n['Audio Jack'];
    return Object.keys(out).length > 0 ? out : null;
  }

  extractDesignSpecs(specs) {
    const d = specs?.['Product Dimensions (Open)'] || specs?.['Dimensions'] || null;
    if (!d) return null;
    const out = {};
    if (d['Weight'] || d['Product Weight']) {
      const w = String(d['Weight'] || d['Product Weight']).match(/([\d.]+)/);
      if (w) out.weight_g = parseFloat(w[1]);
    }
    if (d['Dimensions In CM (WxDxH)']) out.dimensions_cm = d['Dimensions In CM (WxDxH)'];
    if (d['Dimensions In Inches (WxDxH)']) out.dimensions_in = d['Dimensions In Inches (WxDxH)'];
    return Object.keys(out).length > 0 ? out : null;
  }

  generateCategoryBreadcrumb(product, specs) {
    // Try precise category if available
    const cat = product.categories || null;
    if (cat && typeof cat === 'string') {
      if (cat.toLowerCase().includes('smartphone')) {
        return ['Electronics', 'Mobiles & Accessories', 'Smartphones & Basic Mobiles', 'Smartphones'];
      }
    }
    const mobileType = specs?.['Mobile Category']?.['Mobile Type'];
    if (mobileType && String(mobileType).toLowerCase().includes('smartphone')) {
      return ['Electronics', 'Mobiles & Accessories', 'Smartphones & Basic Mobiles', 'Smartphones'];
    }
    // Default
    return ['Electronics', 'Mobiles & Accessories', 'Smartphones & Basic Mobiles', 'Smartphones'];
  }

  // ---------- IO helpers ----------
  async normalizeFromFile(filePath) {
    const rawData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const { normalized, missingSummary } = this.normalizeProducts(rawData);
    return { normalized, missingSummary };
  }

  async saveNormalizedData(normalizedData, outputPath) {
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    fs.writeFileSync(outputPath, JSON.stringify(normalizedData, null, 2));
    this.logger.info(`Saved normalized Croma data to ${outputPath}`);
  }
}

module.exports = CromaNormalizer;

// CLI
if (require.main === module) {
  (async () => {
    try {
      logger.info('🚀 Starting Croma Normalizer...');
      const inputPath = path.join(__dirname, '../scrapers/croma/croma_scraped_data.json');
      const outputPath = path.join(__dirname, '../../parsed_data/croma_normalized_data.json');
      logger.info(`📁 Input: ${inputPath}`);
      logger.info(`📁 Output: ${outputPath}`);

      if (!fs.existsSync(inputPath)) {
        logger.error(`❌ Input file not found: ${inputPath}`);
        process.exit(1);
      }

      const normalizer = new CromaNormalizer();
      const { normalized, missingSummary } = await normalizer.normalizeFromFile(inputPath);
      await normalizer.saveNormalizedData(normalized, outputPath);

      // Print missing summary
      logger.info('📊 Missing values summary:');
      logger.info(JSON.stringify(missingSummary, null, 2));

      logger.info(`✅ Croma normalization completed. Products: ${normalized.length}`);
    } catch (err) {
      logger.error(`❌ Croma normalization failed: ${err.message}`);
      process.exit(1);
    }
  })();
}


