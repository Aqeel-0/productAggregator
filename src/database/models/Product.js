const { DataTypes, Model, Op } = require('sequelize');
const { sequelize } = require('../../config/sequelize');

class Product extends Model {
  /**
   * Helper method for defining associations.
   */
  static associate(models) {
    // A product belongs to a brand
    Product.belongsTo(models.Brand, {
      foreignKey: 'brand_id',
      as: 'brand'
    });

    // A product belongs to a category
    Product.belongsTo(models.Category, {
      foreignKey: 'category_id',
      as: 'category'
    });

    // A product has many variants
    Product.hasMany(models.ProductVariant, {
      foreignKey: 'product_id',
      as: 'variants'
    });
  }

  /**
   * Create a URL-friendly slug from the product name
   */
  // major issue, needs fixing.
  static generateSlug(name) {
    return name
    .toLowerCase()
    .trim()
    // Replace common special characters with meaningful alternatives (except +)
    .replace(/&/g, 'and')
    .replace(/[@]/g, 'at')
    .replace(/[%]/g, 'percent')
    // Remove quotes, parentheses, brackets
    .replace(/['"()[\]{}]/g, '')
    // Replace spaces, dashes, underscores with single dash
    .replace(/[\s\-_]+/g, '-')
    // Remove all other non-alphanumeric characters EXCEPT + and -
    .replace(/[^a-z0-9\-+]/g, '')
    // Replace multiple consecutive dashes with single dash
    .replace(/-+/g, '-')
    // Remove leading and trailing dashes
    .replace(/^-+|-+$/g, '');
  }

  /**
   * Find or create product by name, brand, and category
   */
  static async findOrCreateByDetails(name, brandId, categoryId, supabase) {
    const slug = this.generateSlug(name);

    // First try to find by slug (most reliable for variants)
    const { data: productBySlug, error: slugError } = await supabase
      .from('products')
      .select('*')
      .eq('slug', slug)
      .maybeSingle();

    if (slugError) {
      throw new Error(`Error finding product by slug: ${slugError.message}`);
    }

    if (productBySlug) {
      return { product: productBySlug, created: false };
    }

    // If not found by slug, try to find by model_name and brand
    // Note: name is already normalized to lowercase when passed to this method
    const { data: productByName, error: nameError } = await supabase
      .from('products')
      .select('*')
      .eq('model_name', name.trim())
      .eq('brand_id', brandId)
      .maybeSingle();

    if (nameError) {
      throw new Error(`Error finding product by name: ${nameError.message}`);
    }

    if (productByName) {
      // Update the slug if it's different
      if (productByName.slug !== slug) {
        const { error: updateError } = await supabase
          .from('products')
          .update({ slug: slug })
          .eq('id', productByName.id);
  
        if (updateError) {
          throw new Error(`Error updating product slug: ${updateError.message}`);
        }
  
        // Update the local object to reflect the change
        productByName.slug = slug;
      }
      return { product: productByName, created: false };
    }

    // Create new product if not found
    // Store model name in lowercase for consistent case-insensitive matching
    const { data: newProducts, error: insertError } = await supabase
      .from('products')
      .insert([{
        model_name: name.trim(), // Already normalized to lowercase
        slug: slug,
        brand_id: brandId,
        category_id: categoryId,
        status: 'active'
      }])
      .select();

    if (insertError) {
      throw new Error(`Error creating product: ${insertError.message}`);
    }

    if (!newProducts || newProducts.length === 0) {
      throw new Error('Product creation failed - no product returned');
    }

    const product = newProducts[0];
    return { product, created: true };
  }

  /**
   * Simplified product insertion with exact matching and dual model names
   * Model names are normalized to lowercase for consistent storage and matching
   */
  static async insertWithCache(productData, brandId, categoryId, modelNumberCache, modelNameCache, stats, supabase) {
    const { model_name, model_number } = productData.product_identifiers;
    const key_specifications = productData.key_specifications || {};

    if (!model_name) return null;

    // Helper functions (exactly the same)
    const hasNetworkSuffix = name => name.endsWith(' 5g') || name.endsWith(' 4g');

    const removeNetworkSuffix = name => {
      if (name.endsWith(' 5g') || name.endsWith(' 4g')) return name.slice(0, -3);
      return name;
    };

    const getNetworkType = name => {
      if (name.endsWith(' 5g')) return '5g';
      if (name.endsWith(' 4g')) return '4g';
      return '5g'; // Default for no suffix
    };

    const getCacheKey = name => {
      const networkType = getNetworkType(name);
      return networkType === '4g' ? name : removeNetworkSuffix(name); // 4G: full name, else base
    };

    const generateSearchVariants = name => {
      const baseName = removeNetworkSuffix(name);
      const networkType = getNetworkType(name);
      return networkType === '4g' ? [name] : [baseName, `${baseName} 5g`]; // 4G: exact only; else base + 5G
    };

    // Normalize input
    const normalizedModelName = model_name.toLowerCase().trim();
    const cacheKey = `${brandId}:${getCacheKey(normalizedModelName)}`;

    try {
      let matchedProduct = null;
      let matchType = 'none';

      // Phase 1: Model Number Matching
      if (model_number) {
        const modelNumberKey = `${brandId}:${model_number}`;
        if (modelNumberCache.has(modelNumberKey)) {
          stats.deduplication.model_number_matches++;
          stats.products.existing++;
          return modelNumberCache.get(modelNumberKey);
        }

        const { data: matchedProduct_temp, error } = await supabase
          .from('products')
          .select('*')
          .eq('model_number', model_number)
          .eq('brand_id', brandId)
          .maybeSingle();

        if (error) throw error;

        if (matchedProduct_temp) {
          matchedProduct = matchedProduct_temp;
          matchType = 'model_number';
          stats.deduplication.model_number_matches++;
          modelNumberCache.set(modelNumberKey, matchedProduct.id);
        }
      }

      // Phase 2: Model Name Matching
      if (!matchedProduct) {
        // Check cache
        if (modelNameCache.has(cacheKey)) {
          stats.deduplication.exact_name_matches++;
          stats.products.existing++;
          return modelNameCache.get(cacheKey);
        }

        // Generate search variants
        const searchVariants = generateSearchVariants(normalizedModelName);

        // Database query
        const { data: dbResults, error } = await supabase
          .from('products')
          .select('*')
          .in('model_name', searchVariants)
          .eq('brand_id', brandId);

        if (error) throw error;

        if (dbResults && dbResults.length > 0) {
          // Prefer exact match, then any variant
          matchedProduct = dbResults.find(p => p.model_name === normalizedModelName) || dbResults[0];
          matchType = matchedProduct.model_name === normalizedModelName ? 'exact_name' : 'variant_match';
          stats.deduplication[matchType] = (stats.deduplication[matchType] || 0) + 1;
          modelNameCache.set(cacheKey, matchedProduct.id);
        }
      }

      // Phase 3: Create New Product
      if (!matchedProduct) {
        const { product, created } = await Product.findOrCreateByDetails(normalizedModelName, brandId, categoryId, supabase);
        
        // Update with additional specifications and model_number
        const { error: updateError } = await supabase
          .from('products')
          .update({
            model_number: model_number || null,
            specifications: key_specifications,
            status: 'active'
          })
          .eq('id', product.id);

        if (updateError) throw updateError;

        matchedProduct = product;
        matchType = created ? 'created' : 'existing';
        if (created) {
          stats.products.created++;
          stats.deduplication.new_products++;
        } else {
          stats.products.existing++;
        }

        modelNameCache.set(cacheKey, matchedProduct.id);
        if (model_number) {
          modelNumberCache.set(`${brandId}:${model_number}`, matchedProduct.id);
        }
      } else if (model_number && !matchedProduct.model_number) {
        // Update existing matched product with model_number if missing
        const { error: updateError } = await supabase
          .from('products')
          .update({ model_number })
          .eq('id', matchedProduct.id);
        
        if (updateError) throw updateError;
        modelNumberCache.set(`${brandId}:${model_number}`, matchedProduct.id);
      }

      return matchedProduct.id;

    } catch (error) {
      console.error(`❌ Error in product insertion "${model_name}":`, error.message);
      stats.errors.push(`Product: ${model_name} - ${error.message}`);
      return null;
    }
  }  
}

Product.init({
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  model_name: {
    type: DataTypes.STRING(255),
    allowNull: false,
    validate: {
      notEmpty: true,
      len: [1, 255]
    }
  },
  slug: {
    type: DataTypes.STRING(255),
    allowNull: false,
    unique: true,
    validate: {
      notEmpty: true,
      len: [1, 255]
    }
  },
  brand_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'brands',
      key: 'id'
    }
  },
  category_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'categories',
      key: 'id'
    }
  },
  specifications: {
    type: DataTypes.JSONB,
    allowNull: true
  },
  launch_date: {
    type: DataTypes.DATE,
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM('active', 'discontinued', 'coming_soon'),
    allowNull: false,
    defaultValue: 'active'
  },
  model_number: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  variant_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    allowNull: false,
    validate: {
      min: 0
    }
  },
  min_price: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    validate: {
      min: 0
    }
  },
  max_price: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    validate: {
      min: 0
    }
  },
  avg_price: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    validate: {
      min: 0
    }
  },
  rating: {
    type: DataTypes.DECIMAL(3, 2),
    allowNull: true,
    validate: {
      min: 0,
      max: 5
    }
  },
  is_featured: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    allowNull: false
  }
}, {
  sequelize,
  modelName: 'Product',
  tableName: 'products',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      name: 'products_brand_id_idx',
      fields: ['brand_id']
    },
    {
      name: 'products_category_id_idx',
      fields: ['category_id']
    },
    {
      name: 'products_slug_idx',
      fields: ['slug']
    },
    {
      name: 'products_status_idx',
      fields: ['status']
    },
    {
      name: 'products_featured_idx',
      fields: ['is_featured']
    },
    {
      name: 'products_price_range_idx',
      fields: ['min_price', 'max_price']
    },
    {
      name: 'products_rating_idx',
      fields: ['rating']
    }
  ],
  hooks: {
    beforeValidate: (product) => {
      if (product.name && !product.slug) {
        product.slug = Product.generateSlug(product.name);
      }
    }
  }
});

module.exports = Product; 