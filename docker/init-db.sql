-- AggreMart Database Initialization Script
-- This script sets up the initial database configuration

-- Create extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Create database user (if not exists)
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'aggremart_user') THEN
        CREATE ROLE aggremart_user WITH LOGIN PASSWORD 'aggremart_password';
    END IF;
END
$$;

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE aggremart TO aggremart_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO aggremart_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO aggremart_user;

-- Create indexes for better performance (will be created by migrations)
-- These are just placeholders for future optimization 