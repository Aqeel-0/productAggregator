class ProductVariantTablet {

  /**
   * Find or create tablet variant by product and attributes
   */
  static async findOrCreateByAttributes(productId, attributes, supabase, images = null) {
    const name = await this.generateVariantName(productId, attributes, supabase);

    // Try to find existing variant with exact attribute match
    const { data: existingVariant, error: findError } = await supabase
      .from('product_variants')
      .select('*')
      .eq('product_id', productId)
      .contains('attributes', attributes)
      .maybeSingle();

    if (findError) throw findError;

    if (existingVariant) {
      return { variant: existingVariant, created: false };
    }

    // Prepare variant data for insertion
    const variantData = {
      product_id: productId,
      name: name,
      attributes: attributes,
      is_active: true
    };

    // Include images if provided
    if (images && images.length > 0) {
      variantData.images = images;
    }

    // Create new variant if not found
    const { data: newVariants, error: insertError } = await supabase
      .from('product_variants')
      .insert([variantData])
      .select();

    if (insertError) throw insertError;
    if (!newVariants || newVariants.length === 0) throw new Error('Tablet variant creation failed');

    return { variant: newVariants[0], created: true };
  }

  /**
   * Generate tablet variant name from product and attributes
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
    if (!product) return 'Unknown Tablet Variant';   
    let name = `${product.brands.name} ${product.original_model_name}`;
    
    // Tablet variant naming: "Apple 2024 iPad Pro (M4) 2 TB ROM 11.0 Inch with Wi-Fi+5G (Silver)"
    const specs = [];
    
    // Add storage first (convert GB back to TB if needed)
    if (attributes.storage_gb) {
      if (attributes.storage_gb >= 1024) {
        const tb = (attributes.storage_gb / 1024).toFixed(0);
        specs.push(`${tb} TB ROM`);
      } else {
        specs.push(`${attributes.storage_gb} GB ROM`);
      }
    }
    
    // Add display size
    if (attributes.display_size) {
      specs.push(`${attributes.display_size} Inch`);
    }
    
    // Add connectivity
    if (attributes.connectivity_type) {
      specs.push(`with ${attributes.connectivity_type}`);
    }
    
    // Add color last
    if (attributes.color) {
      specs.push(`(${attributes.color})`);
    }
    
    if (specs.length > 0) {
      name += ` ${specs.join(' ')}`;
    }
    
    return name;
  }

  /**
   * Normalize color name for consistent matching
   */
  static normalizeColor(color) {
    if (!color || typeof color !== 'string') return null;
    
    return color
      .toLowerCase()
      .replace(/\s+/g, ' ') // Normalize spaces
      .replace(/\s+color\s*$/i, '') // Remove trailing "color" word
      .replace(/\s+/g, ' ') // Normalize spaces again
      .trim();
  }

  /**
   * Create a safe attributes object for Supabase
   */
  static createSafeAttributes(ram, storage, color, display_size, connectivity_type, isApple) {
    const safeAttributes = {};
    
    // Handle RAM - always null for Apple tablets
    if (isApple) {
      safeAttributes.ram_gb = null;
    } else {
      const ramNum = ram ? Number(ram) : null;
      safeAttributes.ram_gb = (ramNum !== null && !isNaN(ramNum) && isFinite(ramNum)) ? ramNum : null;
    }
    
    // Handle Storage
    const storageNum = storage ? Number(storage) : null;
    safeAttributes.storage_gb = (storageNum !== null && !isNaN(storageNum) && isFinite(storageNum)) ? storageNum : null;
    
    // Handle Color
    safeAttributes.color = color ? String(color).trim() : null;
    if (safeAttributes.color === '') {
      safeAttributes.color = null;
    }
    
    // Handle Display Size
    const displayNum = display_size ? Number(display_size) : null;
    safeAttributes.display_size = (displayNum !== null && !isNaN(displayNum) && isFinite(displayNum)) ? displayNum : null;
    
    // Handle Connectivity Type
    safeAttributes.connectivity_type = connectivity_type ? String(connectivity_type).trim() : null;
    if (safeAttributes.connectivity_type === '') {
      safeAttributes.connectivity_type = null;
    }
    
    return safeAttributes;
  }

  /**
   * Insert tablet variant with caching
   */
  static async insertWithCache(productData, productId, brandName, cache, stats, supabase) {
    const variant_attributes = productData.variant_attributes || {};
    const listing_info = productData.listing_info || {};
    const { ram, storage, color, display_size, connectivity_type } = variant_attributes;

    // Check if this is an Apple tablet
    const isApple = brandName && brandName.toLowerCase().includes('apple');
    
    // Normalize color
    const normalizedColor = this.normalizeColor(color);
    
    // Generate variant key for caching
    const variantKey = `${productId}:tablet:${ram || 0}:${storage || 0}:${normalizedColor || 'default'}:${display_size || 0}:${connectivity_type || 'default'}`;
    
    // Check cache first
    if (cache.has(variantKey)) {
      stats.deduplication.variant_match++;
      stats.variants.existing++;
      return cache.get(variantKey);
    }

    try {
      // Create safe attributes
      const attributes = this.createSafeAttributes(ram, storage, normalizedColor, display_size, connectivity_type, isApple);
      
      // Prepare images array from listing info
      const images = [];
      let mainImageAdded = false;
      
      // Add main image if available
      if (listing_info.image_url) {
        images.push({
          url: listing_info.image_url,
          type: 'main',
          source: productData.source_details?.source_name || 'unknown',
          scraped_at: productData.source_details?.scraped_at_utc || new Date().toISOString()
        });
        mainImageAdded = true;
      }
      
      // Add other images if available
      if (listing_info.image_urls && Array.isArray(listing_info.image_urls)) {
        for (const imageUrl of listing_info.image_urls) {
          if (imageUrl && typeof imageUrl === 'string') {
            // If main image not added, make first image main
            if (!mainImageAdded) {
              images.push({
                url: imageUrl,
                type: 'main',
                source: productData.source_details?.source_name || 'unknown',
                scraped_at: productData.source_details?.scraped_at_utc || new Date().toISOString()
              });
              mainImageAdded = true;
            } else {
              images.push({
                url: imageUrl,
                type: 'gallery',
                source: productData.source_details?.source_name || 'unknown',
                scraped_at: productData.source_details?.scraped_at_utc || new Date().toISOString()
              });
            }
          }
        }
      }

      const { variant, created } = await ProductVariantTablet.findOrCreateByAttributes(productId, attributes, supabase, images);
      
      cache.set(variantKey, variant.id);
      
      if (created) {
        stats.variants.created++;
      } else {
        stats.variants.existing++;
      }
      
      return variant.id;
      
    } catch (error) {
      console.error(`❌ Error creating tablet variant for product ${productId}:`, error.message);
      stats.errors.push(`Tablet variant creation failed: ${error.message}`);
      return null;
    }
  }
}

module.exports = ProductVariantTablet;