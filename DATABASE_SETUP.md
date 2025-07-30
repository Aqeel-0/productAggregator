# Database Setup and Data Insertion Guide

This guide will help you set up the database and insert your normalized product data.

## Prerequisites

1. **Database Server**: Ensure you have PostgreSQL installed and running
2. **Database Configuration**: Update `config/config.js` with your database credentials
3. **Normalized Data**: Ensure you have the normalized data files:
   - `parsed_data/amazon_normalized_data.json`
   - `parsed_data/flipkart_normalized_data.json`

## Database Schema Updates

The current database schema has been enhanced to support our normalized data structure:

### New Tables and Fields

1. **Products Table Updates**:
   - Added `model_number` field
   - Added `specifications` JSONB field
   - Added price statistics fields (`min_price`, `max_price`, `avg_price`)
   - Added `rating` and `is_featured` fields
   - Added `status` enum field

2. **New Listings Table**:
   - Replaces the old `offers` table
   - Stores store-specific product listings
   - Includes pricing, rating, and availability data
   - Supports price history tracking

3. **Enhanced Relationships**:
   - Brand → Products (one-to-many)
   - Category → Products (hierarchical categories)
   - Product → ProductVariants (one-to-many)
   - ProductVariant → Listings (one-to-many)

## Setup Steps

### Step 1: Setup Database Schema

```bash
# Setup database tables and schema
node setup-database.js
```

This will:
- Test database connectivity
- Create/update all necessary tables
- Set up proper indexes and relationships

### Step 2: Insert Normalized Data

```bash
# Insert product data from normalized files
node insert-normalized-data.js
```

This will:
- Process Amazon normalized data
- Process Flipkart normalized data
- Create brands, categories, products, variants, and listings
- Update product statistics
- Provide detailed progress and error reporting

## Data Structure

### Input Data Format

The insertion script expects normalized data in this format:

```json
{
  "source_details": {
    "source_name": "amazon|flipkart",
    "url": "product_url",
    "scraped_at_utc": "2025-01-29T..."
  },
  "product_identifiers": {
    "brand": "Samsung",
    "model_name": "Galaxy M05",
    "original_title": "Full product title",
    "model_number": "SM-M055F"
  },
  "variant_attributes": {
    "color": "Mint Green",
    "ram": 4,
    "storage": 64
  },
  "listing_info": {
    "price": {
      "current": 6499,
      "original": 9999,
      "discount_percent": 35,
      "currency": "INR"
    },
    "rating": {
      "score": 4.0,
      "count": 5130
    },
    "image_url": "image_url"
  },
  "key_specifications": {
    "display": { ... },
    "performance": { ... },
    "camera": { ... },
    "battery": { ... }
  },
  "source_metadata": {
    "category_breadcrumb": ["Electronics", "Mobiles", "Smartphones"]
  }
}
```

### Database Output Structure

#### Products
- Basic product information (name, model number, specifications)
- Brand and category relationships
- Aggregated pricing and rating statistics
- Variant count

#### Product Variants
- RAM, storage, and color combinations
- Links to parent product

#### Listings
- Store-specific pricing and availability
- Product ratings and reviews
- Links to variant

## Features

### Intelligent Deduplication
- Products are deduplicated by brand + model name + model number
- Variants are deduplicated by product + RAM + storage + color
- Listings are updated if they already exist

### Category Hierarchy
- Automatically creates nested category structure from breadcrumbs
- Supports unlimited nesting levels
- Maintains category paths and levels

### Statistics Tracking
- Tracks price min/max/average across all variants
- Updates product statistics after all data is inserted
- Provides detailed insertion statistics

### Error Handling
- Comprehensive error logging
- Continues processing even if individual items fail
- Provides detailed error report at the end

### Progress Tracking
- Real-time progress updates during insertion
- Batch progress indicators (every 25 items)
- Separate tracking for Amazon and Flipkart data

## Expected Results

After successful insertion, you'll have:

1. **Brands**: Unique brands extracted from product data
2. **Categories**: Hierarchical category structure from breadcrumbs
3. **Products**: Unique products with specifications and statistics
4. **Product Variants**: RAM/storage/color combinations
5. **Listings**: Store-specific pricing and availability data

## Troubleshooting

### Common Issues

1. **Database Connection Failed**
   - Check your database is running
   - Verify credentials in `config/config.js`
   - Ensure database exists

2. **Schema Errors**
   - Run `node setup-database.js` first
   - Check for any migration conflicts

3. **Data Format Errors**
   - Verify normalized data files exist
   - Check JSON format is valid
   - Ensure data follows expected structure

4. **Memory Issues**
   - For large datasets, consider processing in smaller batches
   - Monitor memory usage during insertion

### Performance Tips

1. **Database Optimization**
   - Ensure proper database configuration
   - Consider increasing connection pool size
   - Monitor disk space and performance

2. **Batch Processing**
   - The script processes items sequentially to avoid overwhelming the database
   - Progress is saved as it goes, so interruptions are recoverable

## Verification

After insertion, you can verify the data:

```sql
-- Check record counts
SELECT 'brands' as table_name, count(*) as count FROM brands
UNION ALL
SELECT 'categories', count(*) FROM categories  
UNION ALL
SELECT 'products', count(*) FROM products
UNION ALL
SELECT 'product_variants', count(*) FROM product_variants
UNION ALL
SELECT 'listings', count(*) FROM listings;

-- Check sample data
SELECT p.name, b.name as brand, pv.attributes, l.store_name, l.price 
FROM products p
JOIN brands b ON p.brand_id = b.id
JOIN product_variants pv ON pv.product_id = p.id
JOIN listings l ON l.variant_id = pv.id
LIMIT 10;
```

## Next Steps

After successful data insertion:

1. **API Development**: Use the structured data in your product API
2. **Search Implementation**: Leverage the hierarchical categories and specifications
3. **Price Monitoring**: Use the listings data for price tracking
4. **Analytics**: Analyze brand distribution, pricing trends, etc.

## Support

If you encounter issues:

1. Check the error logs from the insertion script
2. Verify your database configuration
3. Ensure data files are in the correct format
4. Review the troubleshooting section above 