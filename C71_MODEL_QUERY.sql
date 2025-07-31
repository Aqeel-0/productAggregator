-- Complete C71 Model Analysis Query
-- This query shows all details, variants, and listings for C71 models

WITH c71_products AS (
  SELECT 
    p.id as product_id,
    p.model_name,
    p.model_number,
    p.specifications,
    b.name as brand_name,
    c.name as category_name,
    c.path as category_path,
    p.variant_count,
    p.created_at as product_created
  FROM products p
  JOIN brands b ON p.brand_id = b.id
  JOIN categories c ON p.category_id = c.id
  WHERE p.model_name ILIKE '%C71%'
),
c71_variants AS (
  SELECT 
    pv.id as variant_id,
    pv.product_id,
    pv.attributes,
    pv.created_at as variant_created,
    p.model_name,
    p.brand_name
  FROM product_variants pv
  JOIN c71_products p ON pv.product_id = p.product_id
  WHERE pv.is_active = true
),
c71_listings AS (
  SELECT 
    l.id as listing_id,
    l.variant_id,
    l.store_name,
    l.title,
    l.url,
    l.price,
    l.original_price,
    l.discount_percentage,
    l.currency,
    l.rating,
    l.review_count,
    l.stock_status,
    l.scraped_at,
    l.created_at as listing_created,
    v.model_name,
    v.brand_name
  FROM listings l
  JOIN c71_variants v ON l.variant_id = v.variant_id
  WHERE l.is_active = true
)
SELECT 
  -- Product Information
  p.product_id,
  p.brand_name,
  p.model_name,
  p.model_number,
  p.category_name,
  p.category_path,
  p.variant_count,
  p.product_created,
  
  -- Variant Information
  v.variant_id,
  v.attributes,
  v.variant_created,
  
  -- Listing Information
  l.listing_id,
  l.store_name,
  l.title,
  l.url,
  l.price,
  l.original_price,
  l.discount_percentage,
  l.currency,
  l.rating,
  l.review_count,
  l.stock_status,
  l.scraped_at,
  l.listing_created
FROM c71_products p
LEFT JOIN c71_variants v ON p.product_id = v.product_id
LEFT JOIN c71_listings l ON v.variant_id = l.variant_id
ORDER BY p.brand_name, p.model_name, v.variant_id, l.store_name;

-- Alternative simpler query for quick overview
-- SELECT 
--   p.id as product_id,
--   p.model_name,
--   p.model_number,
--   b.name as brand_name,
--   c.name as category_name,
--   p.variant_count,
--   COUNT(pv.id) as actual_variants,
--   COUNT(l.id) as total_listings
-- FROM products p
-- JOIN brands b ON p.brand_id = b.id
-- JOIN categories c ON p.category_id = c.id
-- LEFT JOIN product_variants pv ON p.id = pv.product_id AND pv.is_active = true
-- LEFT JOIN listings l ON pv.id = l.variant_id AND l.is_active = true
-- WHERE p.model_name ILIKE '%C71%'
-- GROUP BY p.id, p.model_name, p.model_number, b.name, c.name, p.variant_count
-- ORDER BY p.model_name;

-- Query to see all variants for C71 models
-- SELECT 
--   p.model_name,
--   pv.id as variant_id,
--   pv.attributes,
--   COUNT(l.id) as listing_count
-- FROM products p
-- JOIN product_variants pv ON p.id = pv.product_id
-- LEFT JOIN listings l ON pv.id = l.variant_id AND l.is_active = true
-- WHERE p.model_name ILIKE '%C71%' AND pv.is_active = true
-- GROUP BY p.model_name, pv.id, pv.attributes
-- ORDER BY p.model_name, pv.id;

-- Query to see all listings for C71 models with store comparison
-- SELECT 
--   p.model_name,
--   pv.attributes,
--   l.store_name,
--   l.title,
--   l.price,
--   l.original_price,
--   l.discount_percentage,
--   l.rating,
--   l.review_count,
--   l.stock_status
-- FROM products p
-- JOIN product_variants pv ON p.id = pv.product_id
-- JOIN listings l ON pv.id = l.variant_id
-- WHERE p.model_name ILIKE '%C71%' 
--   AND pv.is_active = true 
--   AND l.is_active = true
-- ORDER BY p.model_name, pv.attributes, l.store_name; 