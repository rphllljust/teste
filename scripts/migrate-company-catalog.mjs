import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for company catalog migration');

const migrationId = '0006_cisne_company_service_catalog';
const sql = await readFile(new URL('../drizzle-pg/0006_cisne_company_service_catalog.sql', import.meta.url), 'utf8');
const statements = sql.split('--> statement-breakpoint').map(part => part.trim()).filter(Boolean);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5000 });
const client = await pool.connect();

try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock($1)', [510230026]);
  await client.query(`CREATE TABLE IF NOT EXISTS _cisne_schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const existing = await client.query('SELECT 1 FROM _cisne_schema_migrations WHERE id=$1', [migrationId]);
  if (!existing.rowCount) {
    for (const statement of statements) await client.query(statement);
    await client.query('INSERT INTO _cisne_schema_migrations(id) VALUES ($1)', [migrationId]);
  }
  await client.query('COMMIT');
  console.log(`Migration ${migrationId} applied or already present`);
} catch (error) {
  await client.query('ROLLBACK');
  console.error('Company catalog migration failed:', error instanceof Error ? error.stack ?? error.message : error);
  throw error;
} finally {
  client.release();
  await pool.end();
}
