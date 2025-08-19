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

    // A variant has many listings
    ProductVariant.hasMany(models.Listing, {
      foreignKey: 'variant_id',
      as: 'listings'
    });
  }

  /**
   * Find or create variant by product and attributes
   */
  static async findOrCreateByAttributes(productId, attributes, supabase) {
    const name = await this.generateVariantName(productId, attributes, supabase);

    // Try to find existing variant
    const { data: existingVariant, error: findError } = await supabase
      .from('product_variants')
      .select('*')
      .eq('product_id', productId)
      .eq('attributes', JSON.stringify(attributes))
      .maybeSingle();

    if (findError) throw findError;

    if (existingVariant) {
      return { variant: existingVariant, created: false };
    }

    // Create new variant if not found
    const { data: newVariants, error: insertError } = await supabase
      .from('product_variants')
      .insert([{
        product_id: productId,
        name: name,
        attributes: attributes,
        is_active: true
      }])
      .select();

    if (insertError) throw insertError;
    if (!newVariants || newVariants.length === 0) throw new Error('Variant creation failed');

    return { variant: newVariants[0], created: true };
  }

  /**
   * Generate variant name from product and attributes
   */
  static async generateVariantName(productId, attributes, supabase) {
    const { data: product, error: productError } = await supabase
      .from('products')
      .select(`
        *,
        brands!inner(
          id,
          name
        )
      `)
      .eq('id', productId)
      .single();

    if (productError) throw productError;
    if (!product) return 'Unknown Product Variant';   
    let name = `${product.brands.name} ${product.model_name}`;
    
    if (attributes.color) name += ` - ${attributes.color}`;
    if (attributes.storage_gb) name += `, ${attributes.storage_gb}GB`;
    if (attributes.ram_gb) name += `, ${attributes.ram_gb}GB RAM`;
    return name;
  }


  /**
   * Enhanced variant insertion with caching and statistics
   * Used by DatabaseInserter for optimized variant creation
   */
  /**
   * Normalize color names to prevent duplicates
   */
  static normalizeColor(color) {
    if (!color) return null;
    
    return color
      .toLowerCase()
      .replace(/\s+color\s*$/i, '') // Remove trailing "color" word
      .replace(/\s+/g, ' ') // Normalize spaces
      .trim();
  }

  static async insertWithCache(productData, productId, brandName, cache, stats, supabase) {
    const variant_attributes = productData.variant_attributes || {};
    const listing_info = productData.listing_info || {};
    const { ram, storage, color } = variant_attributes;
    
    if (!productId) return null;

    // Normalize color to prevent duplicates
    const normalizedColor = this.normalizeColor(color);

    // Smart variant key generation based on brand
    const isApple = brandName && brandName.toLowerCase() === 'apple';
    let variantKey;
    
    if (isApple) {
      // For Apple products with missing RAM, use only storage and color
      variantKey = `${productId}:apple:${storage || 0}:${normalizedColor || 'default'}`;
    } else {
      // Standard variant key for all other products
      variantKey = `${productId}:${ram || 0}:${storage || 0}:${normalizedColor || 'default'}`;
    }

    if (cache.has(variantKey)) {
      return cache.get(variantKey);
    }

    try {
      const attributes = {
        ram_gb: ram || null,
        storage_gb: storage || null,
        // FIXED: Original code has this exact line with ternary that does nothing
        color: (typeof normalizedColor !== 'undefined' ? normalizedColor : normalizedColor) || null
      };

      // Prepare images array from listing info
      const images = [];
      if (listing_info.image_url) {
        images.push({
          url: listing_info.image_url,
          type: 'main',
          source: productData.source_details?.source_name || 'unknown',
          scraped_at: productData.source_details?.scraped_at_utc || new Date().toISOString()
        });
      }

      const { variant, created } = await ProductVariant.findOrCreateByAttributes(productId, attributes, supabase);
      
      // Update images if we have new image data
      if (images.length > 0) {
        const existingImages = variant.images || [];
        const imageUrls = existingImages.map(img => img.url);
        
        // Add new images that don't already exist
        const newImages = images.filter(img => !imageUrls.includes(img.url));
        if (newImages.length > 0) {
          const updatedImages = [...existingImages, ...newImages];
          
          // Equivalent to: await variant.update({ images: updatedImages });
          const { error: updateError } = await supabase
            .from('product_variants')
            .update({ images: updatedImages })
            .eq('id', variant.id);

          if (updateError) throw updateError;
        }
      }
      
      cache.set(variantKey, variant.id);
      
      if (created) {
        stats.variants.created++;
        if (isApple && (ram === null || ram === undefined)) {
          // FIXED: Original code doesn't initialize this counter, just increments
          stats.deduplication.apple_variants = (stats.deduplication.apple_variants || 0) + 1;
        }
      } else {
        stats.variants.existing++;
      }
      
      return variant.id;
    } catch (error) {
      console.error(`❌ Error creating variant:`, error.message);
      stats.errors.push(`Variant: ${variantKey} - ${error.message}`);
      return null;
    }
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