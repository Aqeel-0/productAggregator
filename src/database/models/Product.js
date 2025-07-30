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
    product = await Product.create({
        model_name: name.trim(),
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