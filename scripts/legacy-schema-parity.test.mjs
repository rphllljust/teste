import test from 'node:test';
import assert from 'node:assert/strict';
import {legacyColumnsCompatible} from './legacy-schema-parity.mjs';

test('legacy parity matches exact baseline', () => {
  assert.equal(legacyColumnsCompatible('clients',['id','legal_name'],['id','legal_name']),true);
});
test('0006 adds only audited service_catalog_id without changing legacy fingerprint', () => {
  assert.equal(legacyColumnsCompatible('service_orders',
    ['id','status','service_catalog_id'],['id','status']),true);
});

test('Field execution detail migrations are additive to the legacy fingerprint', () => {
  assert.equal(legacyColumnsCompatible('execution_entries',
    ['id','order_id','stage','started_at','ended_at','notes','responsible_person_id'],
    ['id','order_id']),true);
  assert.equal(legacyColumnsCompatible('execution_entries',
    ['id','order_id','stage','unverified_flag'],['id','order_id']),false);
});
test('unknown additions, missing legacy columns and duplicate fields fail closed', () => {
  assert.equal(legacyColumnsCompatible('service_orders',
    ['id','status','service_catalog_id','unverified_flag'],['id','status']),false);
  assert.equal(legacyColumnsCompatible('clients',['id','unknown'],['id']),false);
  assert.equal(legacyColumnsCompatible('service_orders',['id'],['id','status']),false);
  assert.equal(legacyColumnsCompatible('service_orders',['id','id'],['id']),false);
  assert.equal(legacyColumnsCompatible('service_orders',['id','bad"name'],['id']),false);
  assert.equal(legacyColumnsCompatible('service_orders',['id'],[]),false);
});
