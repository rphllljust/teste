import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';

/**
 * Two legacy histories, one expected resulting catalog.
 * Only runs on disposable localhost PostgreSQL in GitHub Actions.
 * All fixture schemas are created inside a transaction that is ROLLED BACK.
 */
function refuseNonEphemeralDatabase(env = process.env) {
  if (env.NODE_ENV !== 'test' || env.GITHUB_ACTIONS !== 'true' ||
      env.CI !== 'true') throw new Error('LINEAGE_NO_GO_NOT_CI');
  let target;
  try { target = new URL(env.DATABASE_URL ?? ''); }
  catch { throw new Error('LINEAGE_NO_GO_DATABASE_URL'); }
  if (target.protocol !== 'postgresql:' ||
      !['127.0.0.1', 'localhost'].includes(target.hostname) ||
      !['/cisne_ci', '/cisne_test'].includes(target.pathname) ||
      target.port !== '5432') throw new Error('LINEAGE_NO_GO_NON_EPHEMERAL_DATABASE');
  return env.DATABASE_URL;
}

function safeIdent(name) {
  if (!/^[a-z][a-z0-9_]{2,60}$/.test(name)) throw new Error('LINEAGE_INVALID_SCHEMA');
  return '"' + name + '"';
}

function statements(sql) {
  return sql.split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean);
}

async function readSql(name) {
  return readFile(new URL('../drizzle-pg/' + name, import.meta.url), 'utf8');
}

async function executeMigration(db, name) {
  const sql = await readSql(name);
  for (const statement of statements(sql)) await db.query(statement);
}

const relevant = [
  'nextcrm_erp_identity_mappings', 'nextcrm_erp_client_account_mappings',
  'nextcrm_order_document_links', 'nextcrm_order_document_events',
];

function normalizeDefinition(text, schema) {
  if (text == null) return null;
  return String(text).replaceAll('"' + schema + '".', '<schema>.')
    .replaceAll(schema + '.', '<schema>.')
    .replace(/\s+/g, ' ').trim();
}

/** Normalized catalog includes columns, NOT NULL, defaults, constraints, indexes and triggers. */
async function fingerprint(db, schema) {
  const columns = await db.query(
    'SELECT c.relname AS table_name,a.attname AS column_name,' +
    ' pg_catalog.format_type(a.atttypid,a.atttypmod) AS type_name,' +
    ' a.attnotnull,pg_get_expr(d.adbin,d.adrelid) AS column_default' +
    ' FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace' +
    ' JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid' +
    ' LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum' +
    ' WHERE n.nspname=$1 AND c.relname=ANY($2::text[])' +
    ' AND c.relkind=\'r\' AND a.attnum>0 AND NOT a.attisdropped' +
    ' ORDER BY c.relname,a.attnum',
    [schema,relevant],
  );
  const constraints = await db.query(
    'SELECT c.relname AS table_name,k.conname,k.contype,' +
    ' pg_get_constraintdef(k.oid,true) AS definition' +
    ' FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid=k.conrelid' +
    ' JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace' +
    ' WHERE n.nspname=$1 AND c.relname=ANY($2::text[])' +
    ' ORDER BY c.relname,k.conname',
    [schema,relevant],
  );
  const indexes = await db.query(
    'SELECT tablename,indexname,indexdef AS definition FROM pg_catalog.pg_indexes' +
    ' WHERE schemaname=$1 AND (tablename=ANY($2::text[])' +
    ' OR (tablename=\'clients\' AND indexname=\'nextcrm_clients_owner_id_idx\'))' +
    ' ORDER BY tablename,indexname',
    [schema,relevant],
  );
  const triggers = await db.query(
    'SELECT c.relname AS table_name,t.tgname,pg_get_triggerdef(t.oid,true) AS definition' +
    ' FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid' +
    ' JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace' +
    ' WHERE n.nspname=$1 AND c.relname=ANY($2::text[]) AND NOT t.tgisinternal' +
    ' ORDER BY c.relname,t.tgname',
    [schema,relevant],
  );
  const functions = await db.query(
    'SELECT p.proname,pg_get_functiondef(p.oid) AS definition' +
    ' FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace' +
    ' WHERE n.nspname=$1 AND p.proname=\'nextcrm_document_immutable_guard\'' +
    ' ORDER BY p.proname',
    [schema],
  );
  const clean = r => r.rows.map(row =>
    Object.fromEntries(Object.entries(row).map(([k,v]) =>
      [k,k === 'definition' ? normalizeDefinition(v,schema) : v])),
  );
  const result = {
    columns:clean(columns), constraints:clean(constraints),
    indexes:clean(indexes), triggers:clean(triggers), functions:clean(functions),
  };
  if (new Set(result.columns.map(row => row.table_name)).size !== relevant.length ||
      result.indexes.length < 9 || result.triggers.length !== 2 ||
      result.functions.length !== 1) {
    throw new Error('LINEAGE_REQUIRED_SCHEMA_ELEMENTS_MISSING: ' +
      JSON.stringify({tables:new Set(result.columns.map(x=>x.table_name)).size,
        indexes:result.indexes.length,triggers:result.triggers.length,functions:result.functions.length}));
  }
  return result;
}

async function setup(db, schema) {
  await db.query('CREATE SCHEMA ' + safeIdent(schema));
  await db.query('SELECT set_config(\'search_path\',$1,true)',[schema]);
  // Minimal disposable ERP dependency tables. No application data.
  await db.query('CREATE TABLE clients (id text PRIMARY KEY,owner_id text NOT NULL,status text DEFAULT \'active\' NOT NULL)');
  await db.query('CREATE TABLE service_orders (id text PRIMARY KEY,owner_id text,client_id text)');
  await db.query('CREATE TABLE _cisne_schema_migrations (id text PRIMARY KEY)');
}

async function record(db, id) {
  await db.query('INSERT INTO _cisne_schema_migrations(id) VALUES($1)',[id]);
}

async function history(db, schema) {
  await db.query('SELECT set_config(\'search_path\',$1,true)',[schema]);
  const {rows} = await db.query('SELECT id FROM _cisne_schema_migrations ORDER BY id');
  return rows.map(r => r.id);
}

async function run() {
  const databaseUrl = refuseNonEphemeralDatabase();
  const db = new Pool({connectionString:databaseUrl,max:1,connectionTimeoutMillis:5000});
  const client = await db.connect();
  let inTransaction=false;
  const suffix=randomBytes(5).toString('hex');
  const fin='lineage_fin_' + suffix, doc='lineage_doc_' + suffix;
  try {
    await client.query('BEGIN');
    inTransaction=true;
    await client.query("SET LOCAL statement_timeout = '30000ms'");
    await client.query("SET LOCAL lock_timeout = '4000ms'");

    await setup(client,fin);
    await executeMigration(client,'0001_nextcrm_order_document_links.sql');
    await record(client,'0001_nextcrm_order_document_links');
    await executeMigration(client,'0002_nextcrm_verified_mappings.sql');
    await record(client,'0002_nextcrm_verified_mappings');
    const financeLedger=await history(client,fin);
    // The canonical #43 bridge adds exactly one client/owner uniqueness index.
    // Finance-first must add it without recreating any existing table or audit event.
    await client.query('CREATE UNIQUE INDEX IF NOT EXISTS nextcrm_clients_owner_id_idx ON clients(owner_id,id)');
    await client.query('CREATE UNIQUE INDEX IF NOT EXISTS nextcrm_clients_owner_id_idx ON clients(owner_id,id)');
    const financeCatalog=await fingerprint(client,fin);
    const financeTables=[...new Set(financeCatalog.columns.map(row=>row.table_name))];
    assertNextcrmMigrationPreflight({
      manifestIds:['0001_nextcrm_order_document_links','0002_nextcrm_verified_mappings'],
      appliedIds:financeLedger,presentTables:financeTables,
    });
    let rejectedDocumentManifest=false;
    try {
      assertNextcrmMigrationPreflight({
        manifestIds:['0003_nextcrm_document_bridge'],
        appliedIds:financeLedger,presentTables:financeTables,
      });
    } catch(error) {
      if(!String(error).includes('FINANCE_HISTORY_REQUIRES_RECONCILIATION')) throw error;
      rejectedDocumentManifest=true;
    }
    if(!rejectedDocumentManifest)throw new Error('LINEAGE_GUARD_FAILED_FINANCE_FIRST');

    await setup(client,doc);
    await executeMigration(client,'0003_nextcrm_document_bridge.sql');
    await record(client,'0003_nextcrm_document_bridge');
    const documentsLedger=await history(client,doc);
    const docCatalog=await fingerprint(client,doc);
    const documentTables=[...new Set(docCatalog.columns.map(row=>row.table_name))];
    assertNextcrmMigrationPreflight({
      manifestIds:['0003_nextcrm_document_bridge'],
      appliedIds:documentsLedger,presentTables:documentTables,
    });
    let rejectedFinanceManifest=false;
    try {
      assertNextcrmMigrationPreflight({
        manifestIds:['0001_nextcrm_order_document_links','0002_nextcrm_verified_mappings'],
        appliedIds:documentsLedger,presentTables:documentTables,
      });
    } catch(error) {
      if(!String(error).includes('DOCUMENT_HISTORY_REQUIRES_RECONCILIATION')) throw error;
      rejectedFinanceManifest=true;
    }
    if(!rejectedFinanceManifest)throw new Error('LINEAGE_GUARD_FAILED_DOCUMENT_FIRST');

    if (JSON.stringify(financeCatalog)!==JSON.stringify(docCatalog)) {
      for(const k of Object.keys(financeCatalog)) {
        if(JSON.stringify(financeCatalog[k])!==JSON.stringify(docCatalog[k])) {
          throw new Error('LINEAGE_CATALOG_MISMATCH_' + k + ': ' +
            JSON.stringify({financial:financeCatalog[k],documents:docCatalog[k]}).slice(0,2000));
        }
      }
    }

    // Negative gate: deliberately corrupt only the disposable finance catalog;
    // the structural comparison must catch drift instead of accepting IF NOT EXISTS.
    await client.query('SELECT set_config(\'search_path\',$1,true)',[fin]);
    await client.query('DROP INDEX nextcrm_doc_link_tenant_idx');
    const changed=await fingerprint(client,fin);
    if (JSON.stringify(changed)===JSON.stringify(docCatalog))
      throw new Error('LINEAGE_DRIFT_WAS_NOT_DETECTED');

    if (financeLedger.join(',') !==
        '0001_nextcrm_order_document_links,0002_nextcrm_verified_mappings' ||
        documentsLedger.join(',') !== '0003_nextcrm_document_bridge') {
      throw new Error('LINEAGE_LEDGERS_NOT_DISTINCT');
    }

    await client.query('ROLLBACK');
    inTransaction=false;
    console.log('NEXTCRM_DUAL_LINEAGE_REHEARSAL_OK PG catalogs equal after one additive index;' +
      ' histories distinct; drift rejected; ALL SCHEMAS ROLLED BACK.');
  } finally {
    if(inTransaction) await client.query('ROLLBACK').catch(()=>{});
    client.release();
    await db.end();
  }
}

await run();
