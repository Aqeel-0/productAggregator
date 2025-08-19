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
   * Create or update listing
   */
  static async createOrUpdate(variantId, listingData, supabase) {
    const { data: existingListing, error: findError } = await supabase
      .from('listings')
      .select('*')
      .eq('variant_id', variantId)
      .eq('store_name', listingData.store_name)
      .eq('url', listingData.url)
      .maybeSingle();

    if (findError) throw findError;

    if (!existingListing) {
      // Create new listing - equivalent to the 'defaults' in findOrCreate
      const { data: newListings, error: insertError } = await supabase
        .from('listings')
        .insert([{
          ...listingData,
          variant_id: variantId,
          scraped_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString()
        }])
        .select();

      if (insertError) throw insertError;
      if (!newListings || newListings.length === 0) throw new Error('Listing creation failed');

      return { listing: newListings[0], created: true };
    }

    // Update existing listing - exactly matching original logic
    const priceChanged = parseFloat(existingListing.price) !== parseFloat(listingData.price);
    
    // Add to price history if price changed
    let updatedListingData = { ...listingData };
    if (priceChanged) {
      const priceHistory = existingListing.price_history || [];
      priceHistory.push({
        price: existingListing.price,
        date: existingListing.updated_at
      });
      
      // Keep only last 30 price points
      if (priceHistory.length > 30) {
        priceHistory.shift();
      }
      
      updatedListingData.price_history = priceHistory;
    }

    // Equivalent to: await listing.update({...listingData, scraped_at: new Date(), last_seen_at: new Date()})
    const { data: updatedListings, error: updateError } = await supabase
      .from('listings')
      .update({
        ...updatedListingData,
        scraped_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString()
      })
      .eq('id', existingListing.id)
      .select();

    if (updateError) throw updateError;

    return { listing: updatedListings[0] || existingListing, created: false };
  }

  /**
   * Enhanced listing creation with statistics
   * Used by DatabaseInserter for optimized listing creation
   */
  static async insertWithStats(productData, variantId, stats, supabase) {
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
        scraped_at: source_details.scraped_at_utc ? new Date(source_details.scraped_at_utc).toISOString() : new Date().toISOString()
      };
  
      const { listing, created } = await Listing.createOrUpdate(variantId, listingData, supabase);
      
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