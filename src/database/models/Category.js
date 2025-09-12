const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../../config/sequelize');

class Category extends Model {

  static async getCategoryForProduct(productData, cache, stats, supabase) {
    // Determine if it's a smartphone or basic phone
    let targetCategoryName = productData.category;
    
    // Debug logging
    console.log(`🔍 Category debug for ${productData.source_details?.url}:`);
    console.log(`   Raw category: "${targetCategoryName}"`);
    console.log(`   Type: ${typeof targetCategoryName}`);
    
    if (!targetCategoryName) {
      // Default to smartphones category for mobile devices
      targetCategoryName = 'Smartphones';
      console.log(`   Using default: "${targetCategoryName}"`);
    }

    // Use the same cache logic
    const cacheKey = `category:${targetCategoryName}`;
    if (cache.has(cacheKey)) {
      return cache.get(cacheKey);
    }

    try {
      // Query category by name using Supabase
      const { data: category, error } = await supabase
        .from('categories')
        .select('id')
        .eq('name', targetCategoryName)
        .maybeSingle();

      if (error) {
        throw error;
      }

      if (category) {
        cache.set(cacheKey, category.id);
        stats.categories.existing++;
        return category.id;
      } else {
        console.warn(`⚠️  Category "${targetCategoryName}" not found in predefined structure. Using default.`);
        console.log(productData.source_details.url)
        // Fallback: look up "Smartphones" as default
        const { data: defaultCategory, error: fallbackError } = await supabase
          .from('categories')
          .select('id')
          .eq('name', 'others')
          .maybeSingle();

        if (fallbackError) {
          throw fallbackError;
        }

        if (defaultCategory) {
          cache.set(cacheKey, defaultCategory.id);
          stats.categories.existing++;
          return defaultCategory.id;
        }
        return null;
      }
    } catch (error) {
      console.error(`❌ Error finding category "${targetCategoryName}":`, error.message);
      stats.errors.push(`Category: ${targetCategoryName} - ${error.message}`);
      return null;
    }
  }
}

module.exports = Category; 