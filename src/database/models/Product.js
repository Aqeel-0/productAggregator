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
  static generateSlug(name) {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /**
   * Find or create product by name, brand, and category
   */
  static async findOrCreateByDetails(name, brandId, categoryId) {
    const slug = this.generateSlug(name);

    // First try to find by slug (most reliable for variants)
    let product = await Product.findOne({
      where: { slug: slug }
    });

    if (product) {
      return { product, created: false };
    }

    // If not found by slug, try to find by model_name and brand
    // Note: name is already normalized to lowercase when passed to this method
    product = await Product.findOne({
      where: {
        model_name: name.trim(),
        brand_id: brandId
      }
    });

    if (product) {
      // Update the slug if it's different
      if (product.slug !== slug) {
        await product.update({ slug: slug });
      }
      return { product, created: false };
    }

    // Create new product if not found
    // Store model name in lowercase for consistent case-insensitive matching
    product = await Product.create({
      model_name: name.trim(), // Already normalized to lowercase
      slug: slug,
      brand_id: brandId,
      category_id: categoryId,
      status: 'active'
    });

    return { product, created: true };
  }

  /**
   * Search products by name with filters
   */
  static async searchProducts(query, filters = {}) {
    const whereClause = {
      status: 'active'
    };

    if (query) {
      whereClause.model_name = {
        [Op.iLike]: `%${query}%`
      };
    }

    if (filters.brandId) {
      whereClause.brand_id = filters.brandId;
    }

    if (filters.categoryId) {
      whereClause.category_id = filters.categoryId;
    }

    if (filters.minPrice || filters.maxPrice) {
      whereClause.min_price = {};
      if (filters.minPrice) {
        whereClause.min_price[Op.gte] = filters.minPrice;
      }
      if (filters.maxPrice) {
        whereClause.max_price = {
          [Op.lte]: filters.maxPrice
        };
      }
    }

    const includeClause = [
      {
        model: sequelize.models.Brand,
        as: 'brand',
        attributes: ['id', 'name', 'slug']
      },
      {
        model: sequelize.models.Category,
        as: 'category',
        attributes: ['id', 'name', 'slug', 'path']
      }
    ];

    return await Product.findAll({
      where: whereClause,
      include: includeClause,
      order: [['name', 'ASC']],
      limit: filters.limit || 50,
      offset: filters.offset || 0
    });
  }

  /**
   * Get featured products
   */
  static async getFeaturedProducts(limit = 10) {
    return await Product.findAll({
      where: {
        is_featured: true,
        status: 'active'
      },
      include: [
        {
          model: sequelize.models.Brand,
          as: 'brand',
          attributes: ['id', 'name', 'slug']
        },
        {
          model: sequelize.models.Category,
          as: 'category',
          attributes: ['id', 'name', 'slug']
        }
      ],
      order: [['created_at', 'DESC']],
      limit
    });
  }

  /**
   * Get products by category with pagination
   */
  static async getByCategory(categoryId, page = 1, limit = 20) {
    const offset = (page - 1) * limit;

    return await Product.findAndCountAll({
      where: {
        category_id: categoryId,
        status: 'active'
      },
      include: [
        {
          model: sequelize.models.Brand,
          as: 'brand',
          attributes: ['id', 'name', 'slug']
        },
        {
          model: sequelize.models.Category,
          as: 'category',
          attributes: ['id', 'name', 'slug']
        }
      ],
      order: [['name', 'ASC']],
      limit,
      offset
    });
  }

  /**
   * Update price statistics from variants
   */
  async updatePriceStats() {
    const variants = await sequelize.models.ProductVariant.findAll({
      where: {
        product_id: this.id,
        is_active: true
      }
    });

    if (variants.length === 0) {
      this.min_price = null;
      this.max_price = null;
      this.avg_price = null;
    } else {
      const prices = variants
        .filter(v => v.min_price !== null)
        .map(v => parseFloat(v.min_price));

      if (prices.length > 0) {
        this.min_price = Math.min(...prices);
        this.max_price = Math.max(...prices);
        this.avg_price = prices.reduce((a, b) => a + b, 0) / prices.length;
      }
    }

    this.variant_count = variants.length;
    await this.save();
  }

  /**
   * Get product with all variants and listings
   */
  async getFullDetails() {
    return await Product.findByPk(this.id, {
      include: [
        {
          model: sequelize.models.Brand,
          as: 'brand'
        },
        {
          model: sequelize.models.Category,
          as: 'category'
        },
        {
          model: sequelize.models.ProductVariant,
          as: 'variants',
          where: { is_active: true },
          required: false,
          include: [
            {
              model: sequelize.models.Listing,
              as: 'listings',
              where: { is_active: true },
              required: false
            }
          ]
        }
      ]
    });
  }

  /**
   * Get best price across all variants
   */
  async getBestPrice() {
    const result = await sequelize.models.ProductVariant.findOne({
      where: {
        product_id: this.id,
        is_active: true,
        min_price: {
          [Op.ne]: null
        }
      },
      order: [['min_price', 'ASC']]
    });

    return result ? result.min_price : null;
  }

  /**
   * Mark product as featured
   */
  async markAsFeatured() {
    this.is_featured = true;
    await this.save();
  }

  /**
   * Remove from featured
   */
  async removeFromFeatured() {
    this.is_featured = false;
    await this.save();
  }

  /**
   * Discontinue product
   */
  async discontinue() {
    this.status = 'discontinued';
    await this.save();
  }

  /**
   * Initialize dual cache system for product insertion
   */
  static createDualCache() {
    return {
      modelNumberCache: new Map(),
      modelNameCache: new Map(),
      stats: {
        products: {
          created: 0,
          existing: 0,
          total: 0
        },
        deduplication: {
          model_number_matches: 0,
          exact_name_matches: 0,
          variant_5g_matches: 0,
          new_products: 0,
          total_matches: 0
        },
        errors: []
      }
    };
  }

  /**
   * Clear both caches
   */
  static clearDualCache(cacheSystem) {
    cacheSystem.modelNumberCache.clear();
    cacheSystem.modelNameCache.clear();
  }

  /**
   * Get cache statistics
   */
  static getCacheStats(cacheSystem) {
    const stats = cacheSystem.stats;
    stats.products.total = stats.products.created + stats.products.existing;
    stats.deduplication.total_matches =
      stats.deduplication.model_number_matches +
      stats.deduplication.exact_name_matches +
      stats.deduplication.variant_5g_matches;

    return {
      ...stats,
      cache_sizes: {
        model_number_cache: cacheSystem.modelNumberCache.size,
        model_name_cache: cacheSystem.modelNameCache.size
      }
    };
  }

  /**
   * Simplified product insertion with exact matching and dual model names
   * Model names are normalized to lowercase for consistent storage and matching
   */
  static async insertWithCache(productData, brandId, categoryId, modelNumberCache, modelNameCache, stats) {
    const { model_name, model_number } = productData.product_identifiers;
    const key_specifications = productData.key_specifications || {};
  
    if (!model_name) return null;
  
    // Helper functions
    const hasNetworkSuffix = (name) => {
      return name.endsWith(' 5g') || name.endsWith(' 4g');
    };
  
    const removeNetworkSuffix = (name) => {
      if (name.endsWith(' 5g') || name.endsWith(' 4g')) return name.slice(0, -3);
      return name;
    };
  
    const getNetworkType = (name) => {
      if (name.endsWith(' 5g')) return '5g';
      if (name.endsWith(' 4g')) return '4g';
      return '5g'; // Default for no suffix
    };
  
    const getCacheKey = (name) => {
      const networkType = getNetworkType(name);
      return networkType === '4g' ? name : removeNetworkSuffix(name); // 4G: full name, else base
    };
  
    const generateSearchVariants = (name) => {
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
  
        matchedProduct = await Product.findOne({
          where: { model_number, brand_id: brandId }
        });
  
        if (matchedProduct) {
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
        const dbResults = await Product.findAll({
          where: { model_name: searchVariants, brand_id: brandId }
        });
  
        if (dbResults.length > 0) {
          // Prefer exact match, then any variant
          matchedProduct = dbResults.find(p => p.model_name === normalizedModelName) || dbResults[0];
          matchType = matchedProduct.model_name === normalizedModelName ? 'exact_name' : 'variant_match';
          stats.deduplication[matchType] = (stats.deduplication[matchType] || 0) + 1;
          modelNameCache.set(cacheKey, matchedProduct.id);
        }
      }
  
      // Phase 3: Create New Product
      if (!matchedProduct) {
        const { product, created } = await Product.findOrCreateByDetails(normalizedModelName, brandId, categoryId);
        await product.update({
          model_number: model_number || null,
          specifications: key_specifications,
          status: 'active'
        });
  
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
        await matchedProduct.update({ model_number });
        modelNumberCache.set(`${brandId}:${model_number}`, matchedProduct.id);
      }
  
      stats.products.existing++;
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