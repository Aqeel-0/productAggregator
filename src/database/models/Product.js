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
    const { model_name, model_number, model_name_with_5g } = productData.product_identifiers;
    const key_specifications = productData.key_specifications || {};

    if (!model_name) return null;

    // Normalize model names to lowercase for consistent storage and matching
    const normalizedModelName = model_name.toLowerCase().trim();
    const normalizedModelNameWith5G = model_name_with_5g ? model_name_with_5g.toLowerCase().trim() : null;

    try {
      let matchedProduct = null;
      let matchType = 'none';

      // Phase 1: Check model number cache first
      if (model_number) {
        const modelNumberKey = `${brandId}:${model_number}`;
        if (modelNumberCache.has(modelNumberKey)) {
          const productId = modelNumberCache.get(modelNumberKey);
          stats.deduplication.model_number_matches++;
          stats.products.existing++;
          return productId;
        }

        // Try exact model number match in database
        matchedProduct = await Product.findOne({
          where: {
            model_number: model_number,
            brand_id: brandId
          }
        });

        if (matchedProduct) {
          matchType = 'model_number';
          stats.deduplication.model_number_matches++;
          modelNumberCache.set(modelNumberKey, matchedProduct.id);
        }
      }

      // Phase 2: Check base model name cache (exact match with normalized lowercase)
      if (!matchedProduct) {
        const modelNameKey = `${brandId}:${normalizedModelName}`;
        if (modelNameCache.has(modelNameKey)) {
          const productId = modelNameCache.get(modelNameKey);
          stats.deduplication.exact_name_matches++;
          stats.products.existing++;
          return productId;
        }

        // Try exact base model name match in database (stored in lowercase)
        matchedProduct = await Product.findOne({
          where: {
            model_name: normalizedModelName,
            brand_id: brandId
          }
        });

        if (matchedProduct) {
          matchType = 'model_name';
          stats.deduplication.exact_name_matches++;
          modelNameCache.set(modelNameKey, matchedProduct.id);
        }
      }

      // Phase 3: Check 5G variant model name cache (exact match with normalized lowercase, if provided)
      if (!matchedProduct && normalizedModelNameWith5G) {
        const modelName5GKey = `${brandId}:${normalizedModelNameWith5G}`;
        if (modelNameCache.has(modelName5GKey)) {
          const productId = modelNameCache.get(modelName5GKey);
          stats.deduplication.variant_5g_matches++;
          stats.products.existing++;
          return productId;
        }

        // Try exact 5G variant model name match in database (stored in lowercase)
        matchedProduct = await Product.findOne({
          where: {
            model_name: normalizedModelNameWith5G,
            brand_id: brandId
          }
        });

        if (matchedProduct) {
          matchType = '5g_variant';
          stats.deduplication.variant_5g_matches++;
          modelNameCache.set(modelName5GKey, matchedProduct.id);
        }
      }

      // Phase 4: Create new product if no matches found
      if (!matchedProduct) {
        const { product, created } = await Product.findOrCreateByDetails(normalizedModelName, brandId, categoryId);

        // Update product with additional data
        const updateData = {
          model_number: model_number || null,
          specifications: key_specifications,
          status: 'active'
        };

        if (created || !product.model_number) {
          await product.update(updateData);
        }

        matchedProduct = product;
        matchType = created ? 'created' : 'existing';

        if (created) {
          stats.products.created++;
          stats.deduplication.new_products++;
        } else {
          stats.products.existing++;
        }

        // Cache the new product with both normalized model names
        const modelNameKey = `${brandId}:${normalizedModelName}`;
        modelNameCache.set(modelNameKey, matchedProduct.id);

        if (normalizedModelNameWith5G) {
          const modelName5GKey = `${brandId}:${normalizedModelNameWith5G}`;
          modelNameCache.set(modelName5GKey, matchedProduct.id);
        }

        if (model_number) {
          const modelNumberKey = `${brandId}:${model_number}`;
          modelNumberCache.set(modelNumberKey, matchedProduct.id);
        }
      } else {
        // Update existing product with model number if it was missing
        if (model_number && !matchedProduct.model_number) {
          await matchedProduct.update({ model_number: model_number });

          // Add to model number cache
          const modelNumberKey = `${brandId}:${model_number}`;
          modelNumberCache.set(modelNumberKey, matchedProduct.id);
        }

        // Cache both normalized model names for the matched product
        const modelNameKey = `${brandId}:${normalizedModelName}`;
        if (!modelNameCache.has(modelNameKey)) {
          modelNameCache.set(modelNameKey, matchedProduct.id);
        }

        if (normalizedModelNameWith5G) {
          const modelName5GKey = `${brandId}:${normalizedModelNameWith5G}`;
          if (!modelNameCache.has(modelName5GKey)) {
            modelNameCache.set(modelName5GKey, matchedProduct.id);
          }
        }

        stats.products.existing++;
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