import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { PROTECTED_MIGRATION, validateRestoreAttestation } from './migration-safety.mjs';

// Source-controlled, append-only migrations. Neither this script nor its
// connection string may point to the isolated NextCRM database.
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for PostgreSQL migrations');
const migrations = [
  { id: '0000_salty_lilith', file: '../drizzle-pg/0000_salty_lilith.sql' },
  { id: '0001_native_crm', file: '../drizzle-pg/0001_native_crm.sql' },
  { id: '0001_nextcrm_order_document_links', file: '../drizzle-pg/0001_nextcrm_order_document_links.sql' },
  { id: '0002_crm_proposal_origin', file: '../drizzle-pg/0002_crm_proposal_origin.sql' },
  { id: '0002_nextcrm_verified_mappings', file: '../drizzle-pg/0002_nextcrm_verified_mappings.sql' },
  { id: '0003_finance_audit', file: '../drizzle-pg/0003_finance_audit.sql' },
  { id: '0004_cash_transfers', file: '../drizzle-pg/0004_cash_transfers.sql' },
  { id: '0005_finance_period_closes', file: '../drizzle-pg/0005_finance_period_closes.sql' },
];

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5000 });
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock($1)', [510230026]);
  await client.query(`CREATE TABLE IF NOT EXISTS _cisne_schema_migrations (
    id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const completed = await client.query('SELECT id FROM _cisne_schema_migrations WHERE id=$1', [PROTECTED_MIGRATION]);
  if (!completed.rowCount) {
    const protectedSql = await readFile(new URL('../drizzle-pg/' + PROTECTED_MIGRATION + '.sql', import.meta.url), 'utf8');
    validateRestoreAttestation({ migrationId: PROTECTED_MIGRATION, sql: protectedSql });
  }
  for (const migration of migrations) {
    const result = await client.query('SELECT id FROM _cisne_schema_migrations WHERE id=$1', [migration.id]);
    if (result.rows.length) continue;
    const sql = await readFile(new URL(migration.file, import.meta.url), 'utf8');
    const statements = sql.split('--> statement-breakpoint').map(part => part.trim()).filter(Boolean);
    for (const statement of statements) await client.query(statement);
    await client.query('INSERT INTO _cisne_schema_migrations(id) VALUES ($1)', [migration.id]);
  }
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
