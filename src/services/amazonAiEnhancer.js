const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require("@google/generative-ai");

/**
 * Amazon AI Enhancement Service
 * Enhances product data by extracting model name, color, RAM, and storage from titles and URLs
 */
class AmazonAiEnhancer {
  constructor() {
    // Initialize Gemini AI client
    this.genAI = new GoogleGenerativeAI('AIzaSyDiqCpBAzFWZFpe6Wg-M0zy2TLPRqFTkLk');
    this.model = this.genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
    this.batchSize = 50; // Process 50 products per batch
    this.stats = { totalProcessed: 0, successful: 0, filtered: 0, apiCalls: 0 };
  }

  /**
   * Main method to enhance Amazon data
   */
  async enhanceAmazonData(rawData, productType = 'mobile') {
    try {
      const productTypeLabel = productType === 'tablet' ? 'Tablet' : 'Mobile';
      console.log(`🚀 Starting Amazon ${productTypeLabel} AI Enhancement...\n`);
      console.log(`📊 Processing ${rawData.length} ${productType} products in batches of ${this.batchSize}\n`);

      // Process all products in batches
      const enhancedProducts = await this.processBatches(rawData, productType);
      
      console.log(`\n✅ AI Enhancement completed!`);
      console.log(`📊 Final Stats:`, this.stats);

      return enhancedProducts;

    } catch (error) {
      console.error('❌ AI Enhancement failed:', error.message);
      throw error;
    }
  }
  /**
   * Process products in batches
   */
  async processBatches(products, productType = 'mobile') {
    const totalBatches = Math.ceil(products.length / this.batchSize);
    const enhancedProducts = [];
    
    console.log(`📦 Processing ${products.length} ${productType} products in ${totalBatches} batches...`);
    console.log(`🎯 Each batch will contain ${this.batchSize} products in a single API call\n`);
    
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const startIndex = batchIndex * this.batchSize;
      const endIndex = Math.min(startIndex + this.batchSize, products.length);
      const batch = products.slice(startIndex, endIndex);
      
      console.log(`\n🔄 Processing Batch ${batchIndex + 1}/${totalBatches} (Products ${startIndex + 1}-${endIndex})`);
      console.log('=' .repeat(60));
      
      try {
        const batchResults = await this.processBatch(batch, productType);
        enhancedProducts.push(...batchResults);
        
        // Progress update
        const progress = ((batchIndex + 1) / totalBatches * 100).toFixed(1);
        console.log(`✅ Batch ${batchIndex + 1} completed. Progress: ${progress}%`);
        console.log(`📊 Batch Results: ${batchResults.length} products enhanced`);
        
        // Wait between batches to avoid rate limiting
        if (batchIndex < totalBatches - 1) {
          console.log(`⏳ Waiting 3 seconds before next batch...`);
          await this.sleep(3000);
        }
        
      } catch (error) {
        console.error(`❌ Error processing batch ${batchIndex + 1}:`, error.message);
        // Continue with next batch
        continue;
      }
    }
    
    return enhancedProducts;
  }

  /**
   * Process a single batch - send all products in one prompt
   */
  async processBatch(batch, productType = 'mobile') {
    console.log(`  📤 Sending ${batch.length} ${productType} products to Gemini AI in single prompt...`);
    
    try {
      const prompt = this.buildBatchPrompt(batch, productType);
      const response = await this.model.generateContent(prompt);
      const responseText = response.response.text();
      
      this.stats.apiCalls++;
      
      // Clean the response - remove markdown formatting if present
      let cleanResponse = responseText.trim();
      if (cleanResponse.startsWith('```json')) {
        cleanResponse = cleanResponse.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (cleanResponse.startsWith('```')) {
        cleanResponse = cleanResponse.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }
      
      let extractedDataArray = JSON.parse(cleanResponse);
      
      // Validate that we got an array
      if (!Array.isArray(extractedDataArray)) {
        console.log(`    ⚠️  AI returned object instead of array, converting to array...`);
        // If AI returns single object, convert to array
        const singleObject = extractedDataArray;
        extractedDataArray = [];
        for (let i = 0; i < batch.length; i++) {
          extractedDataArray.push(singleObject);
        }
      }
      
      // Validate array length
      if (extractedDataArray.length !== batch.length) {
        console.log(`    ⚠️  AI returned ${extractedDataArray.length} objects, expected ${batch.length}`);
        // Pad or truncate array to match batch size
        while (extractedDataArray.length < batch.length) {
          extractedDataArray.push({});
        }
        extractedDataArray = extractedDataArray.slice(0, batch.length);
      }
      
      // URL-based matching and merging
      const enhancedBatch = [];
      
      for (const product of batch) {
        // Find AI attributes that match this product's URL
        const matchingAIData = extractedDataArray.find(aiData => aiData.url === product.url);
        
        if (matchingAIData) {
          // Validate extracted data
          const validatedData = this.validateExtractedData(matchingAIData);
          
          // Merge with original product
          const enhancedProduct = this.mergeWithOriginalData(product, validatedData);
          enhancedBatch.push(enhancedProduct);
          
          // Update stats
          if (validatedData.brand_name && validatedData.model_name) {
            this.stats.successful++;
          } else {
            this.stats.filtered++;
          }
        } else {
          // No matching AI data found for this URL
          console.log(`⚠️  No AI data found for URL: ${product.url?.substring(0, 50)}...`);
          const enhancedProduct = this.mergeWithOriginalData(product, {});
          enhancedBatch.push(enhancedProduct);
          this.stats.filtered++;
        }
        this.stats.totalProcessed++;
      }
      
      console.log(`  ✅ Successfully enhanced ${enhancedBatch.length} products in single API call`);
      return enhancedBatch;
      
    } catch (error) {
      console.log(`  ❌ Batch processing failed: ${error.message}`);
      // Return original products if batch processing fails
      const failedBatch = batch.map(product => ({
        ...product,
        extracted_attributes: null,
        enhanced_at: new Date().toISOString()
      }));
      
      // Update stats for filtered batch
      this.stats.filtered += batch.length;
      this.stats.totalProcessed += batch.length;
      
      return failedBatch;
    }
  }

  /**
   * Build prompt for batch processing
   */
  buildBatchPrompt(products, productType = 'mobile') {
    if (productType === 'tablet') {
      return this.buildTabletBatchPrompt(products);
    }
    
    // Default mobile prompt
    let prompt = `You are a product data analyst. Extract attributes from ${products.length} products and return a JSON ARRAY.

IMPORTANT: You MUST return a JSON ARRAY with exactly ${products.length} objects, one for each product.
CRITICAL: Include the URL in each response object for accurate matching.

`;
    
    products.forEach((product, index) => {
      const title = product.title || 'N/A';
      const url = product.url || 'N/A';
      
      prompt += `Product ${index + 1}:
Title: "${title}"
URL: "${url}"

`;
    });
    
         prompt += `EXTRACTION RULES:
- Extract brand_name, model_name, color, ram, and storage for each product
- brand_name: Extract the manufacturer/brand (e.g., "Samsung", "Apple", "iQOO", "OnePlus", "Xiaomi", "Realme", "OPPO", "Vivo")
- model_name: Extract ONLY the model without brand name (e.g., "Galaxy S24", "iPhone 15", "Z10 Lite 5G", "iPad Pro", "Galaxy Tab S9", "Redmi Note 13")
- color: Extract the color variant with proper formatting:
  * Fix concatenated color names by adding spaces (e.g., "JetBlack" → "Jet Black", "TitaniumBlue" → "Titanium Blue", "MidnightGreen" → "Midnight Green")
  * Use proper color naming conventions (e.g., "Titanium Blue", "Mint Green", "Space Gray", "Jet Black", "Starlight", "Silver", "Rose Gold", "Pacific Blue")
  * Common corrections: "JetBlack" → "Jet Black", "TitaniumBlue" → "Titanium Blue", "SpaceGray" → "Space Gray", "MidnightGreen" → "Midnight Green", "RoseGold" → "Rose Gold"
- ram: Extract RAM in GB as integer (e.g., 6, 8, 12, 16). For iPhones and iPads, always set to null
- storage: Extract storage in GB as integer (e.g., 64, 128, 256, 512, 1024). Convert 1TB to 1024, 2TB to 2048
- If any field cannot be determined from title/URL, use null
- Be consistent with brand names (use "Apple" not "iPhone", "Samsung" not "Galaxy")
- Handle both mobile phones and tablets with the same extraction logic

RESPONSE FORMAT - MUST BE A JSON ARRAY:
[
  {
    "url": "Product 1 URL exactly as provided",
    "brand_name": "Product 1 brand",
    "model_name": "Product 1 model without brand",
    "color": "Product 1 color (properly formatted, e.g., 'Jet Black' not 'JetBlack')",
    "ram": Product 1 RAM or null,
    "storage": Product 1 storage or null
  },
  {
    "url": "Product 2 URL exactly as provided",
    "brand_name": "Product 2 brand",
    "model_name": "Product 2 model without brand",
    "color": "Product 2 color (properly formatted, e.g., 'Jet Black' not 'JetBlack')",
    "ram": Product 2 RAM or null,
    "storage": Product 2 storage or null
  }
]

CRITICAL: Return ONLY the JSON array with exactly ${products.length} objects. Include the exact URL for each product. No explanations, no extra text. No markdown formatting.

REMEMBER: Always format colors properly with spaces (e.g., "Jet Black" not "JetBlack", "Titanium Blue" not "TitaniumBlue").`;
    
    return prompt;
  }

  /**
   * Build tablet-specific prompt for batch processing
   */
  buildTabletBatchPrompt(products) {
    let prompt = `You are a product classifier specializing in TABLET DEVICES. Analyze ${products.length} products and return a JSON ARRAY with exactly ${products.length} objects.

CLASSIFICATION PRIORITY (Check in this order):
1. NON-TABLET INDICATORS (High Priority):
   - Books/Media: "for dummies", "guide", "book", "manual", "ebook"
   - Accessories: "case", "cover", "keyboard", "stand", "protector", "stylus"
   - Other Devices: "smartphone", "phone", "laptop", "computer", "desktop", "monitor"
   - Medicine/Health: "mg", "ml", "capsule", "ayurved", "medicine", "supplement"
   
2. TABLET DEVICE INDICATORS:
   - Device names: "ipad", "tablet", "tab" (when referring to device)
   - Model patterns: "galaxy tab", "pixel tablet", "surface pro", "fire hd"
   - Context: Screen sizes (7", 8", 10", 11", 12"), "wi-fi", "cellular", "android", "ios"

EXTRACTION RULES FOR TABLETS:
- brand_name: Apple, Samsung, Google, Amazon, etc.
- model_name: iPad Air, Galaxy Tab S9, Pixel Tablet, etc.
- ram: Extract as integer (4, 6, 8, 12, 16) - null if not found
- storage: Extract as integer in GB (64, 128, 256, 512, 1024)
- color: Proper case with spaces ("Space Gray", "Jet Black")
- display_size: Screen size as decimal (8.0, 10.9, 11.0, 12.9)
- connectivity_type: "Wi-Fi Only" or "Wi-Fi + Cellular" or "Wi-Fi + 4G" etc.

OUTPUT FORMAT:
[
  {
    "url": "product_url_here",
    "brand_name": "Apple",
    "model_name": "iPad Air",
    "ram": 8,
    "storage": 256,
    "color": "Space Gray",
    "display_size": 10.9,
    "connectivity_type": "Wi-Fi + Cellular" or "Wi-Fi + 5G" etc.,
    "not_tablet": false
  },
  {
    "url": "non_tablet_url_here",
    "brand_name": null,
    "model_name": null,
    "ram": null,
    "storage": null,
    "color": null,
    "display_size": null,
    "connectivity_type": null,
    "not_tablet": true
  }
]
PRODUCTS TO ANALYZE:
`;

    // Add each product to the prompt
    products.forEach((product, index) => {
      prompt += `\n${index + 1}. URL: ${product.url}\n`;
      prompt += `   Title: ${product.title}\n`;
      
      // Add RAM and storage information if available
      const specs = product.specifications || {};
      const techDetails = specs['Technical Details']?.technicalDetails || {};
      
      if (techDetails['RAM Size']) {
        prompt += `   RAM: ${techDetails['RAM Size']}\n`;
      }
      if (specs['Memory Storage Capacity']) {
        prompt += `   Storage: ${specs['Memory Storage Capacity']}\n`;
      }
      if (specs['Screen Size']) {
        prompt += `   Screen Size: ${specs['Screen Size']}\n`;
      }
      if (techDetails['Connectivity Type']) {
        prompt += `   Connectivity Type: ${techDetails['Connectivity Type']}\n`;
      }
    });

    prompt += `\n\nReturn ONLY the JSON array. No explanations or markdown formatting.`;

    return prompt;
  }

  /**
   * Validate extracted data
   */
  validateExtractedData(data) {
    const required = ['url', 'brand_name', 'model_name', 'color', 'ram', 'storage', 'display_size', 'connectivity_type', 'not_tablet'];
    const validated = {};
    
    for (const field of required) {
      if (data[field] !== undefined && data[field] !== null) {
        validated[field] = data[field];
      } else {
        validated[field] = null;
      }
    }
    
    return validated;
  }

  /**
   * Merge extracted data with original product
   */
  mergeWithOriginalData(originalProduct, extractedData) {
    return {
      ...originalProduct,
      extracted_attributes: extractedData,
      enhanced_at: new Date().toISOString()
    };
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = AmazonAiEnhancer;
