const { DataTypes, Model, Op } = require('sequelize');
const { sequelize } = require('../../config/sequelize');

class Offer extends Model {
  /**
   * Helper method for defining associations.
   */
  static associate(models) {
    // An offer belongs to a product variant
    Offer.belongsTo(models.ProductVariant, {
      foreignKey: 'variant_id',
      as: 'variant'
    });
  }

  /**
   * Create or update offer
   */
  static async createOrUpdate(variantId, offerData) {
    const [offer, created] = await Offer.findOrCreate({
      where: { 
        variant_id: variantId,
        store_name: offerData.store_name,
        store_product_id: offerData.store_product_id
      },
      defaults: {
        ...offerData,
        variant_id: variantId,
        scraped_at: new Date(),
        last_seen_at: new Date()
      }
    });

    if (!created) {
      // Update existing offer
      const priceChanged = parseFloat(offer.price) !== parseFloat(offerData.price);
      
      await offer.update({
        ...offerData,
        scraped_at: new Date(),
        last_seen_at: new Date()
      });
    }

    return { offer, created };
  }

  /**
   * Get best offers for a variant
   */
  static async getBestOffers(variantId, limit = 5) {
    return await Offer.findAll({
      where: { 
        variant_id: variantId,
        is_active: true,
        stock_status: ['in_stock', 'limited_stock']
      },
      order: [['price', 'ASC']],
      limit
    });
  }

  /**
   * Get price comparison for a variant across all stores
   */
  static async getPriceComparison(variantId) {
    return await Offer.findAll({
      where: { 
        variant_id: variantId,
        is_active: true
      },
      attributes: [
        'id',
        'store_name',
        'price',
        'original_price',
        'currency',
        'stock_status',
        'seller_name',
        'seller_rating',
        'shipping_info',
        'url',
        'affiliate_url',
        'scraped_at'
      ],
      order: [['price', 'ASC']]
    });
  }

  /**
   * Get offers by store
   */
  static async getByStore(storeName, page = 1, limit = 20) {
    const offset = (page - 1) * limit;
    
    return await Offer.findAndCountAll({
      where: { 
        store_name: storeName,
        is_active: true
      },
      include: [
        {
          model: sequelize.models.ProductVariant,
          as: 'variant',
          include: [
            {
              model: sequelize.models.Product,
              as: 'product',
              include: [
                { model: sequelize.models.Brand, as: 'brand' }
              ]
            }
          ]
        }
      ],
      order: [['price', 'ASC']],
      limit,
      offset
    });
  }

  /**
   * Get offers that need re-scraping
   */
  static async getStaleOffers(hoursOld = 24) {
    const staleDate = new Date();
    staleDate.setHours(staleDate.getHours() - hoursOld);

    return await Offer.findAll({
      where: {
        last_seen_at: {
          [Op.lt]: staleDate
        },
        is_active: true
      },
      include: [
        {
          model: sequelize.models.ProductVariant,
          as: 'variant',
          include: [
            {
              model: sequelize.models.Product,
              as: 'product'
            }
          ]
        }
      ],
      order: [['last_seen_at', 'ASC']]
    });
  }

  /**
   * Mark offers as inactive if not seen recently
   */
  static async deactivateStaleOffers(daysOld = 7) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const [affectedCount] = await Offer.update(
      { is_active: false },
      {
        where: {
          last_seen_at: {
            [Op.lt]: cutoffDate
          },
          is_active: true
        }
      }
    );

    return affectedCount;
  }

  /**
   * Get top stores by offer count
   */
  static async getTopStores(limit = 10) {
    return await Offer.findAll({
      where: { is_active: true },
      attributes: [
        'store_name',
        [sequelize.fn('COUNT', sequelize.col('id')), 'offer_count'],
        [sequelize.fn('AVG', sequelize.col('price')), 'avg_price'],
        [sequelize.fn('MIN', sequelize.col('price')), 'min_price'],
        [sequelize.fn('MAX', sequelize.col('price')), 'max_price']
      ],
      group: ['store_name'],
      order: [[sequelize.literal('offer_count'), 'DESC']],
      limit
    });
  }

  /**
   * Calculate discount percentage
   */
  calculateDiscount() {
    if (this.original_price && this.price) {
      const discount = ((this.original_price - this.price) / this.original_price) * 100;
      return Math.round(discount * 100) / 100; // Round to 2 decimal places
    }
    return 0;
  }

  /**
   * Check if offer has good deal (high discount)
   */
  isGoodDeal(threshold = 20) {
    return this.calculateDiscount() >= threshold;
  }

  /**
   * Get formatted price with currency
   */
  getFormattedPrice() {
    const currencySymbols = {
      'INR': '₹',
      'USD': '$',
      'EUR': '€',
      'GBP': '£'
    };
    
    const symbol = currencySymbols[this.currency] || this.currency;
    return `${symbol}${this.price}`;
  }

  /**
   * Check if offer is in stock
   */
  isInStock() {
    return this.stock_status === 'in_stock' || this.stock_status === 'limited_stock';
  }

  /**
   * Get shipping cost from shipping info
   */
  getShippingCost() {
    if (this.shipping_info && this.shipping_info.cost) {
      return this.shipping_info.cost;
    }
    return 0;
  }

  /**
   * Get total cost including shipping
   */
  getTotalCost() {
    return parseFloat(this.price) + this.getShippingCost();
  }

  /**
   * Update last seen timestamp
   */
  async markAsSeen() {
    this.last_seen_at = new Date();
    await this.save();
  }
}

Offer.init({
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  variant_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'product_variants',
      key: 'id'
    }
  },
  store_name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    validate: {
      notEmpty: true,
      len: [1, 100]
    }
  },
  store_product_id: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  price: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    validate: {
      min: 0
    }
  },
  original_price: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    validate: {
      min: 0
    }
  },
  currency: {
    type: DataTypes.STRING(3),
    allowNull: false,
    defaultValue: 'INR',
    validate: {
      isIn: [['INR', 'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD']]
    }
  },
  url: {
    type: DataTypes.TEXT,
    allowNull: false,
    validate: {
      notEmpty: true,
      isUrl: true
    }
  },
  affiliate_url: {
    type: DataTypes.TEXT,
    allowNull: true,
    validate: {
      isUrl: true
    }
  },
  stock_status: {
    type: DataTypes.ENUM('in_stock', 'out_of_stock', 'limited_stock', 'unknown'),
    allowNull: false,
    defaultValue: 'unknown'
  },
  seller_name: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  seller_rating: {
    type: DataTypes.DECIMAL(3, 2),
    allowNull: true,
    validate: {
      min: 0,
      max: 5
    }
  },
  shipping_info: {
    type: DataTypes.JSONB,
    allowNull: true
  },
  rating: {
    type: DataTypes.DECIMAL(3, 2),
    allowNull: true,
    validate: {
      min: 0,
      max: 5
    }
  },
  review_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    allowNull: false,
    validate: {
      min: 0
    }
  },
  is_sponsored: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    allowNull: false
  },
  scraped_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  last_seen_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    allowNull: false
  }
}, {
  sequelize,
  modelName: 'Offer',
  tableName: 'offers',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      name: 'offers_variant_id_idx',
      fields: ['variant_id']
    },
    {
      name: 'offers_store_name_idx',
      fields: ['store_name']
    },
    {
      name: 'offers_price_idx',
      fields: ['price']
    },
    {
      name: 'offers_stock_status_idx',
      fields: ['stock_status']
    },
    {
      name: 'offers_active_idx',
      fields: ['is_active']
    },
    {
      name: 'offers_scraped_at_idx',
      fields: ['scraped_at']
    },
    {
      name: 'offers_last_seen_at_idx',
      fields: ['last_seen_at']
    },
    {
      name: 'offers_variant_store_unique_idx',
      unique: true,
      fields: ['variant_id', 'store_name', 'store_product_id']
    },
    {
      name: 'offers_price_comparison_idx',
      fields: ['variant_id', 'price', 'is_active']
    }
  ],
  hooks: {
    beforeSave: (offer) => {
      // Auto-calculate discount percentage
      if (offer.original_price && offer.price) {
        offer.discount_percentage = offer.calculateDiscount();
      }
    }
  }
});

module.exports = Offer; 