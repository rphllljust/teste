import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for Field PostgreSQL migrations');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5000 });
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock($1)', [510230027]);
  await client.query(`CREATE TABLE IF NOT EXISTS _cisne_field_schema_migrations (
    id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const id = '0006_service_scheduling';
  const applied = await client.query('SELECT 1 FROM _cisne_field_schema_migrations WHERE id=$1', [id]);
  if (!applied.rowCount) {
    const sql = await readFile(new URL('../drizzle-pg/0006_service_scheduling.sql', import.meta.url), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint').map(part => part.trim()).filter(Boolean)) {
      await client.query(statement);
    }
    await client.query('INSERT INTO _cisne_field_schema_migrations(id) VALUES ($1)', [id]);
  }
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
