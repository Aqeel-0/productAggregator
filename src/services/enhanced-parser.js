const { openai } = require('../config/openai');
const path = require('path');
const fs = require('fs').promises;
const { createLogger } = require('../utils/logger');

const logger = createLogger('EnhancedProductParser');

const MODEL = "deepseek/deepseek-r1-0528-qwen3-8b:free";

// Category hierarchy and attribute definitions
const CATEGORY_ATTRIBUTES = {
  'mobile-phones': {
    required: ['brand', 'model'],
    optional: ['color', 'storage_gb', 'ram_gb', 'network_type'],
    description: 'Smartphones and mobile phones'
  },
  'laptops': {
    required: ['brand', 'model'],
    optional: ['processor', 'ram_gb', 'storage_gb', 'storage_type', 'screen_size', 'graphics', 'os'],
    description: 'Laptops and notebooks'
  },
  'desktops': {
    required: ['brand', 'model'],
    optional: ['processor', 'ram_gb', 'storage_gb', 'storage_type', 'graphics', 'os', 'form_factor'],
    description: 'Desktop computers'
  },
  'tablets': {
    required: ['brand', 'model'],
    optional: ['color', 'storage_gb', 'ram_gb', 'screen_size', 'os', 'cellular', 'battery_life'],
    description: 'Tablets and iPads'
  },
  'televisions': {
    required: ['brand', 'model'],
    optional: ['screen_size', 'resolution', 'refresh_rate', 'hdr_support', 'smart_tv', 'ports', 'display_type'],
    description: 'TVs and televisions'
  },
  'cameras': {
    required: ['brand', 'model'],
    optional: ['sensor_type', 'megapixels', 'zoom_range', 'video_resolution', 'lens_mount', 'image_stabilization'],
    description: 'Digital cameras and DSLRs'
  },
  'gaming-consoles': {
    required: ['brand', 'model'],
    optional: ['storage_gb', 'generation', 'controller_included', 'online_support', 'backward_compatibility'],
    description: 'Gaming consoles and handhelds'
  },
  'smartwatches': {
    required: ['brand', 'model'],
    optional: ['color', 'screen_size', 'battery_life', 'water_resistance', 'health_features', 'os', 'cellular'],
    description: 'Smartwatches and fitness trackers'
  },
  'headphones': {
    required: ['brand', 'model'],
    optional: ['color', 'type', 'wireless', 'noise_cancellation', 'battery_life', 'connectivity'],
    description: 'Headphones and earphones'
  },
  'mobile-accessories': {
    required: ['brand', 'model'],
    optional: ['color', 'type', 'compatibility', 'material', 'features'],
    description: 'Phone cases, chargers, and accessories'
  },
  'power-banks': {
    required: ['brand', 'model'],
    optional: ['capacity_mah', 'output_ports', 'input_type', 'fast_charging', 'size'],
    description: 'Power banks and portable chargers'
  }
};

// Available categories for classification
const AVAILABLE_CATEGORIES = Object.keys(CATEGORY_ATTRIBUTES);

class EnhancedProductParser {
  constructor() {
    this.categoryBatchSize = 50;
    this.attributeBatchSize = 50;
    this.outputDir = './parsed_data';
    this.maxRetries = 3;
    this.retryDelay = 1000; // 1 second
  }

  /**
   * Generate category classification prompt
   */
  generateCategoryPrompt() {
    const categoryList = AVAILABLE_CATEGORIES.map(cat => `- ${cat}: ${CATEGORY_ATTRIBUTES[cat].description}`).join('\n');
    
    return `You are a product category classifier. 

Available categories:
${categoryList}

For each product, classify it into the most appropriate category from the list above.

Return a JSON array with objects containing:
- product_index (number): The index of the product (0-based)
- category (string): The category slug from the list above
- confidence (number): Confidence score from 0.1 to 1.0

Example response:
[
  {
    "product_index": 0,
    "category": "mobile-phones",
    "confidence": 0.95
  },
  {
    "product_index": 1,
    "category": "laptops", 
    "confidence": 0.88
  }
]

Products to classify:`;
  }

  /**
   * Generate category-specific attribute extraction prompt
   */
  generateAttributePrompt(category) {
    const attributes = CATEGORY_ATTRIBUTES[category];
    const requiredFields = attributes.required.join(', ');
    const optionalFields = attributes.optional.join(', ');
    
    return `You are a product data extractor for ${attributes.description}.

For each product, extract the following attributes:
Required: ${requiredFields}
Optional: ${optionalFields}

Return a JSON array with objects containing the extracted attributes. Use null for missing values.

Example response:
[
  {
    "brand": "Samsung",
    "model": "Galaxy S25",
    "color": "Black",
    "storage_gb": 256,
    "ram_gb": 8,
    "screen_size": 6.2,
    "camera_mp": 50,
    "battery_mah": 4000,
    "os_version": "Android 15",
    "network_type": "5G"
  }
]

Products to extract attributes from:`;
  }

  /**
   * Make API call with retry logic
   */
  async makeAPICall(messages, retryCount = 0) {
    try {
      const response = await openai.chat.completions.create({
        model: MODEL,
        messages: messages,
        temperature: 0.2,
      });
      return response.choices[0].message.content;
    } catch (error) {
      if (retryCount < this.maxRetries) {
        logger.warn(`API call failed, retrying in ${this.retryDelay}ms... (attempt ${retryCount + 1}/${this.maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, this.retryDelay * (retryCount + 1)));
        return this.makeAPICall(messages, retryCount + 1);
      }
      throw error;
    }
  }

  /**
   * Parse JSON response safely
   */
  parseJSONResponse(responseText) {
    try {
      // Try to extract JSON array from the response
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      
      // If no array found, try parsing the entire response
      return JSON.parse(responseText);
    } catch (error) {
      logger.error('Failed to parse JSON response:', error.message);
      logger.debug('Response text:', responseText);
      return null;
    }
  }

  /**
   * Classify products into categories
   */
  async classifyProducts(products) {
    const classifications = [];
    
    logger.info(`Classifying ${products.length} products into categories...`);
    
    for (let i = 0; i < products.length; i += this.categoryBatchSize) {
      const batch = products.slice(i, i + this.categoryBatchSize);
      const batchNum = Math.floor(i / this.categoryBatchSize) + 1;
      const totalBatches = Math.ceil(products.length / this.categoryBatchSize);
      
      logger.info(`Classifying batch ${batchNum}/${totalBatches} (${batch.length} products)`);

      try {
        const userContent = batch.map((product, index) => 
          `Product ${index}: ${product.title || 'No title'}`
        ).join('\n');
        
        const messages = [
          { role: "system", content: this.generateCategoryPrompt() },
          { role: "user", content: userContent }
        ];

        const responseText = await this.makeAPICall(messages);
        const classifications = this.parseJSONResponse(responseText);
        
        if (classifications && Array.isArray(classifications)) {
          // Map classifications back to products
          classifications.forEach(classification => {
            const productIndex = classification.product_index;
            if (productIndex >= 0 && productIndex < batch.length) {
              const product = batch[productIndex];
              product.category = classification.category;
              product.category_confidence = classification.confidence || 0.5;
            }
          });
          
          logger.info(`Successfully classified ${classifications.length} products in batch ${batchNum}`);
        } else {
          logger.warn(`Invalid classification response for batch ${batchNum}`);
          // Assign default category
          batch.forEach(product => {
            product.category = 'mobile-phones';
            product.category_confidence = 0.1;
          });
        }
        
      } catch (error) {
        logger.error(`Error classifying batch ${batchNum}:`, error.message);
        // Assign default category on error
        batch.forEach(product => {
          product.category = 'mobile-phones';
          product.category_confidence = 0.1;
        });
      }
    }
    
    return products;
  }

  /**
   * Extract attributes for products by category
   */
  async extractAttributesByCategory(products) {
    const processedProducts = [];
    
    // Group products by category
    const productsByCategory = {};
    products.forEach(product => {
      const category = product.category || 'mobile-phones';
      if (!productsByCategory[category]) {
        productsByCategory[category] = [];
      }
      productsByCategory[category].push(product);
    });
    
    logger.info(`Extracting attributes for ${Object.keys(productsByCategory).length} categories`);
    
    // Process each category
    for (const [category, categoryProducts] of Object.entries(productsByCategory)) {
      logger.info(`Processing ${categoryProducts.length} products in category: ${category}`);
      
      // Process category products in batches
      for (let i = 0; i < categoryProducts.length; i += this.attributeBatchSize) {
        const batch = categoryProducts.slice(i, i + this.attributeBatchSize);
        const batchNum = Math.floor(i / this.attributeBatchSize) + 1;
        const totalBatches = Math.ceil(categoryProducts.length / this.attributeBatchSize);
        
        logger.info(`Extracting attributes for ${category} batch ${batchNum}/${totalBatches}`);

        try {
          const userContent = batch.map((product, index) => 
            `Product ${index}: ${product.title || 'No title'}`
          ).join('\n');
          
          const messages = [
            { role: "system", content: this.generateAttributePrompt(category) },
            { role: "user", content: userContent }
          ];

          const responseText = await this.makeAPICall(messages);
          const extractedAttributes = this.parseJSONResponse(responseText);
          
          if (extractedAttributes && Array.isArray(extractedAttributes)) {
            // Map extracted attributes back to products
            extractedAttributes.forEach((attributes, index) => {
              if (index < batch.length) {
                const product = batch[index];
                // Merge extracted attributes with original product data
                Object.assign(product, attributes);
                processedProducts.push(product);
              }
            });
            
            logger.info(`Successfully extracted attributes for ${extractedAttributes.length} products in ${category} batch ${batchNum}`);
          } else {
            logger.warn(`Invalid attribute extraction response for ${category} batch ${batchNum}`);
            // Add products without extracted attributes
            batch.forEach(product => {
              processedProducts.push(product);
            });
          }
          
        } catch (error) {
          logger.error(`Error extracting attributes for ${category} batch ${batchNum}:`, error.message);
          // Add products without extracted attributes on error
          batch.forEach(product => {
            processedProducts.push(product);
          });
        }
      }
    }
    
    return processedProducts;
  }

  /**
   * Normalize products with enhanced processing
   */
  async normalizeWithEnhancedGPT(rawRecords) {
    logger.info(`Starting enhanced processing for ${rawRecords.length} records`);
    
    // Step 1: Classify products into categories
    logger.info('Step 1: Classifying products into categories...');
    const classifiedProducts = await this.classifyProducts(rawRecords);
    
    // Step 2: Extract attributes based on categories
    logger.info('Step 2: Extracting category-specific attributes...');
    const processedProducts = await this.extractAttributesByCategory(classifiedProducts);
    
    // Step 3: Validate and clean data
    logger.info('Step 3: Validating and cleaning data...');
    const validatedProducts = this.validateAndCleanData(processedProducts);
    
    logger.info(`Enhanced processing completed. Processed ${validatedProducts.length} products`);
    return validatedProducts;
  }

  /**
   * Validate and clean extracted data
   */
  validateAndCleanData(products) {
    return products.map(product => {
      const cleaned = { ...product };
      
      // Validate numeric fields
      if (cleaned.storage_gb && (isNaN(cleaned.storage_gb) || cleaned.storage_gb < 0)) {
        cleaned.storage_gb = null;
      }
      
      if (cleaned.ram_gb && (isNaN(cleaned.ram_gb) || cleaned.ram_gb < 0)) {
        cleaned.ram_gb = null;
      }
      
      if (cleaned.screen_size && (isNaN(cleaned.screen_size) || cleaned.screen_size < 0)) {
        cleaned.screen_size = null;
      }
      if (!cleaned.color) {
        cleaned.color = null;
      }
      return cleaned;
    });
  }

  /**
   * Save parsed data to file
   */
  async saveParsedData(parsedData, filename) {
    try {
      await fs.access(this.outputDir);
    } catch {
      await fs.mkdir(this.outputDir, { recursive: true });
    }
    
    const filepath = path.join(this.outputDir, filename);
    await fs.writeFile(filepath, JSON.stringify(parsedData, null, 2));
    
    logger.info(`Saved enhanced parsed data to: ${filepath}`);
    return filepath;
  }

  /**
   * Process scraped data file with enhanced parsing
   */
  async processScrapedData(inputFile) {
    try {
      logger.info(`Reading data from: ${inputFile}`);
      const rawData = JSON.parse(await fs.readFile(inputFile, 'utf8'));
      
      logger.info('Starting enhanced AI processing...');
      const parsedData = await this.normalizeWithEnhancedGPT(rawData);
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const outputFilename = `enhanced_parsed_products_${timestamp}.json`;
      
      const filepath = await this.saveParsedData(parsedData, outputFilename);
      
      // Generate processing statistics
      const stats = this.generateProcessingStats(parsedData);
      
      return {
        success: true,
        input_count: rawData.length,
        output_count: parsedData.length,
        filepath: filepath,
        data: parsedData,
        statistics: stats
      };
      
    } catch (error) {
      logger.error('Error processing scraped data:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Generate processing statistics
   */
  generateProcessingStats(parsedData) {
    const categoryStats = {};
    const brandStats = {};
    let totalWithAttributes = 0;
    
    parsedData.forEach(product => {
      // Category statistics
      const category = product.category || 'unknown';
      categoryStats[category] = (categoryStats[category] || 0) + 1;
      
      // Brand statistics
      const brand = product.brand || 'unknown';
      brandStats[brand] = (brandStats[brand] || 0) + 1;
      
      // Attribute completion
      if (product.brand && product.model) {
        totalWithAttributes++;
      }
    });
    
    return {
      total_products: parsedData.length,
      products_with_attributes: totalWithAttributes,
      attribute_completion_rate: (totalWithAttributes / parsedData.length * 100).toFixed(2) + '%',
      category_distribution: categoryStats,
      top_brands: Object.entries(brandStats)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10)
        .map(([brand, count]) => ({ brand, count }))
    };
  }

  /**
   * List available scraped files
   */
  async listScrapedFiles() {
    try {
      const scrapedDir = path.join(__dirname, '../../scraped_data');
      console.log(scrapedDir);
      const files = await fs.readdir(scrapedDir);
      const jsonFiles = files.filter(file => file.endsWith('.json'));
      
      if (jsonFiles.length === 0) {
        logger.info('No JSON files found in ./scraped_data/');
        return [];
      }
      
      logger.info(`Found ${jsonFiles.length} scraped data files`);
      return jsonFiles.map(file => ({
        name: file,
        path: path.join(scrapedDir, file)
      }));
    } catch (error) {
      logger.error('Error reading scraped_data directory:', error.message);
      return [];
    }
  }

  /**
   * Process the latest scraped file
   */
  async processLatestFile() {
    try {
      const files = await this.listScrapedFiles();
      if (files.length === 0) {
        return { success: false, message: 'No scraped files found' };
      }
      
      const latestFile = files[files.length - 1];
      logger.info(`Processing latest file: ${latestFile.name}`);
      
      return await this.processScrapedData(latestFile.path);
    } catch (error) {
      logger.error('Error processing latest file:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Process all scraped files in the scraped_data directory one by one, overwriting each with processed output
   */
  async processAllScrapedFiles() {
    const scrapedDir = path.resolve(__dirname, '../../scraped_data');
    let files;
    try {
      files = (await fs.readdir(scrapedDir)).filter(f => f.endsWith('.json'));
    } catch (err) {
      logger.error('Failed to read scraped_data directory:', err.message);
      return;
    }
    if (files.length === 0) {
      logger.info('No JSON files found in scraped_data.');
      return;
    }
    for (const file of files) {
      const filePath = path.join(scrapedDir, file);
      logger.info(`Processing file: ${file}`);
      try {
        const rawData = JSON.parse(await fs.readFile(filePath, 'utf8'));
        const parsedData = await this.normalizeWithEnhancedGPT(rawData);
        await fs.writeFile(filePath, JSON.stringify(parsedData, null, 2));
        logger.info(`Overwrote file with processed data: ${file}`);
      } catch (err) {
        logger.error(`Failed to process file ${file}:`, err.message);
      }
    }
  }
}

module.exports = EnhancedProductParser;

// Allow running directly
if (require.main === module) {
  const parser = new EnhancedProductParser();
  parser.processAllScrapedFiles().then(() => {
    console.log('All files processed.');
  }).catch(console.error);
} 