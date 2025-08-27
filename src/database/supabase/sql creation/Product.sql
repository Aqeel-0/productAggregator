-- Create ENUM type for status
CREATE TYPE product_status AS ENUM ('active', 'discontinued', 'coming_soon');

-- Create products table
CREATE TABLE IF NOT EXISTS public.products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID NOT NULL REFERENCES public.brands(id) ON UPDATE CASCADE ON DELETE CASCADE,
    category_id UUID REFERENCES public.categories(id) ON UPDATE CASCADE ON DELETE SET NULL,
    model_name VARCHAR NOT NULL,
    model_number VARCHAR(100),
    slug VARCHAR NOT NULL UNIQUE,
    description TEXT,
    specifications JSONB,
    status product_status NOT NULL DEFAULT 'active',
    variant_count INTEGER NOT NULL DEFAULT 0,
    min_price DECIMAL(10,2),
    max_price DECIMAL(10,2),
    avg_price DECIMAL(10,2),
    rating DECIMAL(3,2),
    is_featured BOOLEAN NOT NULL DEFAULT FALSE,
    launch_date DATE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS products_brand_id_idx ON public.products(brand_id);
CREATE INDEX IF NOT EXISTS products_category_id_idx ON public.products(category_id);
CREATE INDEX IF NOT EXISTS products_model_name_idx ON public.products(model_name);
CREATE INDEX IF NOT EXISTS products_model_number_idx ON public.products(model_number);
CREATE UNIQUE INDEX IF NOT EXISTS products_slug_idx ON public.products(slug);
CREATE INDEX IF NOT EXISTS products_status_idx ON public.products(status);
CREATE INDEX IF NOT EXISTS products_is_featured_idx ON public.products(is_featured);
CREATE INDEX IF NOT EXISTS products_price_range_idx ON public.products(min_price, max_price);
CREATE INDEX IF NOT EXISTS products_rating_idx ON public.products(rating);

-- Drop table
DROP TABLE IF EXISTS public.products;
DROP TYPE IF EXISTS product_status;