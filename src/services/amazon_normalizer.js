const fs = require('fs');
const path = require('path');
const { createLogger } = require('../utils/logger'); // Assuming your logger

const logger = createLogger('AmazonNormalizer');

function normalizeAmazonProduct(raw) {
  if (!raw) {
    logger.warn('Received null or undefined product');
    return null;
  }

  const specs = raw.specifications || {};
  const title = raw.title || '';

  // Helper to extract number from string (e.g., "4 GB" -> 4)
  const extractNumber = (str) => {
    if (!str || typeof str !== 'string') return null;
    const match = str.match(/[\d.]+/);
    return match ? parseFloat(match[0]) : null;
  };

  // Parse model and color from title (common pattern: "Model (Color, RAM, Storage)")
  const titleParts = title.match(/^(.*?) \((.*?)\)/) || [];
  const model = titleParts[1]?.trim() || specs['Item model number'] || 'Unknown';
  const variantStr = titleParts[2] || '';
  
  // Safely extract color
  const color = typeof variantStr === 'string' && variantStr.match(/(\w+ Green|\w+ Blue|\w+ Black|\w+ White|\w+ Red|\w+)/i)?.[0]?.toLowerCase() || 
                (typeof specs['Colour'] === 'string' ? specs['Colour'].toLowerCase() : null);

  // Extract category (often from title or features; default to 'Smartphones' based on data)
  const category = typeof specs['Generic Name'] === 'string' ? specs['Generic Name'].toLowerCase() : 'smartphones'; // Adjust based on analysis

  // Standardize attributes
  const attributes = {
    color,
    storage_gb: extractNumber(specs['Memory Storage Capacity'] || variantStr) || null,
    ram_gb: extractNumber(specs['RAM Memory Installed Size'] || specs['RAM'] || variantStr) || null,
    // Add more as needed (e.g., battery: extractNumber(specs['Battery Power Rating']))
  };

  // Extract price (often in features; placeholder if not direct)
  const price = extractNumber(specs['Feature 1'] || specs['Feature 2'] || '') || null; // Enhance if price is in title/features

  // Extract review count safely
  let reviewCount = 0;
  if (typeof specs['Customer Reviews'] === 'string') {
    const reviewMatch = specs['Customer Reviews'].match(/(\d+) ratings/);
    reviewCount = reviewMatch ? parseInt(reviewMatch[1]) : 0;
  }

  // Collect normalized data (no DB integration)
  return {
    brand: typeof specs['Brand'] === 'string' ? specs['Brand'].trim().toLowerCase() : 'unknown',
    model,
    category,
    attributes,
    price,
    store_name: 'amazon',
    store_product_id: specs['ASIN'] || (typeof raw.url === 'string' ? raw.url.split('/dp/')?.[1]?.split('/')[0] : null) || null,
    currency: specs['Currency'] || 'INR',
    url: raw.url,
    stock_status: 'unknown', // Enhance if available
    rating: extractNumber(specs['Customer Reviews']) || null,
    review_count: reviewCount,
    scraped_at: new Date().toISOString(),
  };
}

async function main() {
  try {
    const inputPath = path.join(__dirname, '../scrapers/amazon_scraped_data.json');
    const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

    const normalizedData = [];
    let success = 0, failed = 0;
    for (const item of data) {
      try {
        const normalized = normalizeAmazonProduct(item);
        if (normalized) { // Only push if normalization was successful
          normalizedData.push(normalized);
          success++;
        } else {
          failed++;
        }
      } catch (err) {
        logger.error(`Failed to normalize product: ${item.title || 'unknown'} - ${err.message}`);
        failed++;
      }
    }

    // Save to output file with pretty-printing
    const outputPath = path.join(__dirname, '../scrapers/normalized_amazon_data.json');
    fs.writeFileSync(outputPath, JSON.stringify(normalizedData, null, 2), 'utf8');

    logger.info(`Normalization complete: ${success} successful, ${failed} failed out of ${data.length}. Saved to ${outputPath}`);
  } catch (err) {
    logger.error(`Error in main: ${err.message}`);
  }
}

if (require.main === module) {
  main();
}

module.exports = { normalizeAmazonProduct }; 