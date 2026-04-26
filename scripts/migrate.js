#!/usr/bin/env node

/**
 * Script to run database migrations for API keys.
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.API_KEYS_DB_PATH || path.join(__dirname, 'data/api_keys.db');
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new sqlite3.Database(DB_PATH);

console.log('Running migrations...');

fs.readdirSync(MIGRATIONS_DIR).sort().forEach(file => {
  if (file.endsWith('.sql')) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    console.log(`Running ${file}...`);
    db.exec(sql, (err) => {
      if (err) {
        console.error(`Error in ${file}:`, err);
        process.exit(1);
      }
    });
  }
});

db.close((err) => {
  if (err) {
    console.error('Error closing DB:', err);
    process.exit(1);
  }
  console.log('Migrations completed.');
});