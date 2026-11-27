import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount } from './orders.ts';

test('manual accounting amounts convert Brazilian decimal input to scaled integer strings', () => {
  assert.equal(String(parseAmount('2500,00')), '25000000');
  assert.equal(String(parseAmount('12,3456')), '123456');
  assert.equal(parseAmount('0'), null);
  assert.equal(parseAmount('2500.00'), null);
  assert.equal(parseAmount('1,23456'), null);
});
