const { DataTypes, Model, Op } = require('sequelize');
const { sequelize } = require('../../config/sequelize');

class Listing extends Model {
  /**
   * Helper method for defining associations.
   */
  static associate(models) {
    // A listing belongs to a product variant
    Listing.belongsTo(models.ProductVariant, {
      foreignKey: 'variant_id',
      as: 'variant'
    });
  }

  /**
   * Create or update listing
   */
  static async createOrUpdate(variantId, listingData) {
    const [listing, created] = await Listing.findOrCreate({
      where: { 
        variant_id: variantId,
        store_name: listingData.store_name,
        url: listingData.url
      },
      defaults: {
        ...listingData,
        variant_id: variantId,
        scraped_at: new Date(),
        last_seen_at: new Date()
      }
    });

    if (!created) {
      // Update existing listing
      const priceChanged = parseFloat(listing.price) !== parseFloat(listingData.price);
      
      // Add to price history if price changed
      if (priceChanged) {
        const priceHistory = listing.price_history || [];
        priceHistory.push({
          price: listing.price,
          date: listing.updated_at
        });
        
        // Keep only last 30 price points
        if (priceHistory.length > 30) {
          priceHistory.shift();
        }
        
        listingData.price_history = priceHistory;
      }

      await listing.update({
        ...listingData,
        scraped_at: new Date(),
        last_seen_at: new Date()
      });
    }

    return { listing, created };
  }

  /**
   * Get best deals across all stores
   */
  static async getBestDeals(limit = 10, filters = {}) {
    const whereClause = {
      is_active: true,
      stock_status: ['in_stock', 'limited_stock']
    };

    if (filters.store_name) {
      whereClause.store_name = filters.store_name;
    }
    if (filters.min_price) {
      whereClause.price = { [Op.gte]: filters.min_price };
    }
    if (filters.max_price) {
      whereClause.price = { ...whereClause.price, [Op.lte]: filters.max_price };
    }

    return await Listing.findAll({
      where: whereClause,
      include: [
        {
          model: sequelize.models.ProductVariant,
          as: 'variant',
          include: [
            {
              model: sequelize.models.Product,
              as: 'product',
              include: [
                { model: sequelize.models.Brand, as: 'brand' },
                { model: sequelize.models.Category, as: 'category' }
              ]
            }
          ]
        }
      ],
      order: [['price', 'ASC']],
      limit
    });
  }

  /**
   * Get listings by store
   */
  static async getByStore(storeName, page = 1, limit = 20) {
    const offset = (page - 1) * limit;
    
    return await Listing.findAndCountAll({
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
   * Get price comparison for a variant
   */
  static async getPriceComparison(variantId) {
    return await Listing.findAll({
      where: { 
        variant_id: variantId,
        is_active: true
      },
      attributes: [
        'id',
        'store_name',
        'price',
        'original_price',
        'discount_percentage',
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
   * Get listings that need re-scraping
   */
  static async getStaleListings(hoursOld = 24) {
    const staleDate = new Date();
    staleDate.setHours(staleDate.getHours() - hoursOld);

    return await Listing.findAll({
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
   * Mark listings as inactive if not seen recently
   */
  static async deactivateStaleListings(daysOld = 7) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const [affectedCount] = await Listing.update(
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
   * Get top stores by listing count
   */
  static async getTopStores(limit = 10) {
    return await Listing.findAll({
      where: { is_active: true },
      attributes: [
        'store_name',
        [sequelize.fn('COUNT', sequelize.col('id')), 'listing_count'],
        [sequelize.fn('AVG', sequelize.col('price')), 'avg_price'],
        [sequelize.fn('MIN', sequelize.col('price')), 'min_price'],
        [sequelize.fn('MAX', sequelize.col('price')), 'max_price']
      ],
      group: ['store_name'],
      order: [[sequelize.literal('listing_count'), 'DESC']],
      limit
    });
  }



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
   * Check if listing is in stock
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

  /**
   * Add price point to history
   */
  async addPricePoint(price, date = new Date()) {
    const priceHistory = this.price_history || [];
    priceHistory.push({ price, date });
    
    // Keep only last 30 price points
    if (priceHistory.length > 30) {
      priceHistory.shift();
    }
    
    this.price_history = priceHistory;
    await this.save();
  }

  /**
   * Get price trend (up, down, stable)
   */
  getPriceTrend() {
    if (!this.price_history || this.price_history.length < 2) {
      return 'stable';
    }
    
    const recent = this.price_history.slice(-2);
    const oldPrice = parseFloat(recent[0].price);
    const newPrice = parseFloat(recent[1].price);
    
    if (newPrice > oldPrice) return 'up';
    if (newPrice < oldPrice) return 'down';
    return 'stable';
  }

  /**
   * Map availability text to stock status enum
   */
  static mapAvailabilityToStockStatus(availability) {
    if (!availability) return 'in_stock';
    
    const availabilityLower = availability.toLowerCase();
    
    if (availabilityLower.includes('out of stock') || availabilityLower.includes('unavailable')) {
      return 'out_of_stock';
    } else if (availabilityLower.includes('limited') || availabilityLower.includes('few left')) {
      return 'limited_stock';
    } else if (availabilityLower.includes('pre-order') || availabilityLower.includes('coming soon')) {
      return 'pre_order';
    } else {
      return 'in_stock';
    }
  }

  /**
   * Enhanced listing creation with statistics
   * Used by DatabaseInserter for optimized listing creation
   */
  static async insertWithStats(productData, variantId, stats) {
    if (!variantId) return null;

    const source_details = productData.source_details || {};
    const listing_info = productData.listing_info || {};
    const product_identifiers = productData.product_identifiers || {};

    try {
      const listingData = {
        store_name: source_details.source_name || 'unknown',
        title: product_identifiers.original_title || 'Unknown Product',
        url: source_details.url || '',
        price: listing_info.price?.current || 0,
        original_price: listing_info.price?.original || null,
        discount_percentage: listing_info.price?.discount_percent || null,
        currency: listing_info.price?.currency || 'INR',
        rating: listing_info.rating?.score || null,
        review_count: listing_info.rating?.count || 0,
        stock_status: this.mapAvailabilityToStockStatus(listing_info.availability),
        scraped_at: source_details.scraped_at_utc ? new Date(source_details.scraped_at_utc) : new Date()
      };

      const { listing, created } = await Listing.createOrUpdate(variantId, listingData);
      
      if (created) {
        stats.listings.created++;
      } else {
        stats.listings.existing++;
        console.log(`🔄 Updated listing: ${listingData.store_name} - ₹${listingData.price} (${listingData.stock_status})`);
      }
      
      return listing.id;
    } catch (error) {
      console.error(`❌ Error creating listing:`, error.message);
      stats.errors.push(`Listing: ${source_details.url} - ${error.message}`);
      return null;
    }
  }
}

Listing.init({
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
  title: {
    type: DataTypes.TEXT,
    allowNull: false,
    validate: {
      notEmpty: true
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
  discount_percentage: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: true,
    validate: {
      min: 0,
      max: 100
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
  stock_status: {
    type: DataTypes.ENUM('in_stock', 'out_of_stock', 'limited_stock', 'unknown'),
    allowNull: false,
    defaultValue: 'unknown'
  },
  stock_quantity: {
    type: DataTypes.INTEGER,
    allowNull: true,
    validate: {
      min: 0
    }
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
  features: {
    type: DataTypes.JSONB,
    allowNull: true
  },
  scraped_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    allowNull: false
  },
  is_sponsored: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    allowNull: false
  },
  affiliate_url: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  price_history: {
    type: DataTypes.JSONB,
    allowNull: true,
    defaultValue: []
  },
  last_seen_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  }
}, {
  sequelize,
  modelName: 'Listing',
  tableName: 'listings',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      name: 'listings_variant_id_idx',
      fields: ['variant_id']
    },
    {
      name: 'listings_store_name_idx',
      fields: ['store_name']
    },
    {
      name: 'listings_store_product_id_idx',
      fields: ['store_product_id']
    },
    {
      name: 'listings_price_idx',
      fields: ['price']
    },
    {
      name: 'listings_stock_status_idx',
      fields: ['stock_status']
    },
    {
      name: 'listings_active_idx',
      fields: ['is_active']
    },
    {
      name: 'listings_scraped_at_idx',
      fields: ['scraped_at']
    },
    {
      name: 'listings_last_seen_at_idx',
      fields: ['last_seen_at']
    },
    {
      name: 'listings_rating_idx',
      fields: ['rating']
    },
    {
      name: 'listings_discount_idx',
      fields: ['discount_percentage']
    },
    {
      name: 'listings_composite_idx',
      fields: ['variant_id', 'store_name', 'is_active']
    },
    {
      name: 'listings_price_range_idx',
      fields: ['price', 'stock_status', 'is_active']
    }
  ],
  hooks: {
    // No automatic discount calculation - frontend will handle this
  }
});

module.exports = Listing; 