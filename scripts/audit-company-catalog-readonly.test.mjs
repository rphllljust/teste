import test from 'node:test';
import assert from 'node:assert/strict';
import {assertCompanyCatalogEvidence} from './audit-company-catalog-readonly.mjs';

const valid = Object.freeze({
  migrationApplied:true,companyTable:true,catalogTable:true,orderTable:true,
  orderCatalogColumn:true,catalogCompanyFk:true,orderCatalogFk:true,
  catalogIndex:true,orderIndex:true,
  companyStatus:'active',companyCnpj:'11897171000181',
  serviceCount:20,activeServiceCount:20,
});

test('catalog accepts complete, evidenced schema', () => {
  assert.deepEqual(assertCompanyCatalogEvidence(valid), {
    migrationId:'0006_cisne_company_service_catalog',
    companyCnpj:'11897171000181',serviceCount:20,activeServiceCount:20,
  });
});
test('ledger alone cannot prove relational integrity', () => {
  for (const field of ['companyTable','catalogTable','orderTable','orderCatalogColumn',
    'catalogCompanyFk','orderCatalogFk','catalogIndex','orderIndex']) {
    assert.throws(() => assertCompanyCatalogEvidence({...valid,[field]:false}),
      new RegExp('COMPANY_CATALOG_NO_GO: ' + field));
  }
});
test('rejects absent ledger, missing seed and inactive company', () => {
  assert.throws(() => assertCompanyCatalogEvidence({...valid,migrationApplied:false}),
    /COMPANY_CATALOG_NO_GO: migrationApplied/);
  assert.throws(() => assertCompanyCatalogEvidence({...valid,serviceCount:19}),
    /expected 20 seeded/);
  assert.throws(() => assertCompanyCatalogEvidence({...valid,activeServiceCount:0}),
    /no active services/);
  assert.throws(() => assertCompanyCatalogEvidence({...valid,companyStatus:'inactive'}),
    /company profile missing or inactive/);
  assert.throws(() => assertCompanyCatalogEvidence({...valid,companyCnpj:'00000000000000'}),
    /company profile missing or inactive/);
});
