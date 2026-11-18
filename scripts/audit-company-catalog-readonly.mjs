/**
 * Read-only, fail-closed evidence of company catalog migration 0006.
 * Never changes database rows, migrations or approvals.
 */
import {pathToFileURL} from 'node:url';

const MIGRATION_ID = '0006_cisne_company_service_catalog';
const COMPANY_CNPJ = '11897171000181';

export function assertCompanyCatalogEvidence(evidence) {
  const required = [
    'migrationApplied', 'companyTable', 'catalogTable', 'orderTable',
    'orderCatalogColumn', 'catalogCompanyFk', 'orderCatalogFk',
    'catalogIndex', 'orderIndex',
  ];
  for (const field of required) {
    if (evidence[field] !== true) throw new Error('COMPANY_CATALOG_NO_GO: ' + field);
  }
  if (evidence.companyStatus !== 'active' || evidence.companyCnpj !== COMPANY_CNPJ) {
    throw new Error('COMPANY_CATALOG_NO_GO: company profile missing or inactive');
  }
  if (!Number.isInteger(evidence.serviceCount) || evidence.serviceCount < 20) {
    throw new Error('COMPANY_CATALOG_NO_GO: expected 20 seeded service records');
  }
  if (!Number.isInteger(evidence.activeServiceCount) || evidence.activeServiceCount < 1) {
    throw new Error('COMPANY_CATALOG_NO_GO: no active services');
  }
  return {migrationId:MIGRATION_ID, companyCnpj:COMPANY_CNPJ,
    serviceCount:evidence.serviceCount, activeServiceCount:evidence.activeServiceCount};
}

export async function auditCompanyCatalog(client) {
  const structureSql = [
    'SELECT EXISTS (SELECT 1 FROM _cisne_schema_migrations WHERE id=$1) AS "migrationApplied",',
    "to_regclass('company_profiles') IS NOT NULL AS \"companyTable\",",
    "to_regclass('service_catalog') IS NOT NULL AS \"catalogTable\",",
    "to_regclass('service_orders') IS NOT NULL AS \"orderTable\"",
  ].join(' ');
  const structure = (await client.query(structureSql, [MIGRATION_ID])).rows[0];
  for (const name of ['migrationApplied','companyTable','catalogTable','orderTable']) {
    if (structure?.[name] !== true) throw new Error('COMPANY_CATALOG_NO_GO: ' + name);
  }
  const constraintsSql = [
    'SELECT EXISTS (SELECT 1 FROM information_schema.columns',
    " WHERE table_schema=current_schema() AND table_name='service_orders'",
    " AND column_name='service_catalog_id') AS \"orderCatalogColumn\",",
    ' EXISTS (SELECT 1 FROM pg_constraint c',
    ' JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)',
    " WHERE c.conrelid='service_catalog'::regclass",
    " AND c.confrelid='company_profiles'::regclass",
    " AND c.contype='f' AND c.convalidated AND a.attname='company_cnpj'",
    ') AS "catalogCompanyFk",',
    ' EXISTS (SELECT 1 FROM pg_constraint c',
    ' JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)',
    " WHERE c.conrelid='service_orders'::regclass",
    " AND c.confrelid='service_catalog'::regclass",
    " AND c.contype='f' AND c.convalidated AND a.attname='service_catalog_id'",
    ') AS "orderCatalogFk",',
    ' EXISTS (SELECT 1 FROM pg_class idx JOIN pg_index i ON i.indexrelid=idx.oid',
    " WHERE idx.relname='service_catalog_active_category_idx'",
    " AND i.indrelid='service_catalog'::regclass AND i.indisvalid AND i.indisready",
    ') AS "catalogIndex",',
    ' EXISTS (SELECT 1 FROM pg_class idx JOIN pg_index i ON i.indexrelid=idx.oid',
    " WHERE idx.relname='service_orders_catalog_idx'",
    " AND i.indrelid='service_orders'::regclass AND i.indisvalid AND i.indisready",
    ') AS "orderIndex"',
  ].join(' ');
  const constraints = (await client.query(constraintsSql)).rows[0];
  const companySql = [
    'SELECT c.cnpj AS "companyCnpj", c.status AS "companyStatus",',
    'count(s.id)::int AS "serviceCount",',
    'count(s.id) FILTER (WHERE s.active)::int AS "activeServiceCount"',
    'FROM company_profiles c LEFT JOIN service_catalog s ON s.company_cnpj=c.cnpj',
    'WHERE c.cnpj=$1 GROUP BY c.cnpj,c.status',
  ].join(' ');
  const company = (await client.query(companySql, [COMPANY_CNPJ])).rows[0];
  return assertCompanyCatalogEvidence({...structure,...constraints,...company});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
  const {Pool} = await import('pg');
  const pool = new Pool({connectionString:process.env.DATABASE_URL, max:1,
    connectionTimeoutMillis:5000});
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const result = await auditCompanyCatalog(client);
    await client.query('COMMIT');
    console.log('COMPANY_CATALOG_EVIDENCE_OK ' + JSON.stringify(result));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
