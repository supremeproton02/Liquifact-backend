-- Database initialization script for LiquiFact
-- This script runs automatically when PostgreSQL container starts

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Create schema migrations table if it doesn't exist
-- This will be managed by node-pg-migrate, but we ensure it exists
CREATE TABLE IF NOT EXISTS schema_migrations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    run_on TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Set default timezone
SET timezone = 'UTC';

-- Create basic indexes that will be useful for common queries
-- These will be created in migration files, but we prepare the database

-- Log successful initialization
DO $$
BEGIN
    RAISE NOTICE 'LiquiFact database initialized successfully';
END $$;
