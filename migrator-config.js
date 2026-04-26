require('dotenv').config();

/**
 * Migration configuration for node-pg-migrate
 * @type {Object}
 */
const config = {
  // Database connection
  client: 'pg',
  connection: {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'liquifact',
    user: process.env.DB_USER || 'liquifact_user',
    password: process.env.DB_PASSWORD || 'liquifact_dev_password',
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  },
  
  // Migration directory
  dir: 'migrations',
  
  // Migration table name
  migrationsTable: 'schema_migrations',
  
  // Enable/disable foreign key checks during migrations
  disableIntercept: false,
  
  // Single transaction mode (safer for production)
  singleTransaction: process.env.NODE_ENV === 'production',
  
  // Run migrations in order
  createMigrationsTable: true,
  
  // Migration file naming pattern
  pattern: /^\d{14}_[a-z0-9_]+\.sql$/,
  
  // Custom migration options
  migrations: {
    tableName: 'schema_migrations',
    directory: 'migrations'
  },
  
  // Logging
  log: {
    warn: console.warn,
    error: console.error,
    info: console.info,
    debug: console.debug
  },
  
  // Schema lock to prevent concurrent migrations
  lock: {
    table: 'migration_lock',
    timeout: 30000 // 30 seconds
  }
};

// Export configuration for different environments
module.exports = {
  development: config,
  test: {
    ...config,
    connection: {
      host: process.env.TEST_DB_HOST || 'localhost',
      port: process.env.TEST_DB_PORT || 5433,
      database: process.env.TEST_DB_NAME || 'liquifact_test',
      user: process.env.TEST_DB_USER || 'test_user',
      password: process.env.TEST_DB_PASSWORD || 'test_password'
    },
    singleTransaction: true
  },
  production: {
    ...config,
    connection: {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    },
    singleTransaction: true,
    migrations: {
      ...config.migrations,
      lock: {
        table: 'migration_lock',
        timeout: 60000 // 60 seconds for production
      }
    }
  }
};
