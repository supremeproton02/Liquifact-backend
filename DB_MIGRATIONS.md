# Database Migrations Guide

This guide covers database migrations, local development setup, and deployment procedures for the LiquiFact backend.

## Overview

LiquiFact uses **node-pg-migrate** for database migration management with PostgreSQL. This approach provides:
- SQL-first migration control
- Seamless integration with existing Knex setup
- Production-safe transaction handling
- Multi-tenant architecture support

## Quick Start

### 1. Local Development with Docker

```bash
# Start PostgreSQL and Redis
docker-compose -f docker-compose.dev.yml up -d

# Wait for services to be ready
docker-compose -f docker-compose.dev.yml ps

# Install dependencies
npm install

# Run database migrations
npm run db:migrate

# Start the application
npm run dev
```

### 2. Environment Configuration

Copy `.env.example` to `.env` and configure:

```bash
# Database configuration
DATABASE_URL=postgresql://liquifact_user:liquifact_dev_password@localhost:5432/liquifact

# Alternative configuration (if not using DATABASE_URL)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=liquifact
DB_USER=liquifact_user
DB_PASSWORD=liquifact_dev_password

# Redis (optional, for caching)
REDIS_URL=redis://localhost:6379
REDIS_ESCROW_CACHE_ENABLED=true
```

## Migration Commands

### Available NPM Scripts

```bash
# Run all pending migrations
npm run db:migrate

# Rollback last migration
npm run db:migrate:down

# Create new migration file
npm run db:migrate:create <migration_name>

# Reset database (drop and re-run all migrations)
npm run db:migrate:reset

# Setup database (run migrations)
npm run db:setup
```

### Migration File Creation

```bash
# Create a new migration
npm run db:migrate:create add_user_preferences_table

# This creates: migrations/YYYYMMDDHHMMSS_add_user_preferences_table.sql
```

## Migration File Structure

Each migration file follows the naming convention: `YYYYMMDDHHMMSS_descriptive_name.sql`

### Example Migration

```sql
-- Migration: 20240425000000_create_invoices_table.sql

-- Up migration (runs when migrating up)
CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    amount DECIMAL(15,2) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Down migration (runs when rolling back)
-- Commented out as node-pg-migrate handles rollback automatically
-- DROP TABLE IF EXISTS invoices;
```

## Database Schema

### Core Tables

1. **tenants** - Multi-tenant organization management
2. **users** - User accounts with tenant isolation
3. **api_keys** - API key management for programmatic access
4. **invoices** - Core invoice financing data
5. **escrow_operations** - Stellar escrow operation tracking
6. **escrow_summaries** - Cached escrow state for performance
7. **audit_logs** - Comprehensive audit trail

### Key Features

- **Multi-tenant Architecture**: Row Level Security (RLS) ensures data isolation
- **Soft Deletes**: `deleted_at` timestamps for data recovery
- **Audit Trail**: Complete operation logging
- **UUID Primary Keys**: Distributed-friendly identifiers
- **JSONB Metadata**: Flexible schema evolution

## Development Workflow

### 1. Making Schema Changes

```bash
# 1. Create migration
npm run db:migrate:create add_new_feature_table

# 2. Edit the generated migration file
# Add your SQL changes to the migration file

# 3. Run migration locally
npm run db:migrate

# 4. Test your changes
# Run tests, manual verification, etc.

# 5. Commit migration file
git add migrations/YYYYMMDDHHMMSS_add_new_feature_table.sql
git commit -m "feat: add new feature table"
```

### 2. Testing Migrations

```bash
# Test against clean database
docker-compose -f docker-compose.dev.yml down -v
docker-compose -f docker-compose.dev.yml up -d
npm run db:migrate

# Test rollback
npm run db:migrate:down
npm run db:migrate

# Run full test suite
npm test
```

## Production Deployment

### 1. Database Setup

```bash
# Set production environment
export NODE_ENV=production

# Run migrations (single transaction mode)
npm run db:migrate
```

### 2. Migration Safety

- Production migrations run in single transaction mode
- Automatic rollback on failure
- Migration lock prevents concurrent executions
- Comprehensive logging and error handling

### 3. Backup Strategy

```bash
# Always backup before major migrations
pg_dump $DATABASE_URL > backup_before_migration.sql

# Run migration
npm run db:migrate

# Verify results
# If issues occur, restore from backup
```

## Environment-Specific Configuration

### Development
```javascript
// migrator-config.js - development
{
  connection: {
    host: 'localhost',
    port: 5432,
    database: 'liquifact',
    user: 'liquifact_user',
    password: 'liquifact_dev_password'
  },
  singleTransaction: false
}
```

### Test
```javascript
// migrator-config.js - test
{
  connection: {
    host: 'localhost',
    port: 5433,
    database: 'liquifact_test',
    user: 'test_user',
    password: 'test_password'
  },
  singleTransaction: true
}
```

### Production
```javascript
// migrator-config.js - production
{
  connection: {
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  },
  singleTransaction: true
}
```

## Troubleshooting

### Common Issues

1. **Migration Lock Timeout**
   ```bash
   # Check for stuck locks
   psql $DATABASE_URL -c "SELECT * FROM migration_lock;"
   
   # Clear stuck lock (emergency only)
   psql $DATABASE_URL -c "DELETE FROM migration_lock;"
   ```

2. **Connection Issues**
   ```bash
   # Verify database connectivity
   docker-compose -f docker-compose.dev.yml exec postgres psql -U liquifact_user -d liquifact -c "SELECT 1;"
   ```

3. **Migration Rollback Issues**
   ```bash
   # Check migration status
   psql $DATABASE_URL -c "SELECT * FROM schema_migrations ORDER BY run_on;"
   
   # Force reset (emergency)
   npm run db:migrate:reset
   ```

### Performance Considerations

- Use indexes for frequently queried columns
- Consider partitioning for large tables
- Monitor query performance with `EXPLAIN ANALYZE`
- Use connection pooling (configured in Knex)

## Security Notes

### Database Security

- Use environment variables for credentials
- Enable SSL in production
- Implement proper user permissions
- Regular security updates for PostgreSQL

### Migration Security

- Never commit sensitive data to migrations
- Review migration files before deployment
- Use read-only users for application access
- Implement audit logging for DDL changes

## Integration with Existing Code

### Knex Integration

The migration system integrates seamlessly with existing Knex setup:

```javascript
// src/db/kex.js - unchanged
const knex = require('knex');
const config = {
  client: 'pg',
  connection: process.env.DATABASE_URL || 'postgresql://user:pass@localhost:5432/liquifact',
  pool: { min: 2, max: 10 }
};
```

### Application Usage

```javascript
// Example: Using the database in routes
const db = require('../db/knex');

app.get('/api/invoices', async (req, res) => {
  const invoices = await db('invoices')
    .where('tenant_id', req.tenantId)
    .whereNull('deleted_at');
  
  res.json({ data: invoices });
});
```

## Testing

### Unit Tests

```bash
# Run tests with test database
npm test

# Tests automatically use isolated test database
# Migrations run before each test suite
```

### Integration Tests

```bash
# Run integration tests
npm run test:integration

# Tests cover migration rollback scenarios
# Verify data integrity after migrations
```

## Additional Resources

- [node-pg-migrate Documentation](https://salsita.github.io/node-pg-migrate/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Knex.js Documentation](https://knexjs.org/)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
