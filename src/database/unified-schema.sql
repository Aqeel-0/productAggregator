-- ============================================================================
-- AggreMart Unified Schema
-- Creates all tables, relationships, indexes, and seed category data in one go.
-- ============================================================================

-- 1. Extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Custom ENUM types
DO $$ BEGIN
    CREATE TYPE product_status AS ENUM ('active', 'discontinued', 'coming_soon');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE stock_status AS ENUM ('in_stock', 'out_of_stock', 'limited_stock', 'unknown');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- TABLES
-- ============================================================================

-- 2.1 brands
CREATE TABLE IF NOT EXISTS brands (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        VARCHAR(100) NOT NULL UNIQUE,
    slug        VARCHAR(100) NOT NULL UNIQUE,
    logo_url    TEXT,
    website_url TEXT,
    description TEXT,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.2 categories (self-referencing tree)
CREATE TABLE IF NOT EXISTS categories (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name          VARCHAR(100) NOT NULL,
    slug          VARCHAR(100) NOT NULL UNIQUE,
    parent_id     UUID REFERENCES categories(id) ON UPDATE CASCADE ON DELETE SET NULL,
    level         INTEGER NOT NULL DEFAULT 0,
    path          TEXT,
    description   TEXT,
    image_url     TEXT,
    icon          VARCHAR(50),
    sort_order    INTEGER NOT NULL DEFAULT 0,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    is_featured   BOOLEAN NOT NULL DEFAULT FALSE,
    product_count INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.3 products
CREATE TABLE IF NOT EXISTS products (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    brand_id            UUID NOT NULL REFERENCES brands(id) ON UPDATE CASCADE ON DELETE CASCADE,
    category_id         UUID REFERENCES categories(id) ON UPDATE CASCADE ON DELETE SET NULL,
    model_name          VARCHAR NOT NULL,
    original_model_name VARCHAR,
    model_number        VARCHAR(100),
    store               VARCHAR(100),
    slug                VARCHAR NOT NULL UNIQUE,
    description         TEXT,
    specifications      JSONB,
    status              product_status NOT NULL DEFAULT 'active',
    variant_count       INTEGER NOT NULL DEFAULT 0,
    min_price           DECIMAL(10,2),
    max_price           DECIMAL(10,2),
    avg_price           DECIMAL(10,2),
    rating              DECIMAL(3,2),
    is_featured         BOOLEAN NOT NULL DEFAULT FALSE,
    launch_date         DATE,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.4 product_variants
CREATE TABLE IF NOT EXISTS product_variants (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id    UUID NOT NULL REFERENCES products(id) ON UPDATE CASCADE ON DELETE CASCADE,
    sku           VARCHAR(100) UNIQUE,
    name          VARCHAR(255) NOT NULL,
    attributes    JSONB NOT NULL DEFAULT '{}',
    images        JSONB,
    listing_count INTEGER NOT NULL DEFAULT 0,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.5 listings
CREATE TABLE IF NOT EXISTS listings (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    variant_id          UUID NOT NULL REFERENCES product_variants(id) ON UPDATE CASCADE ON DELETE CASCADE,
    store_name          VARCHAR(100) NOT NULL,
    store_product_id    VARCHAR(255),
    title               TEXT NOT NULL,
    url                 TEXT NOT NULL UNIQUE,
    price               DECIMAL(10,2) NOT NULL CHECK (price >= 0),
    original_price      DECIMAL(10,2) CHECK (original_price >= 0),
    discount_percentage DECIMAL(5,2) CHECK (discount_percentage >= 0 AND discount_percentage <= 100),
    currency            VARCHAR(3) NOT NULL DEFAULT 'INR',
    stock_status        stock_status NOT NULL DEFAULT 'unknown',
    stock_quantity      INTEGER CHECK (stock_quantity >= 0),
    seller_name         VARCHAR(100),
    seller_rating       DECIMAL(3,2) CHECK (seller_rating >= 0 AND seller_rating <= 5),
    shipping_info       JSONB,
    images              JSONB,
    rating              DECIMAL(3,2) CHECK (rating >= 0 AND rating <= 5),
    review_count        INTEGER NOT NULL DEFAULT 0 CHECK (review_count >= 0),
    features            JSONB,
    scraped_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    is_sponsored        BOOLEAN NOT NULL DEFAULT FALSE,
    affiliate_url       TEXT,
    price_history       JSONB DEFAULT '[]',
    last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.6 offers
CREATE TABLE IF NOT EXISTS offers (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    variant_id          UUID NOT NULL REFERENCES product_variants(id) ON UPDATE CASCADE ON DELETE CASCADE,
    store_name          VARCHAR(100) NOT NULL,
    store_product_id    VARCHAR(255),
    price               DECIMAL(10,2) NOT NULL CHECK (price >= 0),
    original_price      DECIMAL(10,2) CHECK (original_price >= 0),
    currency            VARCHAR(3) NOT NULL DEFAULT 'INR',
    discount_percentage DECIMAL(5,2) CHECK (discount_percentage >= 0 AND discount_percentage <= 100),
    url                 TEXT NOT NULL,
    affiliate_url       TEXT,
    stock_status        stock_status NOT NULL DEFAULT 'unknown',
    seller_name         VARCHAR(100),
    seller_rating       DECIMAL(3,2) CHECK (seller_rating >= 0 AND seller_rating <= 5),
    shipping_info       JSONB,
    rating              DECIMAL(3,2) CHECK (rating >= 0 AND rating <= 5),
    review_count        INTEGER NOT NULL DEFAULT 0 CHECK (review_count >= 0),
    is_sponsored        BOOLEAN NOT NULL DEFAULT FALSE,
    scraped_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- brands
CREATE INDEX IF NOT EXISTS brands_name_idx          ON brands (name);
CREATE INDEX IF NOT EXISTS brands_slug_idx          ON brands (slug);
CREATE INDEX IF NOT EXISTS brands_active_idx        ON brands (is_active);

-- categories
CREATE INDEX IF NOT EXISTS categories_parent_id_idx    ON categories (parent_id);
CREATE INDEX IF NOT EXISTS categories_slug_idx         ON categories (slug);
CREATE INDEX IF NOT EXISTS categories_level_idx        ON categories (level);
CREATE INDEX IF NOT EXISTS categories_path_idx         ON categories (path);
CREATE INDEX IF NOT EXISTS categories_active_idx       ON categories (is_active);
CREATE INDEX IF NOT EXISTS categories_featured_idx     ON categories (is_featured);
CREATE INDEX IF NOT EXISTS categories_sort_order_idx   ON categories (parent_id, sort_order);

-- products
CREATE INDEX IF NOT EXISTS products_brand_id_idx         ON products (brand_id);
CREATE INDEX IF NOT EXISTS products_category_id_idx       ON products (category_id);
CREATE INDEX IF NOT EXISTS products_model_name_idx        ON products (model_name);
CREATE INDEX IF NOT EXISTS products_model_number_idx      ON products (model_number);
CREATE UNIQUE INDEX IF NOT EXISTS products_slug_idx       ON products (slug);
CREATE INDEX IF NOT EXISTS products_status_idx            ON products (status);
CREATE INDEX IF NOT EXISTS products_is_featured_idx       ON products (is_featured);
CREATE INDEX IF NOT EXISTS products_price_range_idx       ON products (min_price, max_price);
CREATE INDEX IF NOT EXISTS products_rating_idx            ON products (rating);
-- Trigram indexes for fuzzy search
CREATE INDEX IF NOT EXISTS products_model_name_trgm_idx   ON products USING GIST (model_name gist_trgm_ops);
CREATE INDEX IF NOT EXISTS products_model_number_trgm_idx ON products USING GIST (model_number gist_trgm_ops);
-- Composite for model-number + brand deduplication
CREATE INDEX IF NOT EXISTS products_brand_model_number_idx ON products (brand_id, model_number) WHERE model_number IS NOT NULL;

-- product_variants
CREATE INDEX IF NOT EXISTS product_variants_product_id_idx  ON product_variants (product_id);
CREATE INDEX IF NOT EXISTS product_variants_sku_idx         ON product_variants (sku);
CREATE INDEX IF NOT EXISTS product_variants_active_idx      ON product_variants (is_active);
CREATE INDEX IF NOT EXISTS product_variants_attributes_idx  ON product_variants USING GIN (attributes);

-- listings
CREATE INDEX IF NOT EXISTS listings_variant_id_idx      ON listings (variant_id);
CREATE INDEX IF NOT EXISTS listings_store_name_idx      ON listings (store_name);
CREATE INDEX IF NOT EXISTS listings_store_product_id_idx ON listings (store_product_id);
CREATE INDEX IF NOT EXISTS listings_price_idx           ON listings (price);
CREATE INDEX IF NOT EXISTS listings_stock_status_idx    ON listings (stock_status);
CREATE INDEX IF NOT EXISTS listings_active_idx          ON listings (is_active);
CREATE INDEX IF NOT EXISTS listings_scraped_at_idx      ON listings (scraped_at);
CREATE INDEX IF NOT EXISTS listings_last_seen_at_idx    ON listings (last_seen_at);
CREATE INDEX IF NOT EXISTS listings_rating_idx          ON listings (rating);
CREATE INDEX IF NOT EXISTS listings_discount_idx        ON listings (discount_percentage);
CREATE INDEX IF NOT EXISTS listings_composite_idx       ON listings (variant_id, store_name, is_active);
CREATE INDEX IF NOT EXISTS listings_price_range_idx     ON listings (price, stock_status, is_active);

-- offers
CREATE INDEX IF NOT EXISTS offers_variant_id_idx               ON offers (variant_id);
CREATE INDEX IF NOT EXISTS offers_store_name_idx               ON offers (store_name);
CREATE INDEX IF NOT EXISTS offers_price_idx                    ON offers (price);
CREATE INDEX IF NOT EXISTS offers_stock_status_idx             ON offers (stock_status);
CREATE INDEX IF NOT EXISTS offers_active_idx                   ON offers (is_active);
CREATE INDEX IF NOT EXISTS offers_scraped_at_idx               ON offers (scraped_at);
CREATE INDEX IF NOT EXISTS offers_last_seen_at_idx             ON offers (last_seen_at);
CREATE UNIQUE INDEX IF NOT EXISTS offers_variant_store_unique_idx ON offers (variant_id, store_name, store_product_id);
CREATE INDEX IF NOT EXISTS offers_price_comparison_idx         ON offers (variant_id, price, is_active);

-- ============================================================================
-- CATEGORY SEED DATA
-- ============================================================================

-- Clear and re-seed categories in the correct FK order
DELETE FROM categories;

WITH
root AS (
    INSERT INTO categories (id, name, slug, parent_id, level, path, description, sort_order, is_featured)
    VALUES (uuid_generate_v4(), 'Home', 'home', NULL, 0, '/home', 'Home and lifestyle products', 1, TRUE)
    RETURNING id, name
),
electronics AS (
    INSERT INTO categories (id, name, slug, parent_id, level, path, description, sort_order, is_featured)
    SELECT uuid_generate_v4(), 'Electronics', 'electronics', root.id, 1, '/home/electronics',
           'Consumer electronics, gadgets, and technology products', 1, TRUE
    FROM root
    RETURNING id, name
),
mobiles_accessories AS (
    INSERT INTO categories (id, name, slug, parent_id, level, path, description, sort_order, is_featured)
    SELECT uuid_generate_v4(), 'Mobiles & Accessories', 'mobiles-accessories', electronics.id, 2,
           '/home/electronics/mobiles-accessories', 'Mobile phones and related accessories', 1, TRUE
    FROM electronics
    RETURNING id, name
),
mobiles AS (
    INSERT INTO categories (id, name, slug, parent_id, level, path, description, sort_order, is_featured)
    SELECT uuid_generate_v4(), 'Mobiles', 'mobiles', mobiles_accessories.id, 3,
           '/home/electronics/mobiles-accessories/mobiles', 'Mobile phones and smartphones', 1, TRUE
    FROM mobiles_accessories
    RETURNING id, name
),
accessories AS (
    INSERT INTO categories (id, name, slug, parent_id, level, path, description, sort_order, is_featured)
    SELECT uuid_generate_v4(), 'Accessories', 'accessories', mobiles_accessories.id, 3,
           '/home/electronics/mobiles-accessories/accessories', 'Mobile phone accessories and add-ons', 2, TRUE
    FROM mobiles_accessories
    RETURNING id, name
),
smartphones AS (
    INSERT INTO categories (id, name, slug, parent_id, level, path, description, sort_order, is_featured)
    SELECT uuid_generate_v4(), 'Smartphones', 'smartphones', mobiles.id, 4,
           '/home/electronics/mobiles-accessories/mobiles/smartphones', 'Advanced smartphones with smart features', 1, TRUE
    FROM mobiles
    RETURNING id, name
),
basic_mobiles AS (
    INSERT INTO categories (id, name, slug, parent_id, level, path, description, sort_order, is_featured)
    SELECT uuid_generate_v4(), 'Basic Mobiles', 'basic-mobiles', mobiles.id, 4,
           '/home/electronics/mobiles-accessories/mobiles/basic-mobiles', 'Basic mobile phones and feature mobiles', 2, FALSE
    FROM mobiles
    RETURNING id, name
),
others AS (
    INSERT INTO categories (id, name, slug, parent_id, level, path, description, sort_order, is_featured)
    SELECT uuid_generate_v4(), 'others', 'others', electronics.id, 4,
           '/home/electronics/others', 'Fallback category for uncategorized products', 99, FALSE
    FROM electronics
    RETURNING id
),
-- Level 5: Brand Smartphones
brand_smartphones AS (
    INSERT INTO categories (id, name, slug, parent_id, level, path, description, sort_order, is_featured)
    SELECT
        uuid_generate_v4(),
        b.name || ' Smartphones',
        lower(regexp_replace(regexp_replace(b.name || '-smartphones', '[^\w\s-]', '', 'g'), '[\s_-]+', '-', 'g')),
        smartphones.id,
        5,
        '/home/electronics/mobiles-accessories/mobiles/smartphones/' ||
            lower(regexp_replace(regexp_replace(b.name || '-smartphones', '[^\w\s-]', '', 'g'), '[\s_-]+', '-', 'g')),
        b.name || ' smartphones and mobile devices',
        b.rn,
        b.rn <= 8
    FROM smartphones,
    (VALUES
        ('Apple',1), ('Samsung',2), ('OnePlus',3), ('Xiaomi',4),
        ('Realme',5), ('OPPO',6), ('Vivo',7), ('POCO',8),
        ('Motorola',9), ('iQOO',10), ('Nothing',11), ('Google',12),
        ('Infinix',13), ('Tecno',14)
    ) AS b(name, rn)
    RETURNING id
),
-- Level 5: Basic Phone Brands
brand_basic AS (
    INSERT INTO categories (id, name, slug, parent_id, level, path, description, sort_order, is_featured)
    SELECT
        uuid_generate_v4(),
        b.name || ' Basic Phones',
        lower(regexp_replace(regexp_replace(b.name || '-basic-phones', '[^\w\s-]', '', 'g'), '[\s_-]+', '-', 'g')),
        basic_mobiles.id,
        5,
        '/home/electronics/mobiles-accessories/mobiles/basic-mobiles/' ||
            lower(regexp_replace(regexp_replace(b.name || '-basic-phones', '[^\w\s-]', '', 'g'), '[\s_-]+', '-', 'g')),
        b.name || ' basic mobile phones and feature phones',
        b.rn,
        FALSE
    FROM basic_mobiles,
    (VALUES
        ('Nokia',1), ('Jio',2), ('Kechaoda',3), ('Lava',4), ('HMD',5), ('Itel',6)
    ) AS b(name, rn)
    RETURNING id
),
-- Level 5: Accessory Categories
acc_categories AS (
    INSERT INTO categories (id, name, slug, parent_id, level, path, description, sort_order, is_featured)
    SELECT
        uuid_generate_v4(),
        a.name,
        lower(regexp_replace(regexp_replace(a.name, '[^\w\s-]', '', 'g'), '[\s_-]+', '-', 'g')),
        accessories.id,
        5,
        '/home/electronics/mobiles-accessories/accessories/' ||
            lower(regexp_replace(regexp_replace(a.name, '[^\w\s-]', '', 'g'), '[\s_-]+', '-', 'g')),
        a.name || ' for mobile phones',
        a.rn,
        a.rn <= 5
    FROM accessories,
    (VALUES
        ('Phone Cases & Covers',1),
        ('Screen Protectors',2),
        ('Chargers & Cables',3),
        ('Power Banks',4),
        ('Earphones & Headphones',5),
        ('Phone Stands & Holders',6),
        ('Car Accessories',7),
        ('Gaming Accessories',8),
        ('Protection & Safety',9)
    ) AS a(name, rn)
    RETURNING id
)
SELECT 'Categories seeded successfully' AS result;
