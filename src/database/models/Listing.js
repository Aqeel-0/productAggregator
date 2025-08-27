class Listing {

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
   * Create or update listing with optimized database calls
   */
  static async createOrUpdate(variantId, listingData, supabase) {
    // Use upsert with URL as the unique identifier for better performance
    const upsertData = {
      ...listingData,
      variant_id: variantId,
      scraped_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString()
    };

    // For upsert, we need to specify the conflict resolution columns
    const { data: result, error: upsertError } = await supabase
      .from('listings')
      .upsert([upsertData], {
        onConflict: 'url',
        ignoreDuplicates: false
      })
      .select('*')
      .single();

    if (upsertError) throw upsertError;
    if (!result) throw new Error('Listing upsert failed');

    // Check if this was a new listing by looking for created_at vs updated_at
    const wasCreated = result.created_at === result.updated_at;
    
    // If it's a new listing, increment the variant's listing_count
    if (wasCreated) {
      try {
        await this.incrementVariantListingCount(variantId, supabase);
      } catch (error) {
        console.warn(`⚠️ Warning: Could not increment listing count for variant ${variantId}:`, error.message);
        // Continue processing even if listing count increment fails
      }
    }

    return { listing: result, created: wasCreated };
  }

  /**
   * Increment listing_count for a product variant
   */
  static async incrementVariantListingCount(variantId, supabase) {
    try {
      // First get the current listing_count
      const { data: variant, error: fetchError } = await supabase
        .from('product_variants')
        .select('listing_count')
        .eq('id', variantId)
        .single();

      if (fetchError) throw fetchError;

      // Then update with the incremented value
      const currentCount = variant?.listing_count || 0;
      const { error: updateError } = await supabase
        .from('product_variants')
        .update({ 
          listing_count: currentCount + 1
        })
        .eq('id', variantId);

      if (updateError) {
        console.warn(`⚠️ Warning: Could not increment listing_count for variant ${variantId}:`, updateError.message);
      }
    } catch (error) {
      console.warn(`⚠️ Warning: Error incrementing listing_count for variant ${variantId}:`, error.message);
    }
  }

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
        // Only log price changes to reduce noise
        if (listing.price !== listingData.price) {
          console.log(`💰 Price update: ${listingData.store_name} - ₹${listing.price} → ₹${listingData.price}`);
        }
      }
      
      return listing.id;
    } catch (error) {
      console.error(`❌ Error creating listing:`, error.message);
      stats.errors.push(`Listing: ${source_details.url} - ${error.message}`);
      return null;
    }
  }

  /**
   * Update price history for an existing listing (called only when needed)
   */
  static async updatePriceHistory(listingId, oldPrice, newPrice, supabase) {
    try {
      // Get current price history
      const { data: listing, error: fetchError } = await supabase
        .from('listings')
        .select('price_history')
        .eq('id', listingId)
        .single();

      if (fetchError) throw fetchError;

      const priceHistory = listing?.price_history || [];
      
      // Add old price to history
      priceHistory.push({
        price: oldPrice,
        date: new Date().toISOString()
      });
      
      // Keep only last 30 price points
      if (priceHistory.length > 30) {
        priceHistory.shift();
      }
      
      // Update the listing with new price history
      const { error: updateError } = await supabase
        .from('listings')
        .update({ price_history: priceHistory })
        .eq('id', listingId);

      if (updateError) throw updateError;
    } catch (error) {
      console.warn(`⚠️ Warning: Could not update price history for listing ${listingId}:`, error.message);
    }
  }
}

module.exports = Listing; 