import test from 'node:test';
import assert from 'node:assert/strict';
import {collectNextcrmChanges} from './client-profile-changes.ts';

test('editing one visible field does not clear unrendered fiscal fields', () => {
  const form = new FormData();
  form.set('officePhone', '+55 69 3000-0000');
  const changes = collectNextcrmChanges(form, {officePhone: '+55 69 2000-0000', vat: 'VAT-123', fax: '999'});
  assert.deepEqual(changes, {officePhone: '+55 69 3000-0000'});
});

test('unchanged fields never overwrite newer server values', () => {
  const form = new FormData();
  form.set('billingCity', 'Porto Velho');
  assert.deepEqual(collectNextcrmChanges(form, {billingCity: 'Porto Velho'}), {});
});

test('intentional clearing sends null only for that field', () => {
  const form = new FormData();
  form.set('website', '');
  const changes = collectNextcrmChanges(form, {website: 'https://example.org', companyId: 'AC-01'});
  assert.deepEqual(changes, {website:null});
});

test('filled fiscal and commercial fields are sent when changed', () => {
  const form = new FormData();
  form.set('vat', ' BR-001 ');
  form.set('memberOf','CISNE Holding');
  const changes = collectNextcrmChanges(form, {vat:null, memberOf:null});
  assert.deepEqual(changes, {vat:'BR-001', memberOf:'CISNE Holding'});
});
