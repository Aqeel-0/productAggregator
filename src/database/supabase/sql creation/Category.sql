CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS public.categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL UNIQUE,
    parent_id UUID REFERENCES public.categories (id) ON UPDATE CASCADE ON DELETE SET NULL,
    level INTEGER NOT NULL DEFAULT 0,
    path TEXT,
    description TEXT,
    image_url TEXT,
    icon VARCHAR(50),
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_featured BOOLEAN NOT NULL DEFAULT FALSE,
    product_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS categories_parent_id_idx ON public.categories(parent_id);
CREATE INDEX IF NOT EXISTS categories_slug_idx ON public.categories(slug);
CREATE INDEX IF NOT EXISTS categories_level_idx ON public.categories(level);
CREATE INDEX IF NOT EXISTS categories_path_idx ON public.categories(path);
CREATE INDEX IF NOT EXISTS categories_active_idx ON public.categories(is_active);
CREATE INDEX IF NOT EXISTS categories_featured_idx ON public.categories(is_featured);
CREATE INDEX IF NOT EXISTS categories_sort_order_idx ON public.categories(parent_id, sort_order);

-- Drop table
DROP TABLE IF EXISTS public.categories;

-- 