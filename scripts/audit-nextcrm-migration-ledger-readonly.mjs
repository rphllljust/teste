import { Pool } from 'pg';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Operational READ-ONLY preflight for the ERP PostgreSQL schema.
 *
 * Never exports any identity mapping, document, customer or financial row.
 * Not an attestation and not a replacement for a verified restore.
 * Cannot mutate the schema ledger or automatically reconcile conflicting histories.
 */
const FIN_LINK = '0001_nextcrm_order_document_links';
const FIN_MAPPING = '0002_nextcrm_verified_mappings';
const DOC_BRIDGE = '0003_nextcrm_document_bridge';

export const requiredColumns = Object.freeze({
  nextcrm_erp_identity_mappings: ['erp_actor_id','nextcrm_subject_id','instance_key','active','verified_source','verified_by','verified_at','created_at'],
  nextcrm_erp_client_account_mappings: ['erp_client_id','erp_owner_id','nextcrm_account_id','instance_key','active','verified_source','verified_by','verified_at','created_at'],
  nextcrm_order_document_links: ['id','service_order_id','owner_id','erp_client_id','tenant_key','nextcrm_account_id','nextcrm_document_id','document_kind','document_version','sha256','idempotency_key','request_hash','created_by','correlation_id','created_at'],
  nextcrm_order_document_events: ['id','link_id','event_type','actor_id','request_hash','correlation_id','occurred_at'],
});
const bridgeIndexes = [
  'nextcrm_identity_active_idx',
  'nextcrm_client_account_owner_idx',
  'nextcrm_doc_link_order_owner_idx',
  'nextcrm_doc_link_tenant_idx',
  'nextcrm_doc_event_link_idx',
];
const bridgeConstraints = [
  'nextcrm_identity_subject_uuid', 'nextcrm_identity_instance', 'nextcrm_identity_approval',
  'nextcrm_account_uuid', 'nextcrm_account_instance', 'nextcrm_account_approval',
  'nextcrm_doc_link_version_valid', 'nextcrm_doc_link_kind_valid',
  'nextcrm_doc_link_sha256_valid', 'nextcrm_doc_link_hash_valid',
  'nextcrm_doc_link_owner_idempotency', 'nextcrm_doc_link_logical_unique',
  'nextcrm_doc_event_type_valid', 'nextcrm_doc_event_hash_valid', 'nextcrm_doc_event_one_linked',
];
const bridgeTriggers = ['nextcrm_doc_links_immutable', 'nextcrm_doc_events_immutable'];

export function classifyNextcrmMigrationHistory(ids) {
  const active = new Set(ids);
  const finLink=active.has(FIN_LINK);
  const finMapping=active.has(FIN_MAPPING);
  const docBridge=active.has(DOC_BRIDGE);
  if (docBridge && !finLink && !finMapping) return 'DOCUMENT_FIRST';
  if (finLink && finMapping && !docBridge) return 'FINANCE_FIRST';
  if (!finLink && !finMapping && !docBridge) return 'NO_BRIDGE_MIGRATION';
  return 'MIXED_OR_PARTIAL_HISTORY';
}

export function assessNextcrmCatalog(snapshot) {
  const lineage=classifyNextcrmMigrationHistory(snapshot.migrations);
  const missing=[];
  const tables=new Set(snapshot.tables);
  for(const t of ['clients','service_orders','_cisne_schema_migrations',
    ...Object.keys(requiredColumns)]) {
    if(!tables.has(t))missing.push('table:' + t);
  }
  const colsByTable=new Map();
  for(const row of snapshot.columns) {
    const set=colsByTable.get(row.table_name)??new Set();
    set.add(row.column_name);
    colsByTable.set(row.table_name,set);
  }
  for(const [t,cols]of Object.entries(requiredColumns)) {
    for(const c of cols)if(!colsByTable.get(t)?.has(c))missing.push('column:' + t + '.' + c);
  }
  const indexes=new Set(snapshot.indexes);
  for(const i of bridgeIndexes)if(!indexes.has(i))missing.push('index:' + i);
  const constraints=new Set(snapshot.constraints);
  for(const c of bridgeConstraints)if(!constraints.has(c))missing.push('constraint:' + c);
  const triggers=new Set(snapshot.triggers);
  for(const t of bridgeTriggers)if(!triggers.has(t))missing.push('trigger:' + t);
  if(!snapshot.guardFunction)missing.push('function:nextcrm_document_immutable_guard');

  const clientOwnerIndex=indexes.has('nextcrm_clients_owner_id_idx');
  if(lineage==='DOCUMENT_FIRST' && !clientOwnerIndex)
    missing.push('index:nextcrm_clients_owner_id_idx');

  // The finance-first history legitimately lacks the extra index. Its addition
  // requires operator review and backup; it is never applied by this audit.
  const requiresClientIndex=lineage==='FINANCE_FIRST' && !clientOwnerIndex;
  const structuralMissing=missing.length>0;
  return {
    status:lineage==='MIXED_OR_PARTIAL_HISTORY' || lineage==='NO_BRIDGE_MIGRATION' ||
      structuralMissing ? 'NO_GO' : requiresClientIndex
        ? 'RECONCILIATION_REQUIRED' : 'CATALOG_REVIEW_REQUIRED',
    lineage,
    missing,
    requiresClientIndex,
    evidenceLimits:'Catalog names/columns checked; compare definitions, backup and ledger before any write.',
  };
}

export async function auditNextcrmMigrationLedger(db) {
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    await db.query("SET LOCAL statement_timeout = '12000ms'");
    const [tables,columns,indexes,constraints,triggers,guard,migrations] = await Promise.all([
      db.query("SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')"),
      db.query("SELECT c.relname AS table_name, a.attname AS column_name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped AND c.relname LIKE 'nextcrm_%'"),
      db.query("SELECT indexname AS name FROM pg_indexes WHERE schemaname='public' AND (tablename LIKE 'nextcrm_%' OR (tablename='clients' AND indexname='nextcrm_clients_owner_id_idx'))"),
      db.query("SELECT k.conname AS name FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname LIKE 'nextcrm_%'"),
      db.query("SELECT t.tgname AS name FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname LIKE 'nextcrm_%' AND NOT t.tgisinternal"),
      db.query("SELECT p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='nextcrm_document_immutable_guard'"),
      // Never touch migrations ledger if it is missing. The guard runs first
      // in the same read-only snapshot and never reads business records.
      db.query("SELECT to_regclass('public._cisne_schema_migrations') IS NOT NULL AS present"),
    ]);
    if(!migrations.rows[0]?.present)throw new Error('LINEAGE_NO_GO_ERP_LEDGER_MISSING');
    const ids=await db.query("SELECT id FROM public._cisne_schema_migrations WHERE id IN ($1,$2,$3) ORDER BY id",[
      FIN_LINK,FIN_MAPPING,DOC_BRIDGE,
    ]);
    const snapshot={
      tables:tables.rows.map(x=>x.name),
      columns:columns.rows,
      indexes:indexes.rows.map(x=>x.name),
      constraints:constraints.rows.map(x=>x.name),
      triggers:triggers.rows.map(x=>x.name),
      guardFunction:guard.rows.some(x=>x.name==='nextcrm_document_immutable_guard'),
      migrations:ids.rows.map(x=>x.id),
    };
    const verdict=assessNextcrmCatalog(snapshot);
    await db.query('COMMIT');
    return {
      ...verdict,
      catalogCounts:{
        erpTables:tables.rows.length,
        nextcrmTables:snapshot.tables.filter(x=>x.startsWith('nextcrm_')).length,
        bridgeIndexes:snapshot.indexes.length,
        bridgeConstraints:snapshot.constraints.length,
        bridgeTriggers:snapshot.triggers.length,
      },
    };
  }catch(error){
    await db.query('ROLLBACK').catch(()=>{});
    throw error;
  }
}

async function main(){
  if(!process.env.DATABASE_URL)throw new Error('LINEAGE_NO_GO_DATABASE_URL_REQUIRED');
  const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000});
  const client=await pool.connect();
  try {
    const result=await auditNextcrmMigrationLedger(client);
    // Exactly one non-sensitive summary line; never print DATABASE_URL or rows.
    console.log('NEXTCRM_MIGRATION_READONLY_AUDIT '+JSON.stringify(result));
    if(result.status==='NO_GO')process.exitCode=2;
  }finally{client.release();await pool.end();}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  await main();
}
