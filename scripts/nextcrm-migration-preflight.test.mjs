import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NEXTCRM_BRIDGE_TABLES,
  assertNextcrmMigrationPreflight,
} from './nextcrm-migration-preflight.mjs';

const fin=['0001_nextcrm_order_document_links','0002_nextcrm_verified_mappings'];
const doc=['0003_nextcrm_document_bridge'];
const check=(manifestIds,appliedIds,presentTables) =>
  assertNextcrmMigrationPreflight({manifestIds,appliedIds,presentTables});

test('new disposable ERP with no bridge permits exactly one selected history',()=>{
  assert.deepEqual(check(doc,[],[]), {expectedPath:'DOCUMENT_FIRST',bridgeInstalled:false});
  assert.deepEqual(check(fin,[],[]), {expectedPath:'FINANCE_FIRST',bridgeInstalled:false});
});

test('previously installed document history and four tables is safely rerunnable',()=>{
  assert.deepEqual(check(doc,doc,NEXTCRM_BRIDGE_TABLES),
    {expectedPath:'DOCUMENT_FIRST',bridgeInstalled:true});
});

test('previously installed finance history and four tables is safely rerunnable',()=>{
  assert.deepEqual(check(fin,fin,NEXTCRM_BRIDGE_TABLES),
    {expectedPath:'FINANCE_FIRST',bridgeInstalled:true});
});

test('document-first staging categorically rejects a finance-first manifest BEFORE CREATE',()=>{
  assert.throws(()=>check(fin,doc,NEXTCRM_BRIDGE_TABLES),
    /NEXTCRM_MIGRATION_NO_GO_DOCUMENT_HISTORY_REQUIRES_RECONCILIATION/);
});

test('finance-first staging categorically rejects a document-first manifest BEFORE CREATE',()=>{
  assert.throws(()=>check(doc,fin,NEXTCRM_BRIDGE_TABLES),
    /NEXTCRM_MIGRATION_NO_GO_FINANCE_HISTORY_REQUIRES_RECONCILIATION/);
});

test('partial and mixed ledger histories deny unconditionally',()=>{
  assert.throws(()=>check(fin,[fin[0]],NEXTCRM_BRIDGE_TABLES),
    /FINANCE_PARTIAL_HISTORY/);
  assert.throws(()=>check(doc,[fin[1]],NEXTCRM_BRIDGE_TABLES),
    /FINANCE_PARTIAL_HISTORY/);
  assert.throws(()=>check(doc,[...fin,...doc],NEXTCRM_BRIDGE_TABLES),
    /MIXED_HISTORY/);
  assert.throws(()=>check(fin,[...fin,...doc],NEXTCRM_BRIDGE_TABLES),
    /MIXED_HISTORY/);
});

test('partial or untracked schema never gets treated as a fresh install',()=>{
  assert.throws(()=>check(doc,[],[NEXTCRM_BRIDGE_TABLES[0]]),
    /PARTIAL_BRIDGE_SCHEMA/);
  assert.throws(()=>check(fin,[],NEXTCRM_BRIDGE_TABLES),
    /UNTRACKED_BRIDGE_SCHEMA/);
  assert.throws(()=>check(doc,doc,[NEXTCRM_BRIDGE_TABLES[0]]),
    /PARTIAL_BRIDGE_SCHEMA/);
  assert.throws(()=>check(doc,doc,[]),
    /APPLIED_MIGRATION_MISSING_SCHEMA/);
});

test('ambiguous or incomplete migration manifest always fails closed',()=>{
  assert.throws(()=>check([],[],[]),/MANIFEST_CONFLICT/);
  assert.throws(()=>check([...doc,...fin],[],[]),/MANIFEST_CONFLICT/);
  assert.throws(()=>check([fin[0]],[],[]),/MANIFEST_CONFLICT/);
  assert.throws(()=>check([fin[1]],[],[]),/MANIFEST_CONFLICT/);
});
