'use strict';

const fs = require('fs');
const path = require('path');

describe('Database Migrations Integration Tests', () => {
  
  describe('Migration File Structure', () => {
    test('should have migration files with proper naming', () => {
      const migrationsDir = path.join(__dirname, '../../migrations');
      
      if (!fs.existsSync(migrationsDir)) {
        console.log('Migrations directory not found, skipping test');
        return;
      }
      
      const migrationFiles = fs.readdirSync(migrationsDir)
        .filter(file => file.endsWith('.sql'));
      
      // Check naming pattern: YYYYMMDDHHMMSS_description.sql
      const namingPattern = /^\d{14}_[a-z0-9_]+\.sql$/;
      
      for (const file of migrationFiles) {
        expect(file).toMatch(namingPattern);
      }
      
      // Should have at least one migration file
      expect(migrationFiles.length).toBeGreaterThan(0);
    });
    
    test('should have migration files in chronological order', () => {
      const migrationsDir = path.join(__dirname, '../../migrations');
      
      if (!fs.existsSync(migrationsDir)) {
        console.log('Migrations directory not found, skipping test');
        return;
      }
      
      const migrationFiles = fs.readdirSync(migrationsDir)
        .filter(file => file.endsWith('.sql'))
        .sort();
      
      // Extract timestamps and verify they're in order
      const timestamps = migrationFiles.map(file => 
        parseInt(file.split('_')[0])
      );
      
      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i]).toBeGreaterThan(timestamps[i - 1]);
      }
    });
    
    test('should have valid SQL content in migration files', () => {
      const migrationsDir = path.join(__dirname, '../../migrations');
      
      if (!fs.existsSync(migrationsDir)) {
        console.log('Migrations directory not found, skipping test');
        return;
      }
      
      const migrationFiles = fs.readdirSync(migrationsDir)
        .filter(file => file.endsWith('.sql'));
      
      for (const file of migrationFiles) {
        const filePath = path.join(migrationsDir, file);
        const content = fs.readFileSync(filePath, 'utf8');
        
        // Should contain SQL comments
        expect(content).toMatch(/--.*/);
        
        // Should contain CREATE or ALTER statements
        expect(content).toMatch(/CREATE|ALTER/i);
        
        // Should not contain dangerous operations
        expect(content.toLowerCase()).not.toMatch(/drop\s+database|truncate\s+table/i);
      }
    });
  });
  
  describe('Configuration Files', () => {
    test('should have migration configuration file', () => {
      const configPath = path.join(__dirname, '../../migrator-config.js');
      expect(fs.existsSync(configPath)).toBe(true);
    });
    
    test('should have docker compose file', () => {
      const dockerComposePath = path.join(__dirname, '../../docker-compose.dev.yml');
      expect(fs.existsSync(dockerComposePath)).toBe(true);
    });
    
    test('should have database initialization script', () => {
      const initScriptPath = path.join(__dirname, '../../scripts/init-db.sql');
      expect(fs.existsSync(initScriptPath)).toBe(true);
    });
  });
  
  describe('Package.json Scripts', () => {
    test('should have migration scripts in package.json', () => {
      const packageJsonPath = path.join(__dirname, '../../package.json');
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      
      const expectedScripts = [
        'db:migrate',
        'db:migrate:down',
        'db:migrate:create',
        'db:migrate:reset',
        'db:setup'
      ];
      
      for (const script of expectedScripts) {
        expect(packageJson.scripts).toHaveProperty(script);
      }
    });
    
    test('should have correct migration script commands', () => {
      const packageJsonPath = path.join(__dirname, '../../package.json');
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      
      expect(packageJson.scripts['db:migrate']).toBe('node-pg-migrate up');
      expect(packageJson.scripts['db:migrate:down']).toBe('node-pg-migrate down');
      expect(packageJson.scripts['db:migrate:create']).toBe('node-pg-migrate create');
      expect(packageJson.scripts['db:migrate:reset']).toBe('node-pg-migrate reset');
    });
  });
  
  describe('Documentation', () => {
    test('should have migration documentation', () => {
      const docPath = path.join(__dirname, '../../DB_MIGRATIONS.md');
      expect(fs.existsSync(docPath)).toBe(true);
    });
    
    test('should have documentation with key sections', () => {
      const docPath = path.join(__dirname, '../../DB_MIGRATIONS.md');
      
      if (!fs.existsSync(docPath)) {
        console.log('Migration documentation not found, skipping test');
        return;
      }
      
      const content = fs.readFileSync(docPath, 'utf8');
      
      // Should contain key sections
      expect(content).toMatch(/## Quick Start/);
      expect(content).toMatch(/## Migration Commands/);
      expect(content).toMatch(/## Database Schema/);
      expect(content).toMatch(/## Production Deployment/);
      expect(content).toMatch(/## Troubleshooting/);
    });
  });
});
