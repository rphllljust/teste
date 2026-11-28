import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const billingUi = await readFile(new URL('../app/BillingPreparation.tsx', import.meta.url), 'utf8');
const commandRoute = await readFile(new URL('../app/api/commands/route.ts', import.meta.url), 'utf8');

test('approved measurement billing UI uses the atomic accounting billing endpoint', () => {
  assert.match(billingUi, /fetch\('\/api\/finance\/billing'/);
  assert.match(billingUi, /expectedVersion:capability!\.expectedVersion/);
  assert.match(billingUi, /resource\?:\{invoiceId:string\}/);
  assert.match(billingUi, /\/api\/finance\/billing\?commandKey=/);
  assert.doesNotMatch(billingUi, /fetch\('\/api\/commands'/);
});

test('legacy invoice command dispatch delegates to the same accounting application service', () => {
  assert.match(commandRoute, /if \(p\.command === 'invoice'\)[\s\S]*?billApprovedMeasurement\(context/);
});
