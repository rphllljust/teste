/**
 * Read-only database readiness gate. This checks more than an open TCP port:
 * both the canonical migration ledger and essential ERP/Finance/NextCRM tables
 * must be visible in the same PostgreSQL schema.
 * No DDL, data writes, customer records, credentials, or external calls.
 */
export const REQUIRED_ERP_MIGRATIONS = Object.freeze([
  '0000_salty_lilith',
  '0001_native_crm',
  '0002_crm_proposal_origin',
  '0003_nextcrm_document_bridge',
  '0003_finance_audit',
  '0004_cash_transfers',
  '0005_finance_period_closes',
]);
export const REQUIRED_ERP_TABLES = Object.freeze([
  'clients',
  'service_orders',
  'receivables',
  'receivable_settlements',
  'payables',
  'finance_audit_events',
  'finance_period_closes',
  'nextcrm_erp_identity_mappings',
  'nextcrm_erp_client_account_mappings',
  'nextcrm_order_document_links',
]);

const matchesAll = (rows, expected, field) => {
  if (!Array.isArray(rows)) return false;
  const found = new Set(rows.map(row => row?.[field]).filter(value => typeof value === 'string'));
  return expected.every(value => found.has(value));
};

export async function checkErpDatabaseReadiness(query, onFailure = () => {}) {
  if (typeof query !== 'function') throw new TypeError('A PostgreSQL query function is required');
  const migrations = await query(
    'SELECT id FROM _cisne_schema_migrations WHERE id = ANY($1::text[])',
    [REQUIRED_ERP_MIGRATIONS],
  );
  if (!matchesAll(migrations.rows, REQUIRED_ERP_MIGRATIONS, 'id')) {
    onFailure('MIGRATIONS_INCOMPLETE');
    return false;
  }
  const tables = await query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ANY($1::text[])",
    [REQUIRED_ERP_TABLES],
  );
  const ready = matchesAll(tables.rows, REQUIRED_ERP_TABLES, 'table_name');
  if (!ready) onFailure('TABLES_INCOMPLETE');
  return ready;
}
