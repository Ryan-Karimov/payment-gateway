import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../../config/database.js';
import { hashApiKey } from '../../utils/crypto.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runMigrations(): Promise<void> {
  console.log('Starting database migrations...');

  try {
    // Check connection
    const client = await pool.connect();
    console.log('Connected to database');

    // Create migrations table if not exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    // Check if schema has been applied
    const { rows } = await client.query(
      "SELECT name FROM migrations WHERE name = 'initial_schema'"
    );

    if (rows.length === 0) {
      console.log('Applying initial schema...');

      // Read and execute schema
      const schemaPath = join(__dirname, '..', 'schema.sql');
      const schema = readFileSync(schemaPath, 'utf-8');

      await client.query(schema);

      // Record migration
      await client.query(
        "INSERT INTO migrations (name) VALUES ('initial_schema')"
      );

      console.log('Initial schema applied successfully');
    } else {
      console.log('Initial schema already applied, skipping');
    }

    // Seed default API key for testing (only in non-production)
    if (process.env['NODE_ENV'] !== 'production') {
      const { rows: apiKeyRows } = await client.query(
        "SELECT id FROM api_keys WHERE merchant_id = 'test_merchant'"
      );

      if (apiKeyRows.length === 0) {
        console.log('Creating test API key...');

        // SECURITY: Hash the API key before storing
        const testApiKey = 'sk_test_a1b2c3d4e5f6g7h8i9j0';
        const hashedKey = hashApiKey(testApiKey);

        await client.query(`
          INSERT INTO api_keys (key_hash, merchant_id, name, permissions)
          VALUES (
            $1,
            'test_merchant',
            'Test API Key',
            '["payments:read", "payments:write", "refunds:write"]'::jsonb
          )
        `, [hashedKey]);

        console.log('Test API key created: sk_test_a1b2c3d4e5f6g7h8i9j0');
        console.log('Stored hash:', hashedKey);
      }
    } else {
      console.log('Skipping test API key creation in production environment');
    }

    client.release();
    console.log('Migrations completed successfully');

  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigrations();
