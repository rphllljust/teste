import assert from 'node:assert/strict';
import test from 'node:test';
import { changedNextcrmProfileFields } from './profile-changes.ts';

const before = {
  officePhone: '5511999999999', website: 'https://empresa.example', email: 'financeiro@example',
  billingStreet: 'Rua A', billingPostalCode: '76800000', billingCity: 'Porto Velho',
  billingState: 'RO', billingCountry: 'BR', shippingStreet: 'Rua B',
  shippingPostalCode: '76800001', shippingCity: 'Porto Velho', shippingState: 'RO',
  shippingCountry: 'BR', description: 'Perfil preservado', annualRevenue: '1000000',
};

test('edits only changed rendered fields and never emits hidden CRM attributes', () => {
  const result = changedNextcrmProfileFields(before, {...before, officePhone: '5511888888888'});
  assert.deepEqual(result, {officePhone: '5511888888888'});
});

test('blanking a rendered field is an explicit null clear', () => {
  const result = changedNextcrmProfileFields(before, {...before, website: '   '});
  assert.deepEqual(result, {website: null});
});

test('unchanged values produce an empty patch', () => {
  assert.deepEqual(changedNextcrmProfileFields(before, before), {});
});
