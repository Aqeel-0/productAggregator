const fs = require('fs');
const path = require('path');

class RelianceValidator {
  constructor() {
    this.thresholds = {
      price_current: 0.15,
      brand: 0.20,
      model: 0.20,
      images: 0.10,
      ram: 0.25,
    };
  }

  validate(filePath) {
    if (!fs.existsSync(filePath)) return { success: false, error: 'File not found' };

    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!Array.isArray(data) || data.length === 0) return { success: false, error: 'Empty or invalid data' };

    let missing = { price_current: 0, brand: 0, model: 0, images: 0, ram: 0 };
    let total = data.length;

    data.forEach(item => {
      if (!item.listing_info?.price?.current) missing.price_current++;
      if (!item.product_identifiers?.brand || item.product_identifiers.brand === 'Unknown') missing.brand++;
      if (!item.product_identifiers?.model_name || item.product_identifiers.model_name === 'Unknown') missing.model++;
      if (!item.listing_info?.image_url && (!item.listing_info?.image_urls || item.listing_info.image_urls.length === 0)) missing.images++;
      
      const isApple = item.product_identifiers?.brand && item.product_identifiers.brand.toLowerCase() === 'apple';
      if (!isApple && !item.variant_attributes?.ram) {
        missing.ram++;
      }
    });

    let warnings = [];
    let isFailed = false;

    for (const [key, maxPct] of Object.entries(this.thresholds)) {
      const pct = missing[key] / total;
      if (pct > maxPct) {
        warnings.push(`High missing rate for ${key}: ${(pct * 100).toFixed(1)}%`);
        isFailed = true;
      }
    }

    return {
      success: !isFailed,
      total,
      missing,
      warnings
    };
  }
}

if (require.main === module) {
  const filePath = process.argv[2] || path.join(__dirname, '../../../parsed_data/reliance_normalized_data.json');
  const validator = new RelianceValidator();
  const result = validator.validate(filePath);
  console.log(JSON.stringify(result, null, 2));
  if (!result.success) process.exit(1);
}

module.exports = RelianceValidator;
