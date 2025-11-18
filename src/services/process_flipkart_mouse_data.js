/**
 * Process Flipkart Mouse Data
 * Processes all Flipkart mouse data and saves normalized results
 */

const fs = require('fs');
const path = require('path');
const FlipkartMouseNormalizer = require('./flipkart_mouse_normalizer');

// Function to read and parse JSON file
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

// Function to process all Flipkart mouse data
async function processFlipkartMouseData() {
  console.log('Processing Flipkart Mouse Data...\n');
  
  // Define file paths
  const inputFilePath = path.join(__dirname, '..', 'scrapers', 'flipkart', 'raw_data', 'flipkart_mouse_scraped_data.json');
  const outputFilePath = path.join(__dirname, '..', '..', 'parsed_data', 'flipkart_mouse_normalized_data.json');
  
  // Read the Flipkart mouse data file
  console.log('Reading Flipkart mouse data...');
  const rawData = readJsonFile(inputFilePath);
  
  if (!rawData || !Array.isArray(rawData)) {
    console.error('Could not read Flipkart mouse data or data is not an array');
    return;
  }
  
  console.log(`Found ${rawData.length} products in the data file.`);
  
  // Process all products
  console.log('Normalizing product data...');
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
  
  // Generate statistics
  console.log('\n=== PROCESSING STATISTICS ===');
  generateStatistics(normalizedData);
  
  console.log('\nProcessing complete!');
}

// Function to generate statistics from normalized data
function generateStatistics(normalizedData) {
  if (!Array.isArray(normalizedData) || normalizedData.length === 0) {
    console.log('No data to generate statistics for');
    return;
  }
  
  // Brand statistics
  const brandCounts = {};
  let brandsFound = 0;
  let modelsFound = 0;
  let modelNumbersFound = 0;
  let pricesFound = 0;
  let ratingsFound = 0;
  
  normalizedData.forEach(product => {
    // Count brands
    if (product.brand && product.brand !== 'Unknown') {
      brandsFound++;
      brandCounts[product.brand] = (brandCounts[product.brand] || 0) + 1;
    }
    
    // Count models
    if (product.modelName) {
      modelsFound++;
    }
    
    // Count model numbers
    if (product.modelNumber) {
      modelNumbersFound++;
    }
    
    // Count prices
    if (product.price) {
      pricesFound++;
    }
    
    // Count ratings
    if (product.rating) {
      ratingsFound++;
    }
  });
  
  console.log(`Total Products: ${normalizedData.length}`);
  console.log(`Brands Found: ${brandsFound} (${((brandsFound / normalizedData.length) * 100).toFixed(2)}%)`);
  console.log(`Models Found: ${modelsFound} (${((modelsFound / normalizedData.length) * 100).toFixed(2)}%)`);
  console.log(`Model Numbers Found: ${modelNumbersFound} (${((modelNumbersFound / normalizedData.length) * 100).toFixed(2)}%)`);
  console.log(`Prices Found: ${pricesFound} (${((pricesFound / normalizedData.length) * 100).toFixed(2)}%)`);
  console.log(`Ratings Found: ${ratingsFound} (${((ratingsFound / normalizedData.length) * 100).toFixed(2)}%)`);
  
  // Top 10 brands
  console.log('\n=== TOP 10 BRANDS ===');
  const sortedBrands = Object.entries(brandCounts)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 10);
  
  sortedBrands.forEach(([brand, count], index) => {
    console.log(`${index + 1}. ${brand}: ${count} products`);
  });
  
  // Price range
  const prices = normalizedData
    .filter(p => p.price)
    .map(p => p.price);
  
  if (prices.length > 0) {
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const avgPrice = prices.reduce((sum, price) => sum + price, 0) / prices.length;
    
    console.log(`\n=== PRICE RANGE ===`);
    console.log(`Min Price: ₹${minPrice}`);
    console.log(`Max Price: ₹${maxPrice}`);
    console.log(`Avg Price: ₹${Math.round(avgPrice)}`);
  }
  
  // Rating distribution
  const ratings = normalizedData
    .filter(p => p.rating)
    .map(p => p.rating);
  
  if (ratings.length > 0) {
    const ratingDistribution = {};
    ratings.forEach(rating => {
      const rounded = Math.floor(rating);
      ratingDistribution[rounded] = (ratingDistribution[rounded] || 0) + 1;
    });
    
    console.log(`\n=== RATING DISTRIBUTION ===`);
    Object.entries(ratingDistribution)
      .sort(([a], [b]) => a - b)
      .forEach(([rating, count]) => {
        console.log(`${rating}-star: ${count} products`);
      });
  }
}

// Run the processing if this script is executed directly
if (require.main === module) {
  processFlipkartMouseData()
    .then(() => {
      console.log('Done!');
      process.exit(0);
    })
    .catch(error => {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    });
}

module.exports = {
  processFlipkartMouseData
};