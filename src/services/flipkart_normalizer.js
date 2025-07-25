const fs = require('fs');
const path = require('path');
const { createLogger } = require('../utils/logger'); // Assuming your logger

const logger = createLogger('FlipkartNormalizer');

function normalizeFlipkartProduct(raw) {
  if (!raw || !raw.title) {
    logger.warn(`Skipping product with missing title: ${raw.url}`);
    return null;
  }

  const specs = raw.specifications || {};
  const title = raw.title || '';
  const priceInfo = raw.price || {};
  const highlights = raw.highlights || [];

  // Helper to extract number from string (e.g., "4 GB" -> 4)
  const extractNumber = (str) => {
    if (!str) return null;
    const matches = str.toString().match(/\d+(\.\d+)?/);
    return matches ? parseFloat(matches[0]) : null;
  };

  // Helper to clean price (e.g., "₹12,999" -> 12999)
  const cleanPrice = (priceStr) => {
    if (!priceStr) return null;
    const matches = priceStr.toString().match(/[\d,]+/);
    return matches ? parseFloat(matches[0].replace(/,/g, '')) : null;
  };

  // Extract brand from title or specifications
  let brand = specs['Brand'] || null;
  if (!brand) {
    // Try to extract brand from title (usually first word)
    const brandMatch = title.match(/^(\w+)/);
    brand = brandMatch ? brandMatch[1] : null;
  }

  // Extract model name/number
  let model = specs['Model Name'] || specs['Model Number'] || null;
  if (!model && title) {
    // Remove brand from title if found
    let modelName = title;
    if (brand) {
      modelName = modelName.replace(new RegExp(`^${brand}\\s+`, 'i'), '');
    }
    // Extract model name (usually after brand and before parentheses)
    const modelMatch = modelName.match(/^([^(]+)/);
    model = modelMatch ? modelMatch[1].trim() : modelName;
  }

  // Extract RAM
  let ramGB = null;
  if (specs['RAM']) {
    ramGB = extractNumber(specs['RAM']);
  } else {
    // Try to find RAM in title or highlights
    const ramRegex = /(\d+)\s*GB\s*RAM/i;
    const titleRamMatch = title.match(ramRegex);
    if (titleRamMatch) {
      ramGB = parseInt(titleRamMatch[1]);
    } else {
      // Look in highlights
      for (const highlight of highlights) {
        const highlightRamMatch = highlight.match(ramRegex);
        if (highlightRamMatch) {
          ramGB = parseInt(highlightRamMatch[1]);
          break;
        }
      }
    }
  }

  // Extract storage
  let storageGB = null;
  if (specs['Internal Storage']) {
    storageGB = extractNumber(specs['Internal Storage']);
  } else {
    // Try to find storage in title or highlights
    const storageRegex = /(\d+)\s*GB\s*(ROM|Storage)/i;
    const titleStorageMatch = title.match(storageRegex);
    if (titleStorageMatch) {
      storageGB = parseInt(titleStorageMatch[1]);
    } else {
      // Look in highlights
      for (const highlight of highlights) {
        const highlightStorageMatch = highlight.match(storageRegex);
        if (highlightStorageMatch) {
          storageGB = parseInt(highlightStorageMatch[1]);
          break;
        }
      }
    }
  }

  // Extract color
  let color = specs['Color'] || null;
  if (!color) {
    // Try to extract color from title (often in parentheses)
    const colorRegex = /\(([^,)]+)(,|\))/;
    const colorMatch = title.match(colorRegex);
    color = colorMatch ? colorMatch[1].trim() : null;
  }

  // Extract OS
  const os = specs['Operating System'] || null;

  // Extract display size
  let displayInches = null;
  if (specs['Display Size']) {
    const displayMatch = specs['Display Size'].match(/(\d+(\.\d+)?)\s*cm\s*\((\d+(\.\d+)?)\s*inch\)/);
    displayInches = displayMatch ? parseFloat(displayMatch[3]) : extractNumber(specs['Display Size']);
  }

  // Extract camera info
  let primaryCamera = specs['Primary Camera'] || null;
  let secondaryCamera = specs['Secondary Camera'] || null;
  let cameraMP = null;

  if (primaryCamera) {
    const mpMatch = primaryCamera.match(/(\d+)\s*MP/i);
    cameraMP = mpMatch ? parseInt(mpMatch[1]) : null;
  }

  // Extract battery capacity
  let batteryMAh = null;
  if (specs['Battery Capacity']) {
    batteryMAh = extractNumber(specs['Battery Capacity']);
  }

  // Extract price
  const price = cleanPrice(priceInfo.current);

  // Construct normalized product object
  const normalized = {
    source: 'flipkart',
    url: raw.url,
    title,
    brand,
    model,
    color,
    os,
    ram_gb: ramGB,
    storage_gb: storageGB,
    display_inches: displayInches,
    camera_mp: cameraMP,
    battery_mah: batteryMAh,
    price,
    original_price: cleanPrice(priceInfo.original),
    discount: priceInfo.discount,
    rating: raw.rating ? raw.rating.score : null,
    rating_count: raw.rating ? extractNumber(raw.rating.count) : null,
    specifications: specs,
    highlights,
    images: raw.images || {},
    variants: raw.variants || {}
  };

  return normalized;
}

async function normalizeFlipkartData() {
  try {
    // Load Flipkart scraped data
    const inputPath = path.join(__dirname, '../scrapers/flipkart/flipkart_scraped_data.json');
    
    // Check if file exists
    if (!fs.existsSync(inputPath)) {
      logger.error(`Input file not found: ${inputPath}`);
      throw new Error(`Input file not found: ${inputPath}`);
    }
    
    const outputPath = path.join(__dirname, '../scrapers/normalized_flipkart_data.json');
    
    logger.info(`Reading Flipkart data from ${inputPath}`);
    const rawData = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
    
    logger.info(`Found ${rawData.length} products to normalize`);
    
    // Normalize each product
    const normalizedData = rawData
      .map(product => normalizeFlipkartProduct(product))
      .filter(product => product !== null);
    
    logger.info(`Successfully normalized ${normalizedData.length} products`);
    
    // Save normalized data
    fs.writeFileSync(outputPath, JSON.stringify(normalizedData, null, 2));
    logger.info(`Normalized data saved to ${outputPath}`);
    
    return normalizedData;
  } catch (error) {
    logger.error(`Error normalizing Flipkart data: ${error.message}`);
    throw error;
  }
}

// Run if executed directly
if (require.main === module) {
  normalizeFlipkartData()
    .then(() => logger.info('Flipkart normalization completed'))
    .catch(err => {
      logger.error(`Flipkart normalization failed: ${err.message}`);
      process.exit(1);
    });
}

module.exports = {
  normalizeFlipkartProduct,
  normalizeFlipkartData
}; 