const { DataTypes, Model, Op } = require('sequelize');
const { sequelize } = require('../../config/sequelize');

class ProductVariant extends Model {
  /**
   * Helper method for defining associations.
   */
  static associate(models) {
    // A variant belongs to a product
    ProductVariant.belongsTo(models.Product, {
      foreignKey: 'product_id',
      as: 'product'
    });

    // A variant has many offers
    ProductVariant.hasMany(models.Offer, {
      foreignKey: 'variant_id',
      as: 'offers'
    });
  }

  /**
   * Find or create variant by product and attributes
   */
  static async findOrCreateByAttributes(productId, attributes) {
    const name = await this.generateVariantName(productId, attributes);
    
    const [variant, created] = await ProductVariant.findOrCreate({
      where: { 
        product_id: productId,
        attributes: attributes
      },
      defaults: {
        product_id: productId,
        name: name,
        attributes: attributes,
        is_active: true
      }
    });

    return { variant, created };
  }

  /**
   * Generate variant name from product and attributes
   */
  static async generateVariantName(productId, attributes) {
    const product = await sequelize.models.Product.findByPk(productId, {
      include: [{ model: sequelize.models.Brand, as: 'brand' }]
    });
    
    if (!product) return 'Unknown Product Variant';

    let name = `${product.brand.name} ${product.name}`;
    
    if (attributes.color) name += ` - ${attributes.color}`;
    if (attributes.storage_gb) name += `, ${attributes.storage_gb}GB`;
    if (attributes.ram_gb) name += `, ${attributes.ram_gb}GB RAM`;
    if (attributes.size) name += `, ${attributes.size}`;

    return name;
  }

  /**
   * Get variants by product with filters
   */
  static async getByProduct(productId, filters = {}) {
    const whereClause = {
      product_id: productId,
      is_active: true
    };

    // Filter by attributes if provided
    if (Object.keys(filters).length > 0) {
      whereClause.attributes = filters;
    }

    return await ProductVariant.findAll({
      where: whereClause,
      include: [
        {
          model: sequelize.models.Offer,
          as: 'offers',
          where: { is_active: true },
          required: false
        }
      ],
      order: [['name', 'ASC']]
    });
  }

  /**
   * Get available attribute values for a product
   */
  static async getAttributeValues(productId) {
    const variants = await ProductVariant.findAll({
      where: { 
        product_id: productId,
        is_active: true 
      },
      attributes: ['attributes']
    });

    const allAttributes = {};
    
    variants.forEach(variant => {
      Object.entries(variant.attributes).forEach(([key, value]) => {
        if (!allAttributes[key]) {
          allAttributes[key] = new Set();
        }
        if (value) {
          allAttributes[key].add(value);
        }
      });
    });

    // Convert sets to arrays
    const result = {};
    Object.entries(allAttributes).forEach(([key, valueSet]) => {
      result[key] = Array.from(valueSet);
    });

    return result;
  }

  /**
   * Get price statistics from offers
   */
  async getPriceStats() {
    const offers = await sequelize.models.Offer.findAll({
      where: { 
        variant_id: this.id,
        is_active: true,
        stock_status: ['in_stock', 'limited_stock']
      }
    });

    if (offers.length === 0) {
      return {
        min_price: null,
        max_price: null,
        avg_price: null,
        best_price_store: null,
        offer_count: 0
      };
    }

    const prices = offers.map(o => parseFloat(o.price));
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
    
    // Find store with best price
    const bestOffer = offers.find(o => parseFloat(o.price) === minPrice);

    return {
      min_price: minPrice,
      max_price: maxPrice,
      avg_price: avgPrice,
      best_price_store: bestOffer ? bestOffer.store_name : null,
      offer_count: offers.length
    };
  }

  /**
   * Get best offers for this variant
   */
  async getBestOffers(limit = 5) {
    return await sequelize.models.Offer.findAll({
      where: { 
        variant_id: this.id,
        is_active: true,
        stock_status: ['in_stock', 'limited_stock']
      },
      order: [['price', 'ASC']],
      limit
    });
  }

  /**
   * Get price history for this variant
   */
  async getPriceHistory(days = 30) {
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - days);

    return await sequelize.models.Offer.findAll({
      where: { 
        variant_id: this.id,
        scraped_at: {
          [Op.gte]: sinceDate
        }
      },
      attributes: ['store_name', 'price', 'scraped_at'],
      order: [['scraped_at', 'DESC']]
    });
  }

  /**
   * Check if variant has any active offers
   */
  async isAvailable() {
    const offers = await sequelize.models.Offer.count({
      where: { 
        variant_id: this.id,
        is_active: true,
        stock_status: ['in_stock', 'limited_stock']
      }
    });
    return offers > 0;
  }

  /**
   * Get formatted attributes for display
   */
  getFormattedAttributes() {
    const formatted = [];
    
    Object.entries(this.attributes).forEach(([key, value]) => {
      if (value) {
        const formattedKey = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        formatted.push(`${formattedKey}: ${value}`);
      }
    });
    
    return formatted;
  }
}

ProductVariant.init({
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  product_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'products',
      key: 'id'
    }
  },
  sku: {
    type: DataTypes.STRING(100),
    allowNull: true,
    unique: true
  },
  name: {
    type: DataTypes.STRING(255),
    allowNull: false,
    validate: {
      notEmpty: true,
      len: [1, 255]
    }
  },
  attributes: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: {}
  },
  images: {
    type: DataTypes.JSONB,
    allowNull: true
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    allowNull: false
  }
}, {
  sequelize,
  modelName: 'ProductVariant',
  tableName: 'product_variants',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      name: 'product_variants_product_id_idx',
      fields: ['product_id']
    },
    {
      name: 'product_variants_sku_idx',
      fields: ['sku']
    },
    {
      name: 'product_variants_active_idx',
      fields: ['is_active']
    },
    {
      name: 'product_variants_attributes_idx',
      fields: ['attributes'],
      using: 'gin'
    }
  ]
});

module.exports = ProductVariant; 