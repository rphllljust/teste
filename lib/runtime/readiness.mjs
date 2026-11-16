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

/** @param {(category: string) => void} [onFailure] */
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

/** Returns a bounded operator-only category; never reveal DSNs, hosts or errors. */
export function classifyReadinessError(error, databaseUrl) {
  if (typeof databaseUrl !== 'string' || !databaseUrl.trim())
    return 'DATABASE_URL_MISSING';
  if (databaseUrl.includes('${{')) return 'DATABASE_URL_UNRESOLVED';
  try {
    const url = new URL(databaseUrl);
    if (!['postgres:', 'postgresql:'].includes(url.protocol))
      return 'DATABASE_URL_INVALID';
  } catch { return 'DATABASE_URL_INVALID'; }
  const code = error && typeof error === 'object' && typeof error.code === 'string'
    ? error.code : '';
  if (/^[A-Z0-9_]{2,32}$/.test(code)) return 'DB_CODE_' + code;
  return error instanceof TypeError ? 'DB_TYPE_ERROR' : 'DB_QUERY_FAILED';
}
