import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for PostgreSQL migrations');
const sql = await readFile(new URL('../drizzle-pg/0000_salty_lilith.sql', import.meta.url), 'utf8');
const statements = sql.split('--> statement-breakpoint').map((part) => part.trim()).filter(Boolean);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5000 });
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query(`CREATE TABLE IF NOT EXISTS _cisne_schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const { rows } = await client.query('SELECT id FROM _cisne_schema_migrations WHERE id=$1', ['0000_salty_lilith']);
  if (!rows.length) {
    for (const statement of statements) await client.query(statement);
    await client.query('INSERT INTO _cisne_schema_migrations(id) VALUES ($1)', ['0000_salty_lilith']);
  }
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
