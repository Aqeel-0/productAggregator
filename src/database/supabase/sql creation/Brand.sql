CREATE TABLE IF NOT EXISTS public.brands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    slug VARCHAR(100) NOT NULL UNIQUE,
    logo_url TEXT,
    website_url TEXT,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index on name
CREATE INDEX IF NOT EXISTS brands_name_idx ON public.brands (name);

-- Index on slug
CREATE INDEX IF NOT EXISTS brands_slug_idx ON public.brands (slug);

-- Index on is_active
CREATE INDEX IF NOT EXISTS brands_active_idx ON public.brands (is_active);
