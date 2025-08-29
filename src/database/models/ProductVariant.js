const { DataTypes, Model, Op } = require('sequelize');
const { sequelize } = require('../../config/sequelize');

class ProductVariant extends Model {

  /**
   * Find or create variant by product and attributes
   */
  static async findOrCreateByAttributes(productId, attributes, supabase, images = null) {
    const name = await this.generateVariantName(productId, attributes, supabase);

    // Try to find existing variant
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
    let name = `${product.brands.name} ${product.original_model_name}`;
    
    if (attributes.ram_gb !== null) {
      name += ` ( ${attributes.ram_gb}GB RAM`;
      if (attributes.storage_gb) name += `, ${attributes.storage_gb}GB`;
      name += ' )';
    } else if (attributes.storage_gb) {
      name += ` (${attributes.storage_gb}GB) `;
    }
    
    if (attributes.color) name += ` - ${attributes.color}`;
    return name;
  }

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
      // Increment existing variants counter when found in cache
      stats.deduplication.variant_match++;
      stats.variants.existing++;
      return cache.get(variantKey);
    }

    try {
      const attributes = {
        ram_gb: ram || null,
        storage_gb: storage || null,
        color: normalizedColor || null
      };

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
                type: 'other',
                source: productData.source_details?.source_name || 'unknown',
                scraped_at: productData.source_details?.scraped_at_utc || new Date().toISOString()
              });
            }
          }
        }
      }

      const { variant, created } = await ProductVariant.findOrCreateByAttributes(productId, attributes, supabase, images);
      
      cache.set(variantKey, variant.id);
      
             if (created) {
         stats.variants.created++;
         
         // Increment variant_count in the product table when new variant is created
         try {
           if (supabase) {
             // Supabase approach - first get current count, then increment
             const { data: currentProduct, error: fetchError } = await supabase
               .from('products')
               .select('variant_count')
               .eq('id', productId)
               .single();
             
             if (!fetchError && currentProduct) {
               const { error: updateError } = await supabase
                 .from('products')
                 .update({ 
                   variant_count: (currentProduct.variant_count || 0) + 1
                 })
                 .eq('id', productId);
               
               if (updateError) {
                 console.error(`❌ Error updating product variant count: ${updateError.message}`);
               }
             }
           } else {
             // Sequelize approach - this will be handled by the calling service
             console.log(`📈 New variant created for product ${productId} - variant count will be updated by service layer`);
           }
         } catch (error) {
           console.error(`❌ Error updating product variant count: ${error.message}`);
         }
         
         if (isApple && (ram === null || ram === undefined)) {
           // FIXED: Original code doesn't initialize this counter, just increments
           stats.deduplication.apple_variants = (stats.deduplication.apple_variants || 0) + 1;
         }
       } else {
         stats.deduplication.variant_match++;
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

module.exports = ProductVariant; 