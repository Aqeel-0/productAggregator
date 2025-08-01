const { DataTypes, Model, Op } = require('sequelize');
const { sequelize } = require('../../config/sequelize');

class Brand extends Model {
  /**
   * Helper method for defining associations.
   * This method is not a part of Sequelize lifecycle.
   * The `models/index` file will call this method automatically.
   */
  static associate(models) {
    // A brand has many products
    Brand.hasMany(models.Product, {
      foreignKey: 'brand_id',
      as: 'products'
    });
  }

  /**
   * Create a URL-friendly slug from the brand name
   */
  static generateSlug(name) {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '') // Remove special characters
      .replace(/[\s_-]+/g, '-') // Replace spaces and underscores with hyphens
      .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
  }

  /**
   * Find or create a brand by name
   */
  static async findOrCreateByName(name) {
    const slug = this.generateSlug(name);
    // First, try to find by slug
    let brand = await Brand.findOne({ where: { slug } });
    if (brand) {
      return { brand, created: false };
    }
    // Otherwise, try to find or create by name
    const [brandByName, created] = await Brand.findOrCreate({
      where: { name: name.trim() },
      defaults: {
        name: name.trim(),
        slug: slug,
        is_active: true
      }
    });
    return { brand: brandByName, created };
  }

  /**
   * Get all active brands with product counts
   */
  static async getActiveWithProductCounts() {
    return await Brand.findAll({
      where: { is_active: true },
      include: [{
        model: sequelize.models.Product,
        as: 'products',
        attributes: [],
        required: false
      }],
      attributes: [
        'id',
        'name',
        'slug',
        'logo_url',
        'description',
        [sequelize.fn('COUNT', sequelize.col('products.id')), 'product_count']
      ],
      group: ['Brand.id'],
      order: [['name', 'ASC']]
    });
  }

  /**
   * Search brands by name
   */
  static async searchByName(query, limit = 10) {
    return await Brand.findAll({
      where: {
        name: {
          [Op.iLike]: `%${query}%`
        },
        is_active: true
      },
      limit,
      order: [['name', 'ASC']]
    });
  }

  /**
   * Instance method to get product count
   */
  async getProductCount() {
    return await sequelize.models.Product.count({
      where: { brand_id: this.id }
    });
  }

  /**
   * Instance method to deactivate brand
   */
  async deactivate() {
    this.is_active = false;
    await this.save();
  }

  /**
   * Instance method to activate brand
   */
  async activate() {
    this.is_active = true;
    await this.save();
  }

  /**
   * Enhanced insertion method with caching and statistics
   * Used by DatabaseInserter for optimized brand creation
   */
  static async insertWithCache(brandName, cache, stats) {
    if (!brandName) return null;

    const normalizedName = brandName.trim();
    if (cache.has(normalizedName)) {
      return cache.get(normalizedName);
    }

    try {
      const { brand, created } = await Brand.findOrCreateByName(normalizedName);
      cache.set(normalizedName, brand.id);
      
      if (created) {
        stats.brands.created++;
        console.log(`✅ Created brand: ${normalizedName}`);
      } else {
        stats.brands.existing++;
      }
      
      return brand.id;
    } catch (error) {
      console.error(`❌ Error creating brand "${normalizedName}":`, error.message);
      stats.errors.push(`Brand: ${normalizedName} - ${error.message}`);
      return null;
    }
  }
}

Brand.init({
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    unique: true,
    validate: {
      notEmpty: true,
      len: [1, 100]
    }
  },
  slug: {
    type: DataTypes.STRING(100),
    allowNull: false,
    unique: true,
    validate: {
      notEmpty: true,
      len: [1, 100]
    }
  },
  logo_url: {
    type: DataTypes.TEXT,
    allowNull: true,
    validate: {
      isUrl: true
    }
  },
  website_url: {
    type: DataTypes.TEXT,
    allowNull: true,
    validate: {
      isUrl: true
    }
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    allowNull: false
  }
}, {
  sequelize,
  modelName: 'Brand',
  tableName: 'brands',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      name: 'brands_name_idx',
      fields: ['name']
    },
    {
      name: 'brands_slug_idx',
      fields: ['slug']
    },
    {
      name: 'brands_active_idx',
      fields: ['is_active']
    }
  ],
  hooks: {
    beforeValidate: (brand) => {
      if (brand.name && !brand.slug) {
        brand.slug = Brand.generateSlug(brand.name);
      }
    }
  }
});

module.exports = Brand; 