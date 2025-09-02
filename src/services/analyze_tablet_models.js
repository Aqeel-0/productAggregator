const fs = require('fs');
const path = require('path');

/**
 * Script to analyze unique model numbers and model names in tablet normalized data
 */
class TabletModelAnalyzer {
  constructor() {
    this.flipkartData = [];
    this.amazonData = [];
  }

  /**
   * Load and parse normalized data files
   */
  loadData() {
    try {
      // Load Flipkart tablet data
      const flipkartPath = path.join(__dirname, '../../parsed_data/flipkart_tablet_normalized_data.json');
      if (fs.existsSync(flipkartPath)) {
        this.flipkartData = JSON.parse(fs.readFileSync(flipkartPath, 'utf8'));
        console.log(`✅ Loaded ${this.flipkartData.length} Flipkart tablet products`);
      } else {
        console.log(`⚠️  Flipkart tablet data file not found: ${flipkartPath}`);
      }

      // Load Amazon tablet data
      const amazonPath = path.join(__dirname, '../../parsed_data/amazon_tablet_normalized_data.json');
      if (fs.existsSync(amazonPath)) {
        this.amazonData = JSON.parse(fs.readFileSync(amazonPath, 'utf8'));
        console.log(`✅ Loaded ${this.amazonData.length} Amazon tablet products`);
      } else {
        console.log(`⚠️  Amazon tablet data file not found: ${amazonPath}`);
      }

    } catch (error) {
      console.error(`❌ Error loading data: ${error.message}`);
      process.exit(1);
    }
  }

  /**
   * Extract model names and numbers from data
   */
  extractModels(data, source) {
    const modelNames = new Set();
    const modelNumbers = new Set();
    const modelDetails = [];

    data.forEach((product, index) => {
      const brand = product.product_identifiers?.brand_name;
      const modelName = product.product_identifiers?.model_name;
      const modelNumber = product.product_identifiers?.model_number;

      if (modelName) {
        modelNames.add(modelName);
      }
      if (modelNumber) {
        modelNumbers.add(modelNumber);
      }

      modelDetails.push({
        index: index + 1,
        source: source,
        brand: brand || 'N/A',
        modelName: modelName || 'N/A',
        modelNumber: modelNumber || 'N/A',
        title: product.product_details?.title || 'N/A'
      });
    });

    return {
      modelNames,
      modelNumbers,
      modelDetails
    };
  }

  /**
   * Analyze models within each file
   */
  analyzeWithinFiles() {
    console.log('\n📊 ANALYSIS WITHIN EACH FILE');
    console.log('=' .repeat(60));

    // Analyze Flipkart data
    if (this.flipkartData.length > 0) {
      const flipkartAnalysis = this.extractModels(this.flipkartData, 'Flipkart');
      
      console.log('\n🛒 FLIPKART TABLET DATA:');
      console.log(`   📦 Total products: ${this.flipkartData.length}`);
      console.log(`   🏷️  Unique model names: ${flipkartAnalysis.modelNames.size}`);
      console.log(`   🔢 Unique model numbers: ${flipkartAnalysis.modelNumbers.size}`);
      
      // Show top model names
      const modelNameCounts = {};
      flipkartAnalysis.modelDetails.forEach(item => {
        if (item.modelName !== 'N/A') {
          modelNameCounts[item.modelName] = (modelNameCounts[item.modelName] || 0) + 1;
        }
      });
      
      const topModelNames = Object.entries(modelNameCounts)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10);
      
      console.log('\n   📈 Top 10 Model Names:');
      topModelNames.forEach(([name, count], index) => {
        console.log(`      ${index + 1}. ${name} (${count} products)`);
      });
    }

    // Analyze Amazon data
    if (this.amazonData.length > 0) {
      const amazonAnalysis = this.extractModels(this.amazonData, 'Amazon');
      
      console.log('\n🛍️  AMAZON TABLET DATA:');
      console.log(`   📦 Total products: ${this.amazonData.length}`);
      console.log(`   🏷️  Unique model names: ${amazonAnalysis.modelNames.size}`);
      console.log(`   🔢 Unique model numbers: ${amazonAnalysis.modelNumbers.size}`);
      
      // Show top model names
      const modelNameCounts = {};
      amazonAnalysis.modelDetails.forEach(item => {
        if (item.modelName !== 'N/A') {
          modelNameCounts[item.modelName] = (modelNameCounts[item.modelName] || 0) + 1;
        }
      });
      
      const topModelNames = Object.entries(modelNameCounts)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10);
      
      console.log('\n   📈 Top 10 Model Names:');
      topModelNames.forEach(([name, count], index) => {
        console.log(`      ${index + 1}. ${name} (${count} products)`);
      });
    }
  }

  /**
   * Analyze models across both files
   */
  analyzeAcrossFiles() {
    console.log('\n\n🔄 ANALYSIS ACROSS BOTH FILES');
    console.log('=' .repeat(60));

    if (this.flipkartData.length === 0 && this.amazonData.length === 0) {
      console.log('❌ No data available for cross-file analysis');
      return;
    }

    // Extract models from both sources
    const flipkartAnalysis = this.flipkartData.length > 0 ? this.extractModels(this.flipkartData, 'Flipkart') : { modelNames: new Set(), modelNumbers: new Set() };
    const amazonAnalysis = this.amazonData.length > 0 ? this.extractModels(this.amazonData, 'Amazon') : { modelNames: new Set(), modelNumbers: new Set() };

    // Combine model names and numbers
    const allModelNames = new Set([...flipkartAnalysis.modelNames, ...amazonAnalysis.modelNames]);
    const allModelNumbers = new Set([...flipkartAnalysis.modelNumbers, ...amazonAnalysis.modelNumbers]);

    console.log('\n📊 COMBINED STATISTICS:');
    console.log(`   🏷️  Total unique model names: ${allModelNames.size}`);
    console.log(`   🔢 Total unique model numbers: ${allModelNumbers.size}`);

    // Find overlapping models
    const overlappingModelNames = new Set();
    const overlappingModelNumbers = new Set();

    flipkartAnalysis.modelNames.forEach(name => {
      if (amazonAnalysis.modelNames.has(name)) {
        overlappingModelNames.add(name);
      }
    });

    flipkartAnalysis.modelNumbers.forEach(number => {
      if (amazonAnalysis.modelNumbers.has(number)) {
        overlappingModelNumbers.add(number);
      }
    });

    console.log('\n🔄 OVERLAPPING MODELS:');
    console.log(`   🏷️  Overlapping model names: ${overlappingModelNames.size}`);
    console.log(`   🔢 Overlapping model numbers: ${overlappingModelNumbers.size}`);

    if (overlappingModelNames.size > 0) {
      console.log('\n   📋 Overlapping Model Names:');
      Array.from(overlappingModelNames).sort().forEach((name, index) => {
        console.log(`      ${index + 1}. ${name}`);
      });
    }

    if (overlappingModelNumbers.size > 0) {
      console.log('\n   📋 Overlapping Model Numbers:');
      Array.from(overlappingModelNumbers).sort().forEach((number, index) => {
        console.log(`      ${index + 1}. ${number}`);
      });
    }

    // Find models unique to each source
    const flipkartOnlyModelNames = new Set();
    const amazonOnlyModelNames = new Set();

    flipkartAnalysis.modelNames.forEach(name => {
      if (!amazonAnalysis.modelNames.has(name)) {
        flipkartOnlyModelNames.add(name);
      }
    });

    amazonAnalysis.modelNames.forEach(name => {
      if (!flipkartAnalysis.modelNames.has(name)) {
        amazonOnlyModelNames.add(name);
      }
    });

    console.log('\n🎯 UNIQUE TO EACH SOURCE:');
    console.log(`   🛒 Model names only in Flipkart: ${flipkartOnlyModelNames.size}`);
    console.log(`   🛍️  Model names only in Amazon: ${amazonOnlyModelNames.size}`);

    if (flipkartOnlyModelNames.size > 0) {
      console.log('\n   🛒 Flipkart-Only Model Names (Top 10):');
      Array.from(flipkartOnlyModelNames).sort().slice(0, 10).forEach((name, index) => {
        console.log(`      ${index + 1}. ${name}`);
      });
    }

    if (amazonOnlyModelNames.size > 0) {
      console.log('\n   🛍️  Amazon-Only Model Names (Top 10):');
      Array.from(amazonOnlyModelNames).sort().slice(0, 10).forEach((name, index) => {
        console.log(`      ${index + 1}. ${name}`);
      });
    }
  }

  /**
   * Generate detailed model comparison report
   */
  generateDetailedReport() {
    console.log('\n\n📋 DETAILED MODEL COMPARISON REPORT');
    console.log('=' .repeat(60));

    if (this.flipkartData.length === 0 && this.amazonData.length === 0) {
      console.log('❌ No data available for detailed report');
      return;
    }

    // Create a comprehensive model database
    const modelDatabase = new Map();

    // Process Flipkart data
    this.flipkartData.forEach((product, index) => {
      const brand = product.product_identifiers?.brand_name;
      const modelName = product.product_identifiers?.model_name;
      const modelNumber = product.product_identifiers?.model_number;

      if (modelName && modelName !== 'N/A') {
        const key = `${brand || 'Unknown'}_${modelName}`;
        if (!modelDatabase.has(key)) {
          modelDatabase.set(key, {
            brand: brand || 'Unknown',
            modelName: modelName,
            modelNumber: modelNumber || 'N/A',
            flipkartCount: 0,
            amazonCount: 0,
            flipkartProducts: [],
            amazonProducts: []
          });
        }
        const model = modelDatabase.get(key);
        model.flipkartCount++;
        model.flipkartProducts.push({
          index: index + 1,
          title: product.product_details?.title || 'N/A',
          price: product.product_details?.price?.current || 'N/A'
        });
      }
    });

    // Process Amazon data
    this.amazonData.forEach((product, index) => {
      const brand = product.product_identifiers?.brand_name;
      const modelName = product.product_identifiers?.model_name;
      const modelNumber = product.product_identifiers?.model_number;

      if (modelName && modelName !== 'N/A') {
        const key = `${brand || 'Unknown'}_${modelName}`;
        if (!modelDatabase.has(key)) {
          modelDatabase.set(key, {
            brand: brand || 'Unknown',
            modelName: modelName,
            modelNumber: modelNumber || 'N/A',
            flipkartCount: 0,
            amazonCount: 0,
            flipkartProducts: [],
            amazonProducts: []
          });
        }
        const model = modelDatabase.get(key);
        model.amazonCount++;
        model.amazonProducts.push({
          index: index + 1,
          title: product.product_details?.title || 'N/A',
          price: product.product_details?.price?.current || 'N/A'
        });
      }
    });

    // Sort models by total count
    const sortedModels = Array.from(modelDatabase.values())
      .sort((a, b) => (b.flipkartCount + b.amazonCount) - (a.flipkartCount + a.amazonCount));

    console.log(`\n📊 Found ${sortedModels.length} unique model combinations`);
    console.log('\n🏆 TOP 20 MOST COMMON MODELS:');
    
    sortedModels.slice(0, 20).forEach((model, index) => {
      const totalCount = model.flipkartCount + model.amazonCount;
      const status = model.flipkartCount > 0 && model.amazonCount > 0 ? '🔄 Both' : 
                   model.flipkartCount > 0 ? '🛒 Flipkart' : '🛍️  Amazon';
      
      console.log(`\n   ${index + 1}. ${model.brand} ${model.modelName} (${totalCount} total)`);
      console.log(`      ${status} | Model Number: ${model.modelNumber}`);
      console.log(`      🛒 Flipkart: ${model.flipkartCount} products`);
      console.log(`      🛍️  Amazon: ${model.amazonCount} products`);
    });

    // Summary statistics
    const bothSources = sortedModels.filter(m => m.flipkartCount > 0 && m.amazonCount > 0);
    const flipkartOnly = sortedModels.filter(m => m.flipkartCount > 0 && m.amazonCount === 0);
    const amazonOnly = sortedModels.filter(m => m.flipkartCount === 0 && m.amazonCount > 0);

    console.log('\n\n📈 SUMMARY STATISTICS:');
    console.log(`   🔄 Models in both sources: ${bothSources.length}`);
    console.log(`   🛒 Models only in Flipkart: ${flipkartOnly.length}`);
    console.log(`   🛍️  Models only in Amazon: ${amazonOnly.length}`);
    console.log(`   📊 Total unique models: ${sortedModels.length}`);
  }

  /**
   * Run complete analysis
   */
  run() {
    console.log('🚀 Starting Tablet Model Analysis...\n');
    
    this.loadData();
    this.analyzeWithinFiles();
    this.analyzeAcrossFiles();
    this.generateDetailedReport();
    
    console.log('\n✅ Analysis completed successfully!');
  }
}

// Run the analysis
if (require.main === module) {
  const analyzer = new TabletModelAnalyzer();
  analyzer.run();
}

module.exports = TabletModelAnalyzer;
