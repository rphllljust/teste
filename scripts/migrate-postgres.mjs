import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';

// Source-controlled, append-only migrations. Neither this script nor its
// connection string may point to the isolated NextCRM database.
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for PostgreSQL migrations');

const migrations = [
  { id: '0000_salty_lilith', file: '../drizzle-pg/0000_salty_lilith.sql' },
  { id: '0001_nextcrm_order_document_links', file: '../drizzle-pg/0001_nextcrm_order_document_links.sql' },
];

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5000 });
const client = await pool.connect();
try {
  for (const migration of migrations) {
    await client.query('BEGIN');
    try {
      // Serialize concurrent predeploy migration processes in the same DB.
      await client.query("SELECT pg_advisory_xact_lock(510230026::bigint)");
      await client.query(`CREATE TABLE IF NOT EXISTS _cisne_schema_migrations (
        id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
      )`);
      const result = await client.query(
        'SELECT id FROM _cisne_schema_migrations WHERE id=$1',
        [migration.id],
      );
      if (!result.rows.length) {
        const sql = await readFile(new URL(migration.file, import.meta.url), 'utf8');
        const statements = sql.split('--> statement-breakpoint')
          .map(part => part.trim()).filter(Boolean);
        for (const statement of statements) await client.query(statement);
        await client.query(
          'INSERT INTO _cisne_schema_migrations(id) VALUES ($1)',
          [migration.id],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
} finally {
  client.release();
  await pool.end();
}
