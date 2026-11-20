import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { PROTECTED_MIGRATION, validateRestoreAttestation } from './migration-safety.mjs';
import { assertNextcrmMigrationPreflight, NEXTCRM_BRIDGE_MIGRATIONS, NEXTCRM_BRIDGE_TABLES } from './nextcrm-migration-preflight.mjs';

// Source-controlled, append-only migrations. Neither this script nor its
// connection string may point to the isolated NextCRM database.
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for PostgreSQL migrations');
const migrations = [
  { id: '0000_salty_lilith', file: '../drizzle-pg/0000_salty_lilith.sql' },
  { id: '0001_native_crm', file: '../drizzle-pg/0001_native_crm.sql' },
  { id: '0002_crm_proposal_origin', file: '../drizzle-pg/0002_crm_proposal_origin.sql' },
  { id: '0003_nextcrm_document_bridge', file: '../drizzle-pg/0003_nextcrm_document_bridge.sql' },
  { id: '0003_finance_audit', file: '../drizzle-pg/0003_finance_audit.sql' },
  { id: '0004_cash_transfers', file: '../drizzle-pg/0004_cash_transfers.sql' },
  { id: '0005_finance_period_closes', file: '../drizzle-pg/0005_finance_period_closes.sql' },
  { id: '0006_professionals', file: '../drizzle-pg/0006_professionals.sql' },
  { id: '0007_assets', file: '../drizzle-pg/0007_assets.sql' },
  { id: '0008_inventory_ledger', file: '../drizzle-pg/0008_inventory_ledger.sql' },
  { id: '0009_workflow_approvals', file: '../drizzle-pg/0009_workflow_approvals.sql' },
  { id: '0010_resource_allocations', file: '../drizzle-pg/0010_resource_allocations.sql' },
  { id: '0011_inventory_consumption', file: '../drizzle-pg/0011_inventory_consumption.sql' },
  { id: '0012_field_service_measurements', file: '../drizzle-pg/0012_field_service_measurements.sql' },
  { id: '0013_workflow_business_commands', file: '../drizzle-pg/0013_workflow_business_commands.sql' },
];

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5000 });
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock($1)', [510230026]);
  await client.query(`CREATE TABLE IF NOT EXISTS _cisne_schema_migrations (
    id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  // Preflight BEFORE running any historical migration. The finance-first and
  // document-first ledgers use different IDs for the SAME NextCRM objects.
  // A transaction rollback preserves the existing ledger and domain records.
  const knownIds = Object.values(NEXTCRM_BRIDGE_MIGRATIONS);
  const [appliedNextcrm, existingNextcrmTables] = await Promise.all([
    client.query('SELECT id FROM _cisne_schema_migrations WHERE id = ANY($1::text[])', [knownIds]),
    client.query(`SELECT c.relname AS name FROM pg_catalog.pg_class AS c
      JOIN pg_catalog.pg_namespace AS n ON n.oid=c.relnamespace
      WHERE n.nspname=current_schema() AND c.relkind IN ('r','p')
        AND c.relname = ANY($1::text[])`, [NEXTCRM_BRIDGE_TABLES]),
  ]);
  assertNextcrmMigrationPreflight({
    manifestIds: migrations.map(migration => migration.id),
    appliedIds: appliedNextcrm.rows.map(row => row.id),
    presentTables: existingNextcrmTables.rows.map(row => row.name),
  });
  const completed = await client.query('SELECT id FROM _cisne_schema_migrations WHERE id=$1', [PROTECTED_MIGRATION]);
  if (!completed.rowCount) {
    const protectedSql = await readFile(new URL('../drizzle-pg/' + PROTECTED_MIGRATION + '.sql', import.meta.url), 'utf8');
    validateRestoreAttestation({ migrationId: PROTECTED_MIGRATION, sql: protectedSql });
  }
  const nextcrmMigration = '0003_nextcrm_document_bridge';
  const nextcrmApplied = await client.query('SELECT id FROM _cisne_schema_migrations WHERE id=$1', [nextcrmMigration]);
  if (!nextcrmApplied.rowCount) {
    const nextcrmSql = await readFile(new URL('../drizzle-pg/' + nextcrmMigration + '.sql', import.meta.url), 'utf8');
    validateRestoreAttestation({ migrationId: nextcrmMigration, sql: nextcrmSql, env: { ...process.env, CISNE_DB_RESTORE_ATTESTATION: process.env.CISNE_DB_RESTORE_ATTESTATION_0003 } });
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
