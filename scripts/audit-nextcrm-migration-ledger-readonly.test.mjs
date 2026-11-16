import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyNextcrmMigrationHistory,
  assessNextcrmCatalog,
  requiredColumns,
} from './audit-nextcrm-migration-ledger-readonly.mjs';

const baseSnapshot = () => ({
  migrations:['0003_nextcrm_document_bridge'],
  tables:['clients','service_orders','_cisne_schema_migrations',...Object.keys(requiredColumns)],
  columns:Object.entries(requiredColumns).flatMap(([table_name, cols]) =>
    cols.map(column_name => ({table_name,column_name}))),
  indexes:[
    'nextcrm_identity_active_idx','nextcrm_client_account_owner_idx',
    'nextcrm_doc_link_order_owner_idx','nextcrm_doc_link_tenant_idx',
    'nextcrm_doc_event_link_idx','nextcrm_clients_owner_id_idx',
  ],
  constraints:[
    'nextcrm_identity_subject_uuid','nextcrm_identity_instance','nextcrm_identity_approval',
    'nextcrm_account_uuid','nextcrm_account_instance','nextcrm_account_approval',
    'nextcrm_doc_link_version_valid','nextcrm_doc_link_kind_valid',
    'nextcrm_doc_link_sha256_valid','nextcrm_doc_link_hash_valid',
    'nextcrm_doc_link_owner_idempotency','nextcrm_doc_link_logical_unique',
    'nextcrm_doc_event_type_valid','nextcrm_doc_event_hash_valid','nextcrm_doc_event_one_linked',
  ],
  triggers:['nextcrm_doc_links_immutable','nextcrm_doc_events_immutable'],
  guardFunction:true,
});

test('classifies exact finance and document ledger histories and refuses mixed/partial state', () => {
  assert.equal(classifyNextcrmMigrationHistory(['0003_nextcrm_document_bridge']),'DOCUMENT_FIRST');
  assert.equal(classifyNextcrmMigrationHistory([
    '0001_nextcrm_order_document_links','0002_nextcrm_verified_mappings',
  ]),'FINANCE_FIRST');
  assert.equal(classifyNextcrmMigrationHistory([
    '0001_nextcrm_order_document_links',
  ]),'MIXED_OR_PARTIAL_HISTORY');
  assert.equal(classifyNextcrmMigrationHistory([
    '0001_nextcrm_order_document_links','0002_nextcrm_verified_mappings',
    '0003_nextcrm_document_bridge',
  ]),'MIXED_OR_PARTIAL_HISTORY');
  assert.equal(classifyNextcrmMigrationHistory([]),'NO_BRIDGE_MIGRATION');
});

test('canonical document-first catalog is review candidate, NOT approved release', () => {
  const verdict=assessNextcrmCatalog(baseSnapshot());
  assert.equal(verdict.lineage,'DOCUMENT_FIRST');
  assert.equal(verdict.status,'CATALOG_REVIEW_REQUIRED');
  assert.deepEqual(verdict.missing,[]);
  assert.equal(verdict.requiresClientIndex,false);
});

test('finance-first without client-owner index needs reviewed additive reconciliation', () => {
  const snapshot=baseSnapshot();
  snapshot.migrations=['0001_nextcrm_order_document_links','0002_nextcrm_verified_mappings'];
  snapshot.indexes=snapshot.indexes.filter(x=>x!=='nextcrm_clients_owner_id_idx');
  const verdict=assessNextcrmCatalog(snapshot);
  assert.equal(verdict.status,'RECONCILIATION_REQUIRED');
  assert.deepEqual(verdict.missing,[]);
  assert.equal(verdict.requiresClientIndex,true);
});

test('missing security constraint, trigger, column or wrong ledger always denies', () => {
  for(const field of ['indexes','constraints','triggers','columns']){
    const snapshot=baseSnapshot();
    snapshot[field]=snapshot[field].slice(1);
    const verdict=assessNextcrmCatalog(snapshot);
    assert.equal(verdict.status,'NO_GO',field);
    assert.ok(verdict.missing.length>0,field);
  }
  const snapshot=baseSnapshot();
  snapshot.migrations.push('0001_nextcrm_order_document_links');
  assert.equal(assessNextcrmCatalog(snapshot).status,'NO_GO');
  snapshot.migrations=[];
  assert.equal(assessNextcrmCatalog(snapshot).status,'NO_GO');
  const n=baseSnapshot();
  n.guardFunction=false;
  assert.equal(assessNextcrmCatalog(n).status,'NO_GO');
});

test('document-first missing unique client-owner index must deny, not auto-fix', () => {
  const snapshot=baseSnapshot();
  snapshot.indexes=snapshot.indexes.filter(x=>x!=='nextcrm_clients_owner_id_idx');
  const verdict=assessNextcrmCatalog(snapshot);
  assert.equal(verdict.status,'NO_GO');
  assert.ok(verdict.missing.includes('index:nextcrm_clients_owner_id_idx'));
});
