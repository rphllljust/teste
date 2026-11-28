import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';

/**
 * Run the REAL CISNE migration runner over a disposable PostgreSQL schema
 * that first contains the historically deployed document bridge plus fake facts.
 *
 * The test never connects to Railway and NEVER purges a non-CI database.
 */
function ciOnlyDatabase() {
  const env = process.env;
  if (env.CI !== 'true' || env.GITHUB_ACTIONS !== 'true' ||
      env.NODE_ENV !== 'test') throw new Error('RC_UPGRADE_NO_GO_NOT_CI');
  let url;
  try { url = new URL(env.DATABASE_URL ?? ''); }
  catch { throw new Error('RC_UPGRADE_NO_GO_BAD_DATABASE_URL'); }
  if (url.protocol !== 'postgresql:' ||
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      url.port !== '5432' ||
      !['/cisne_test','/cisne_ci'].includes(url.pathname) ||
      url.search || url.hash) {
    throw new Error('RC_UPGRADE_NO_GO_NON_EPHEMERAL_TARGET');
  }
  return url;
}

function schemaScopedUrl(original, schema) {
  assert.match(schema, /^rc_doc_[a-f0-9]{12}$/);
  const url = new URL(original.toString());
  // PostgreSQL startup options are sent by node-postgres, not a SQL SET in
  // the parent session; the migrated child must see the very same schema.
  url.searchParams.set('options', '-c search_path=' + schema);
  return url.toString();
}

async function execSqlMigration(db, name, schema) {
  const sourceSql = await readFile(new URL('../drizzle-pg/' + name + '.sql', import.meta.url), 'utf8');
  // Drizzle's historical 0000 baseline hardcodes "public" for some FK targets.
  // Only the SYNTHETIC FIXTURE uses an isolated namespace rewrite. The real
  // migrate-postgres.mjs child executes the repository SQL UNMODIFIED.
  // A missing substitution would cause 42P01, so never create in public.
  const scopedSql = sourceSql.replaceAll('"public".', '"' + schema + '".');
  for (const statement of scopedSql.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean)) {
    await db.query(statement);
  }
}

const preexisting = [
  '0000_salty_lilith',
  '0001_native_crm',
  '0002_crm_proposal_origin',
  '0003_nextcrm_document_bridge',
];

async function prepareDocumentFirst(db, schema) {
  await db.query('BEGIN');
  try {
    await db.query('CREATE TABLE _cisne_schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const migration of preexisting) {
      await execSqlMigration(db,migration,schema);
      await db.query('INSERT INTO _cisne_schema_migrations(id) VALUES($1)',[migration]);
    }

    // Synthetic only: no actual customer, login, account, invoice or document.
    const client='UAT-RC-CLIENT', owner='uat-rc-owner', order='UAT-RC-ORDER';
    const account='00000000-0000-4000-8000-000000000012';
    const user='00000000-0000-4000-8000-000000000013';
    const now='2026-11-16T00:00:00.000Z';
    await db.query(
      'INSERT INTO clients(id,owner_id,legal_name,created_at,updated_at) VALUES ($1,$2,$3,$4,$5)',
      [client,owner,'UAT FICTICIO / TEST ONLY',now,now],
    );
    await db.query(
      'INSERT INTO service_orders(id,owner_id,client_id,title,client,category,description,created_at)' +
        ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [order,owner,client,'UAT order','UAT client','inspection','Only synthetic records',now],
    );
    await db.query(
      'INSERT INTO nextcrm_erp_identity_mappings' +
        '(erp_actor_id,nextcrm_subject_id,instance_key,verified_source,verified_by,verified_at)' +
        ' VALUES($1,$2,$3,$4,$5,$6)',
      [owner,user,'ci_synthetic','CI-AUTOMATED-SYNTHETIC','ci-test',now],
    );
    await db.query(
      'INSERT INTO nextcrm_erp_client_account_mappings' +
        '(erp_client_id,erp_owner_id,nextcrm_account_id,instance_key,verified_source,verified_by,verified_at)' +
        ' VALUES($1,$2,$3,$4,$5,$6,$7)',
      [client,owner,account,'ci_synthetic','CI-AUTOMATED-SYNTHETIC','ci-test',now],
    );
    await db.query(
      'INSERT INTO nextcrm_order_document_links' +
        '(id,service_order_id,owner_id,erp_client_id,tenant_key,nextcrm_account_id,' +
        'nextcrm_document_id,document_kind,document_version,sha256,idempotency_key,' +
        'request_hash,created_by,correlation_id)' +
        ' VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
      ['uat-link',order,owner,client,'ci_synthetic',account,'uat-document','contract',1,
       'a'.repeat(64),'uat-key','b'.repeat(64),owner,'uat-correlation'],
    );
    await db.query(
      'INSERT INTO nextcrm_order_document_events' +
        '(id,link_id,event_type,actor_id,request_hash,correlation_id)' +
        ' VALUES($1,$2,$3,$4,$5,$6)',
      ['uat-event','uat-link','linked',owner,'b'.repeat(64),'uat-correlation'],
    );
    await db.query('COMMIT');
  } catch(e) {
    await db.query('ROLLBACK').catch(()=>{});
    throw e;
  }
}

async function assertPreserved(db, expectedLedger) {
  const check = [
    ['clients','id','UAT-RC-CLIENT'],
    ['service_orders','id','UAT-RC-ORDER'],
    ['nextcrm_erp_identity_mappings','erp_actor_id','uat-rc-owner'],
    ['nextcrm_erp_client_account_mappings','erp_client_id','UAT-RC-CLIENT'],
    ['nextcrm_order_document_links','id','uat-link'],
    ['nextcrm_order_document_events','id','uat-event'],
  ];
  for(const [table,column,id] of check) {
    const {rows} = await db.query('SELECT COUNT(*)::int AS n FROM "'+table+'" WHERE "'+column+'"=$1',[id]);
    assert.equal(rows[0].n,1,'synthetic fact must survive: '+table);
  }
  const {rows:links}=await db.query(
    'SELECT document_kind,document_version,sha256,request_hash FROM nextcrm_order_document_links WHERE id=$1',
    ['uat-link'],
  );
  assert.equal(links[0].document_kind,'contract');
  assert.equal(links[0].document_version,1);
  assert.equal(links[0].sha256,'a'.repeat(64));
  assert.equal(links[0].request_hash,'b'.repeat(64));
  const {rows:mappings}=await db.query(
    'SELECT active FROM nextcrm_erp_identity_mappings WHERE erp_actor_id=$1',
    ['uat-rc-owner'],
  );
  assert.equal(mappings[0].active,false,'unapproved mapping must remain disabled');

  const {rows:ledger}=await db.query('SELECT id FROM _cisne_schema_migrations ORDER BY id');
  assert.deepEqual(ledger.map(x=>x.id),expectedLedger.slice().sort());

  const {rows:finance}=await db.query(
    "SELECT to_regclass('finance_audit_events') IS NOT NULL AS audit,"+
    "to_regclass('cash_transfers') IS NOT NULL AS transfers,"+
    "to_regclass('finance_period_closes') IS NOT NULL AS period_closes",
  );
  assert.deepEqual(finance[0],{audit:true,transfers:true,period_closes:true});

  const {rows:triggers}=await db.query(
    "SELECT count(*)::int AS n FROM pg_trigger WHERE tgname IN "+
    "('nextcrm_doc_links_immutable','nextcrm_doc_events_immutable') AND NOT tgisinternal",
  );
  assert.equal(triggers[0].n,2);
}

async function guardImmutableAudit(db) {
  const client=await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SAVEPOINT verify_immutable');
    let prevented = false;
    try {
      await client.query("UPDATE nextcrm_order_document_links SET document_kind='photo' WHERE id='uat-link'");
    } catch(e) {
      prevented=String(e.message).includes('NEXTCRM_DOCUMENT_IMMUTABLE_FACT');
    }
    await client.query('ROLLBACK TO SAVEPOINT verify_immutable');
    assert.equal(prevented,true,'audit/event links remain immutable after upgrade');
    await client.query('COMMIT');
  } catch(e) {
    await client.query('ROLLBACK').catch(()=>{});
    throw e;
  } finally {
    client.release();
  }
}

async function run() {
  const base=ciOnlyDatabase();
  const schema='rc_doc_'+randomBytes(6).toString('hex');
  const scopedUrl=schemaScopedUrl(base,schema);
  const admin=new Pool({connectionString:base.toString(),max:1});
  const scoped=new Pool({connectionString:scopedUrl,max:1});
  let created=false;
  try {
    await admin.query('CREATE SCHEMA "'+schema+'"');
    created=true;
    const target=await scoped.query('SELECT current_schema() AS name');
    assert.equal(target.rows[0].name,schema,'refuse migrations against any other schema');

    await prepareDocumentFirst(scoped,schema);
    const realRunner=fileURLToPath(new URL('./migrate-postgres.mjs', import.meta.url));
    const env={...process.env,DATABASE_URL:scopedUrl};
    // This is the real migration entrypoint, not simulated statements.
    execFileSync(process.execPath,[realRunner],{
      env,timeout:30000,stdio:['ignore','pipe','pipe'],
    });
    const canonical=[
      ...preexisting,'0003_finance_audit','0004_cash_transfers','0005_finance_period_closes',
      '0006_professionals','0007_assets','0008_inventory_ledger','0009_workflow_approvals','0010_resource_allocations','0011_inventory_consumption','0012_field_service_measurements','0013_workflow_business_commands','0014_manual_fiscal_documents','0015_fiscal_bigint_integrity','0016_field_service_measurement_lifecycle','0017_enterprise_tenancy_foundation','0018_accounting_invoice_links','0019_native_invoice_posting_rules','0020_receivable_cash_ledger','0021_chart_accounts_tenant_unique','0022_native_payable_accounting','0023_procurement_supplier_three_way_match','0024_enterprise_owner_query_indexes','0025_controlling_budgets','0025_finance_payment_runs','0026_bank_assisted_match_batches','0027_finance_collection_cases','0028_enterprise_project_cost_allocations','0029_enterprise_os_work_packages','0030_enterprise_external_references','0031_enterprise_external_reference_review','0032_enterprise_cnae_activities','0033_cisne_dual_owner_declarations',
    ];
    await assertPreserved(scoped,canonical);
    await guardImmutableAudit(scoped);
    // Re-run exactly the same entrypoint. Must not overwrite or multiply records.
    execFileSync(process.execPath,[realRunner],{
      env,timeout:30000,stdio:['ignore','pipe','pipe'],
    });
    await assertPreserved(scoped,canonical);

    // Verify finance audit can append synthetic facts without touching documents.
    await scoped.query(
      'INSERT INTO finance_audit_events(id,entity_type,entity_id,action,actor_id,'+
      'request_hash,correlation_id,metadata,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      ['uat-fin-audit','payable','uat-payable','created','uat-rc-owner',
       'c'.repeat(64),'uat-correlation','{"synthetic":true}','2026-11-16T00:00:00Z'],
    );
    const {rows:audits}=await scoped.query(
      "SELECT COUNT(*)::int AS n FROM finance_audit_events WHERE id='uat-fin-audit'");
    assert.equal(audits[0].n,1);
    await assertPreserved(scoped,canonical);

    console.log('RC_DOCUMENT_FIRST_FINANCE_UPGRADE_OK: legacy documents and identity retained;'+
      ' finance migration applied once; replay idempotent; immutable triggers enforced;'+
      ' synthetic financial audit append succeeded.');
  } finally {
    await scoped.end();
    if(created)await admin.query('DROP SCHEMA "'+schema+'" CASCADE');
    await admin.end();
  }
}

await run();
