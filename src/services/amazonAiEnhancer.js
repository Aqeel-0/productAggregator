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
    this.model = this.genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    this.batchSize = 25; // Process 25 products per batch
    this.stats = { totalProcessed: 0, successful: 0, failed: 0, apiCalls: 0 };
  }

  /**
   * Main method to enhance Amazon data
   */
  async enhanceAmazonData(rawData) {
    try {
      console.log('🚀 Starting Amazon AI Enhancement...\n');
      console.log(`📊 Processing ${rawData.length} products in batches of ${this.batchSize}\n`);

      // Process all products in batches
      const enhancedProducts = await this.processBatches(rawData);
      
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
  async processBatches(products) {
    const totalBatches = Math.ceil(products.length / this.batchSize);
    const enhancedProducts = [];
    
    console.log(`📦 Processing ${products.length} products in ${totalBatches} batches...`);
    console.log(`🎯 Each batch will contain ${this.batchSize} products in a single API call\n`);
    
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const startIndex = batchIndex * this.batchSize;
      const endIndex = Math.min(startIndex + this.batchSize, products.length);
      const batch = products.slice(startIndex, endIndex);
      
      console.log(`\n🔄 Processing Batch ${batchIndex + 1}/${totalBatches} (Products ${startIndex + 1}-${endIndex})`);
      console.log('=' .repeat(60));
      
      try {
        const batchResults = await this.processBatch(batch);
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
  async processBatch(batch) {
    console.log(`  📤 Sending ${batch.length} products to Gemini AI in single prompt...`);
    
    try {
      const prompt = this.buildBatchPrompt(batch);
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
      
      // Validate and merge with original products
      const enhancedBatch = [];
      for (let i = 0; i < batch.length; i++) {
        const product = batch[i];
        const extractedData = extractedDataArray[i] || {};
        
        // Validate extracted data
        const validatedData = this.validateExtractedData(extractedData);
        
        // Merge with original product
        const enhancedProduct = this.mergeWithOriginalData(product, validatedData);
        enhancedBatch.push(enhancedProduct);
        
        // Update stats
        if (validatedData.model_name) {
          this.stats.successful++;
        } else {
          this.stats.failed++;
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
      
      // Update stats for failed batch
      this.stats.failed += batch.length;
      this.stats.totalProcessed += batch.length;
      
      return failedBatch;
    }
  }

  /**
   * Build prompt for batch processing
   */
  buildBatchPrompt(products) {
    let prompt = `You are a product data analyst. Extract attributes from ${products.length} products and return a JSON ARRAY.

IMPORTANT: You MUST return a JSON ARRAY with exactly ${products.length} objects, one for each product.

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
- Extract model_name, color, ram, and storage for each product
- For iPhones, always set ram to null
- For storage, if it's 1TB, return 1024
- If any field cannot be determined, use null

RESPONSE FORMAT - MUST BE A JSON ARRAY:
[
  {
    "model_name": "Product 1 model name",
    "color": "Product 1 color",
    "ram": Product 1 RAM or null,
    "storage": Product 1 storage or null
  },
  {
    "model_name": "Product 2 model name",
    "color": "Product 2 color",
    "ram": Product 2 RAM or null,
    "storage": Product 2 storage or null
  }
]

CRITICAL: Return ONLY the JSON array with exactly ${products.length} objects. No explanations, no extra text. No markdown formatting.`;
    
    return prompt;
  }

  /**
   * Validate extracted data
   */
  validateExtractedData(data) {
    const required = ['model_name', 'color', 'ram', 'storage'];
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
